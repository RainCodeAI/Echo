"use node";

import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import OpenAI from "openai";
import {
  STRUCTURE_NOTE_JSON_SCHEMA,
  STRUCTURE_NOTE_SYSTEM_PROMPT,
  buildStructureUserPrompt,
  sanitizeStructuredNote,
  type StructuredNoteModel,
  URGENCY_VALUES,
} from "./lib/prompts";

/**
 * OpenAI-backed enrichment for Echo voice notes.
 *
 * Pipeline per note:
 *  1. Optionally Whisper-transcribe when transcript is weak/empty and audio exists
 *  2. Structure transcript into materials / actions / urgency / summary
 *
 * Requires on the Convex deployment:
 *   npx convex env set OPENAI_API_KEY sk-...
 * Optional:
 *   npx convex env set OPENAI_MODEL gpt-4o-mini
 */

const MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
const STRUCTURE_MAX_TOKENS = 900;
const MIN_TRANSCRIPT_CHARS = 12;

function killSwitchOn(): boolean {
  const v = process.env.OPENAI_KILL_SWITCH;
  return v === "1" || v === "true";
}

function getClient(): OpenAI | null {
  if (killSwitchOn()) return null;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({ apiKey });
}

function mimeToExtension(mime?: string): string {
  if (!mime) return "webm";
  if (mime.includes("mp4") || mime.includes("m4a")) return "mp4";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("wav")) return "wav";
  return "webm";
}

/**
 * Full processing pipeline for one note. Scheduled after field create and
 * owner retry. Never deletes raw capture on failure.
 */
export const processNoteInternal = internalAction({
  args: { noteId: v.id("voiceNotes") },
  handler: async (ctx, { noteId }) => {
    const bundle = await ctx.runQuery(internal.voiceNotes.getInternal, {
      noteId,
    });
    if (!bundle) return;

    const { note, crewName, companyName, primaryTrade } = bundle;
    await ctx.runMutation(internal.voiceNotes.markAiProcessing, { noteId });

    const client = getClient();
    if (!client) {
      await ctx.runMutation(internal.voiceNotes.applyAiFailure, {
        noteId,
        error:
          "AI unavailable — set OPENAI_API_KEY on the Convex deployment (or clear OPENAI_KILL_SWITCH).",
      });
      return;
    }

    let transcript = note.rawTranscript?.trim() ?? "";
    let transcriptSource = note.transcriptSource;

    // --- Whisper when needed -----------------------------------------------
    const needsWhisper =
      !!note.audioStorageId &&
      (transcript.length < MIN_TRANSCRIPT_CHARS || !transcript);

    if (needsWhisper && note.audioStorageId) {
      try {
        const blob = await ctx.storage.get(note.audioStorageId);
        if (blob) {
          const ext = mimeToExtension(note.audioMimeType);
          const file = new File([blob], `note-${noteId}.${ext}`, {
            type: note.audioMimeType || "audio/webm",
          });
          const whisper = await client.audio.transcriptions.create({
            file,
            model: "whisper-1",
            language: "en",
          });
          const whispered = (whisper.text ?? "").trim();
          if (whispered) {
            if (transcript.length >= MIN_TRANSCRIPT_CHARS) {
              transcript = `${transcript}\n\n${whispered}`.trim();
              transcriptSource = "merged";
            } else {
              transcript = whispered;
              transcriptSource = "whisper";
            }
            await ctx.runMutation(internal.voiceNotes.applyTranscript, {
              noteId,
              rawTranscript: transcript,
              transcriptSource,
            });
          }
        }
      } catch (err) {
        // If we still have a usable client transcript, continue structuring.
        if (transcript.length < MIN_TRANSCRIPT_CHARS) {
          await ctx.runMutation(internal.voiceNotes.applyAiFailure, {
            noteId,
            error:
              err instanceof Error
                ? `Whisper failed: ${err.message}`
                : "Whisper transcription failed.",
          });
          return;
        }
      }
    }

    if (transcript.length < MIN_TRANSCRIPT_CHARS) {
      await ctx.runMutation(internal.voiceNotes.applyAiFailure, {
        noteId,
        error:
          "No usable transcript. Re-record with speech, or ensure audio uploaded for Whisper.",
      });
      return;
    }

    // --- Structure ---------------------------------------------------------
    try {
      const completion = await client.chat.completions.create({
        model: MODEL,
        max_tokens: STRUCTURE_MAX_TOKENS,
        temperature: 0.2,
        response_format: {
          type: "json_schema",
          json_schema: STRUCTURE_NOTE_JSON_SCHEMA,
        },
        messages: [
          { role: "system", content: STRUCTURE_NOTE_SYSTEM_PROMPT },
          {
            role: "user",
            content: buildStructureUserPrompt({
              companyName,
              primaryTrade,
              crewName,
              workerFlaggedUrgent: note.workerFlaggedUrgent,
              transcript,
            }),
          },
        ],
      });

      const content = completion.choices[0]?.message?.content;
      if (!content) {
        throw new Error("Empty model response.");
      }

      const parsed = JSON.parse(content) as StructuredNoteModel;
      if (!URGENCY_VALUES.includes(parsed.urgency)) {
        parsed.urgency = note.workerFlaggedUrgent ? "high" : "medium";
      }

      let sanitized = sanitizeStructuredNote(parsed);
      if (note.workerFlaggedUrgent) {
        if (
          sanitized.urgency === "low" ||
          sanitized.urgency === "medium"
        ) {
          sanitized = { ...sanitized, urgency: "high" };
        }
      }

      await ctx.runMutation(internal.voiceNotes.applyAiStructure, {
        noteId,
        title: sanitized.title,
        summary: sanitized.summary,
        materials: sanitized.materials,
        actionItems: sanitized.actionItems,
        urgency: sanitized.urgency,
        siteAddress: sanitized.siteAddress,
        timelineNotes: sanitized.timelineNotes,
        suggestedJobUpdates: sanitized.suggestedJobUpdates,
        tags: sanitized.tags,
        confidence: sanitized.confidence,
      });
    } catch (err) {
      await ctx.runMutation(internal.voiceNotes.applyAiFailure, {
        noteId,
        error:
          err instanceof Error
            ? err.message
            : "AI structuring failed.",
      });
    }
  },
});
