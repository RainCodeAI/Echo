import { execFileSync } from "node:child_process";

/** Run a Convex function on the local E2E deployment and parse its JSON result. */
export function convexRun<T>(fn: string, args: Record<string, unknown> = {}): T {
  const out = execFileSync("npx", ["convex", "run", fn, JSON.stringify(args)], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  // The CLI prints the return value as JSON (possibly after a status line).
  const start = out.search(/[[{"]/);
  return JSON.parse(out.slice(start)) as T;
}

export type Seed = { companyId: string; jobId: string; pin: string };
export type E2ENote = {
  id: string;
  rawTranscript: string;
  jobId: string | null;
  hasAudio: boolean;
  audioMimeType: string | null;
  teamMemberId: string | null;
  status: string;
  aiStatus: string;
  aiErrorMessage: string | null;
  clientUploadId: string | null;
};
