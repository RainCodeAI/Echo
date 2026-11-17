/**
 * Serves the built fixture pages for Playwright, plus a mock Convex HTTP
 * backend used by the crew (field entry) fixture, whose fake client forwards
 * calls to /api/<function>. Tests read and set the mock's state over HTTP:
 *   GET /__state · POST /__state (merge JSON) · POST /__reset
 */
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, ".out");
const port = Number(process.env.BROWSER_TEST_PORT ?? 4700);

const fresh = () => ({
  uploads: {},
  notes: [],
  createCalls: [],
  mode: "ok",
  uploadSeq: 0,
  noticeAcked: true,
  ackCalls: [],
  pinAttempts: [],
  jobsDown: false,
});
let state = fresh();

const readBody = (req) =>
  new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
const json = (res, obj) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
};
const page = (name) =>
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/${name}.js"></script></body></html>`;

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const body = await readBody(req);
  const p = url.pathname;

  // --- test control ---------------------------------------------------------
  if (p === "/__state" && req.method === "GET") return json(res, state);
  if (p === "/__state" && req.method === "POST") {
    state = { ...state, ...JSON.parse(body.toString() || "{}") };
    return json(res, state);
  }
  if (p === "/__reset") {
    state = fresh();
    return json(res, state);
  }

  // --- static -----------------------------------------------------------------
  if (p.endsWith(".html")) {
    res.writeHead(200, { "content-type": "text/html" });
    return res.end(page(p.slice(1, -".html".length)));
  }
  if (p.endsWith(".js") || p === "/app.css") {
    const file = join(out, p.slice(1));
    if (!existsSync(file)) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { "content-type": p.endsWith(".js") ? "text/javascript" : "text/css" });
    return res.end(readFileSync(file));
  }
  if (p.startsWith("/media/")) {
    res.writeHead(200, { "content-type": "audio/webm" });
    return res.end(Buffer.from([9, 8, 7]));
  }

  // --- mock Convex backend for the crew page --------------------------------
  if (p === "/upload") {
    const id = `storage-${++state.uploadSeq}`;
    state.uploads[id] = { bytes: body.length, type: req.headers["content-type"] };
    return json(res, { storageId: id });
  }
  if (p === "/api/teamMembers:verifyPin") {
    const { pin } = JSON.parse(body);
    state.pinAttempts.push(pin);
    if (pin !== "1234" && pin !== "123456") return json(res, { result: { ok: false, error: "Incorrect PIN." } });
    return json(res, {
      result: {
        ok: true,
        member: { id: "member1", name: "Luis", role: null },
        companyName: "Acme Roofing",
        verificationToken: `echo-entry:company1:member1:${Date.now()}:sig`,
        needsNotice: !state.noticeAcked,
      },
    });
  }
  if (p === "/api/teamMembers:noticeStatus") return json(res, { result: { needsNotice: !state.noticeAcked } });
  if (p === "/api/teamMembers:acknowledgeNotice") {
    state.ackCalls.push(JSON.parse(body));
    state.noticeAcked = true;
    return json(res, { result: null });
  }
  if (p === "/api/jobs:listForField") {
    if (state.jobsDown) {
      req.socket.destroy();
      return;
    }
    const now = Date.now();
    return json(res, {
      result: {
        today: [
          { id: "job-running", title: "Ramirez reroof", status: "in_progress", scheduledFor: null, address: "412 Oak St" },
          { id: "job-pm", title: "Chen gutter install", status: "scheduled", scheduledFor: now + 3 * 3600_000, address: "9 Elm Ave" },
        ],
        other: [{ id: "job-next", title: "Patel deck repair", status: "scheduled", scheduledFor: now + 5 * 86400_000, address: null }],
      },
    });
  }
  if (p === "/api/voiceNotes:generateFieldUploadUrl") return json(res, { result: `http://127.0.0.1:${port}/upload` });
  if (p === "/api/voiceNotes:createFromField") {
    const args = JSON.parse(body);
    state.createCalls.push({ ...args, mode: state.mode });
    if (state.mode === "expired") return json(res, { error: "Session expired or invalid. Re-enter your PIN." });
    if (state.mode === "lose-response") {
      // The server stores the note but the response is lost (connection drop).
      if (!state.notes.find((n) => n.clientUploadId === args.clientUploadId)) state.notes.push(args);
      state.mode = "ok";
      req.socket.destroy();
      return;
    }
    // Idempotent on clientUploadId, like the real mutation.
    if (!state.notes.find((n) => n.clientUploadId === args.clientUploadId)) state.notes.push(args);
    return json(res, { result: `note-${state.notes.length}` });
  }
  res.writeHead(404);
  res.end();
}).listen(port, "127.0.0.1", () => console.log(`browser-test server on ${port}`));
