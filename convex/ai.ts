"use node";

import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import OpenAI from "openai";
import { sanitizeStructuredNote, URGENCY_VALUES } from "./lib/prompts";
import {
  DEFAULT_STRUCTURE_MODEL,
  DEFAULT_TRANSCRIBE_MODEL,
  requestStructuredNote,
  transcribeAudio,
} from "./lib/openaiCalls";

/**
 * OpenAI-backed enrichment for Echo voice notes.
 *
 * Pipeline per note:
 *  1. Server-transcribe (Whisper) whenever audio exists. Browser speech
 *     recognition is a live preview only — it is unreliable on job sites and
 *     on iOS — so the server transcript becomes the primary text. Whatever
 *     the phone captured (incl. typed corrections) is kept as
 *     `deviceTranscript` and passed to the model as supporting context.
 *  2. Structure transcript into materials / actions / urgency / summary
 *
 * Requires on the Convex deployment:
 *   npx convex env set OPENAI_API_KEY sk-...
 * Optional:
 *   npx convex env set OPENAI_MODEL gpt-4o-mini
 *   npx convex env set OPENAI_TRANSCRIBE_MODEL whisper-1   (or gpt-4o-transcribe)
 */

const MODEL = process.env.OPENAI_MODEL || DEFAULT_STRUCTURE_MODEL;
const TRANSCRIBE_MODEL =
  process.env.OPENAI_TRANSCRIBE_MODEL || DEFAULT_TRANSCRIBE_MODEL;
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
    // Device text: explicit field for new notes; legacy notes only have it in
    // rawTranscript when it was never replaced by the server transcript.
    const deviceTranscript = (
      note.deviceTranscript ??
      (note.transcriptSource === "client" ? note.rawTranscript : "")
    ).trim();

    // --- Server transcription ----------------------------------------------
    // Run whenever there is audio, unless a previous attempt already produced
    // a server transcript (retries should not pay for Whisper twice) or the
    // owner corrected the transcript by hand (never overwrite their fix).
    const needsWhisper =
      !!note.audioStorageId &&
      transcriptSource !== "whisper" &&
      transcriptSource !== "manual";

    if (needsWhisper && note.audioStorageId) {
      try {
        const blob = await ctx.storage.get(note.audioStorageId);
        if (blob) {
          // The server transcript becomes primary; the device text is kept
          // in `deviceTranscript` and still shown to the model below.
          const whispered = await transcribeAudio(client, {
            audio: blob,
            fileName: `note-${noteId}`,
            mimeType: note.audioMimeType,
            model: TRANSCRIBE_MODEL,
          });
          if (whispered) {
            transcript = whispered;
            transcriptSource = "whisper";
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
      const parsed = await requestStructuredNote(client, {
        model: MODEL,
        companyName,
        primaryTrade,
        crewName,
        workerFlaggedUrgent: note.workerFlaggedUrgent,
        transcript,
        deviceNotes:
          transcriptSource === "whisper" && deviceTranscript !== transcript
            ? deviceTranscript
            : undefined,
      });
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
