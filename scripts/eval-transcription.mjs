#!/usr/bin/env node
/**
 * Compare OpenAI transcription models on real job-site recordings.
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... node scripts/eval-transcription.mjs <audio-dir> [models]
 *
 *   <audio-dir>  Folder of recordings (.webm .mp4 .m4a .mp3 .ogg .wav).
 *                Optional ground truth: put the correct transcript for
 *                `memo1.webm` in `memo1.txt` to get a word error rate (WER).
 *   [models]     Comma-separated, default:
 *                whisper-1,gpt-4o-transcribe,gpt-4o-mini-transcribe
 *
 * Writes `transcription-eval.md` into <audio-dir> with every transcript side
 * by side, latency, and WER where ground truth exists. Pick the winner, then:
 *   npx convex env set OPENAI_TRANSCRIBE_MODEL <model> --prod
 *
 * Cost: roughly $0.003–0.006 per audio minute per model.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import OpenAI, { toFile } from "openai";

const AUDIO_EXTS = new Set([".webm", ".mp4", ".m4a", ".mp3", ".ogg", ".wav"]);
const DEFAULT_MODELS = ["whisper-1", "gpt-4o-transcribe", "gpt-4o-mini-transcribe"];

const [dir, modelArg] = process.argv.slice(2);
if (!dir) {
  console.error("Usage: node scripts/eval-transcription.mjs <audio-dir> [models]");
  process.exit(1);
}
if (!process.env.OPENAI_API_KEY) {
  console.error("Set OPENAI_API_KEY first.");
  process.exit(1);
}
const models = modelArg ? modelArg.split(",").map((m) => m.trim()) : DEFAULT_MODELS;
const client = new OpenAI();

/** Lowercase, strip punctuation, split on whitespace. */
function words(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Word error rate via Levenshtein distance over words. */
function wer(reference, hypothesis) {
  const r = words(reference);
  const h = words(hypothesis);
  if (r.length === 0) return h.length === 0 ? 0 : 1;
  let prev = Array.from({ length: h.length + 1 }, (_, j) => j);
  for (let i = 1; i <= r.length; i++) {
    const cur = [i];
    for (let j = 1; j <= h.length; j++) {
      const cost = r[i - 1] === h[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[h.length] / r.length;
}

const files = (await readdir(dir))
  .filter((f) => AUDIO_EXTS.has(extname(f).toLowerCase()))
  .sort();
if (files.length === 0) {
  console.error(`No audio files found in ${dir}`);
  process.exit(1);
}

const totals = Object.fromEntries(models.map((m) => [m, { wer: 0, n: 0, ms: 0 }]));
const sections = [];

for (const file of files) {
  const audio = await readFile(join(dir, file));
  let truth = null;
  try {
    truth = await readFile(join(dir, `${basename(file, extname(file))}.txt`), "utf8");
  } catch {
    /* no ground truth for this file */
  }

  const rows = [];
  for (const model of models) {
    const started = Date.now();
    let text;
    try {
      const result = await client.audio.transcriptions.create({
        file: await toFile(audio, file),
        model,
      });
      text = (result.text ?? "").trim();
    } catch (err) {
      text = `ERROR: ${err instanceof Error ? err.message : String(err)}`;
    }
    const ms = Date.now() - started;
    totals[model].ms += ms;
    let score = "";
    if (truth && !text.startsWith("ERROR:")) {
      const w = wer(truth, text);
      totals[model].wer += w;
      totals[model].n += 1;
      score = `${(w * 100).toFixed(1)}%`;
    }
    rows.push({ model, ms, score, text });
    console.log(`${file} · ${model} · ${ms}ms${score ? ` · WER ${score}` : ""}`);
  }

  sections.push(
    [
      `## ${file}`,
      truth ? `**Ground truth:** ${truth.trim()}\n` : "",
      "| Model | Latency | WER | Transcript |",
      "| --- | --- | --- | --- |",
      ...rows.map(
        (r) => `| ${r.model} | ${r.ms} ms | ${r.score || "—"} | ${r.text.replace(/\|/g, "\\|").replace(/\n/g, " ")} |`,
      ),
    ].join("\n"),
  );
}

const summary = [
  "# Transcription model comparison",
  "",
  `${files.length} recordings · ${new Date().toISOString()}`,
  "",
  "| Model | Avg latency | Avg WER (files with ground truth) |",
  "| --- | --- | --- |",
  ...models.map((m) => {
    const t = totals[m];
    const avgWer = t.n ? `${((t.wer / t.n) * 100).toFixed(1)}% (n=${t.n})` : "—";
    return `| ${m} | ${Math.round(t.ms / files.length)} ms | ${avgWer} |`;
  }),
  "",
  ...sections,
  "",
].join("\n");

const out = join(dir, "transcription-eval.md");
await writeFile(out, summary);
console.log(`\nWrote ${out}`);
