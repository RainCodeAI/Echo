import type OpenAI from "openai";
import {
  STRUCTURE_NOTE_JSON_SCHEMA,
  STRUCTURE_NOTE_SYSTEM_PROMPT,
  buildStructureUserPrompt,
  type StructuredNoteModel,
} from "./prompts";

/**
 * The two OpenAI calls Echo makes, isolated from the Convex action so they can
 * be tested against a mock OpenAI server (see tests/openai-calls.test.ts).
 *
 * Type-only import of `openai`: this module is bundled by Convex, and only the
 * "use node" action (convex/ai.ts) should pull in the SDK at runtime.
 */

/** Default transcription model; override with OPENAI_TRANSCRIBE_MODEL. */
export const DEFAULT_TRANSCRIBE_MODEL = "whisper-1";
/** Default structuring model; override with OPENAI_MODEL. */
export const DEFAULT_STRUCTURE_MODEL = "gpt-4o-mini";
/**
 * Output budget for the structured JSON. 900 truncated long memos with many
 * materials, which surfaced as an opaque JSON parse error.
 */
export const STRUCTURE_MAX_TOKENS = 2_000;

export function mimeToExtension(mime?: string): string {
  if (!mime) return "webm";
  if (mime.includes("mp4") || mime.includes("m4a")) return "mp4";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("wav")) return "wav";
  return "webm";
}

/**
 * Server-side transcription. No `language` hint: auto-detect so Spanish (and
 * other) memos transcribe correctly instead of being forced through English.
 */
export async function transcribeAudio(
  client: OpenAI,
  input: { audio: Blob; fileName: string; mimeType?: string; model?: string },
): Promise<string> {
  const ext = mimeToExtension(input.mimeType);
  const file = new File([input.audio], `${input.fileName}.${ext}`, {
    type: input.mimeType || "audio/webm",
  });
  const result = await client.audio.transcriptions.create({
    file,
    model: input.model || DEFAULT_TRANSCRIBE_MODEL,
  });
  return (result.text ?? "").trim();
}

/** Ask the model for the structured note JSON. Throws with an owner-readable message. */
export async function requestStructuredNote(
  client: OpenAI,
  input: Parameters<typeof buildStructureUserPrompt>[0] & { model?: string },
): Promise<StructuredNoteModel> {
  const { model, ...promptInput } = input;
  const completion = await client.chat.completions.create({
    model: model || DEFAULT_STRUCTURE_MODEL,
    // `max_completion_tokens` works on both classic and reasoning models;
    // `max_tokens` is rejected by newer OpenAI models.
    max_completion_tokens: STRUCTURE_MAX_TOKENS,
    temperature: 0.2,
    response_format: {
      type: "json_schema",
      json_schema: STRUCTURE_NOTE_JSON_SCHEMA,
    },
    messages: [
      { role: "system", content: STRUCTURE_NOTE_SYSTEM_PROMPT },
      { role: "user", content: buildStructureUserPrompt(promptInput) },
    ],
  });

  const choice = completion.choices[0];
  if (choice?.finish_reason === "length") {
    throw new Error(
      "AI output was cut off (memo too long to structure in one pass). Retry, or split long memos.",
    );
  }
  if (choice?.message?.refusal) {
    throw new Error(
      `AI declined to structure this note: ${choice.message.refusal}`,
    );
  }
  const content = choice?.message?.content;
  if (!content) {
    throw new Error("Empty model response.");
  }
  try {
    return JSON.parse(content) as StructuredNoteModel;
  } catch {
    throw new Error("AI returned malformed JSON. Retry the note.");
  }
}
