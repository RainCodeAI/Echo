import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import OpenAI from "openai";
import {
  STRUCTURE_MAX_TOKENS,
  mimeToExtension,
  requestStructuredNote,
  transcribeAudio,
} from "../convex/lib/openaiCalls";

/**
 * Exercises the real OpenAI SDK against a local mock server, so SDK upgrades
 * are verified at the HTTP level (paths, payload shape, response parsing)
 * without an API key or network access.
 */

type Captured = { path: string; contentType: string; body: Buffer };
let captured: Captured[] = [];
let nextResponse: unknown = {};

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

let server: Server;
let client: OpenAI;

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const body = await readBody(req);
    captured.push({
      path: req.url ?? "",
      contentType: req.headers["content-type"] ?? "",
      body,
    });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(nextResponse));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  client = new OpenAI({
    apiKey: "sk-test",
    baseURL: `http://127.0.0.1:${port}/v1`,
    maxRetries: 0,
  });
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => {
  captured = [];
  nextResponse = {};
});

function completion(
  content: string | null,
  extra: { finish_reason?: string; refusal?: string | null } = {},
) {
  return {
    id: "chatcmpl-test",
    object: "chat.completion",
    created: 0,
    model: "gpt-4o-mini",
    choices: [
      {
        index: 0,
        finish_reason: extra.finish_reason ?? "stop",
        logprobs: null,
        message: {
          role: "assistant",
          content,
          refusal: extra.refusal ?? null,
        },
      },
    ],
  };
}

const VALID_NOTE = {
  title: "North slope shingles",
  summary: "Need shingles.",
  materials: [{ name: "Shingles", quantity: "2", unit: "bundles", notes: "" }],
  actionItems: [],
  urgency: "medium",
  siteAddress: "",
  timelineNotes: "",
  suggestedJobUpdates: [],
  tags: ["materials_needed"],
  confidence: 0.8,
};

describe("transcribeAudio", () => {
  it("posts multipart audio without a forced language and trims the text", async () => {
    nextResponse = { text: "  necesitamos dos paquetes de tejas  " };
    const text = await transcribeAudio(client, {
      audio: new Blob([new Uint8Array([1, 2, 3])], { type: "audio/mp4" }),
      fileName: "note-abc",
      mimeType: "audio/mp4",
    });

    expect(text).toBe("necesitamos dos paquetes de tejas");
    expect(captured).toHaveLength(1);
    const req = captured[0];
    expect(req.path).toBe("/v1/audio/transcriptions");
    expect(req.contentType).toContain("multipart/form-data");
    const body = req.body.toString("latin1");
    expect(body).toContain('name="model"');
    expect(body).toContain("whisper-1");
    expect(body).toContain('filename="note-abc.mp4"');
    expect(body).not.toContain('name="language"');
  });

  it("uses an overridden transcription model", async () => {
    nextResponse = { text: "ok" };
    await transcribeAudio(client, {
      audio: new Blob([new Uint8Array([1])]),
      fileName: "n",
      model: "gpt-4o-transcribe",
    });
    expect(captured[0].body.toString("latin1")).toContain("gpt-4o-transcribe");
  });
});

describe("requestStructuredNote", () => {
  const input = {
    companyName: "Acme Roofing",
    transcript: "Need two bundles of shingles for the north slope.",
    deviceNotes: "gate code 4412",
  };

  it("sends a strict json_schema request and parses the result", async () => {
    nextResponse = completion(JSON.stringify(VALID_NOTE));
    const parsed = await requestStructuredNote(client, input);
    expect(parsed.title).toBe("North slope shingles");

    const req = captured[0];
    expect(req.path).toBe("/v1/chat/completions");
    const body = JSON.parse(req.body.toString("utf8"));
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.max_completion_tokens).toBe(STRUCTURE_MAX_TOKENS);
    expect(body.max_tokens).toBeUndefined();
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[1].content).toContain("north slope");
    expect(body.messages[1].content).toContain("gate code 4412");
  });

  it("explains truncated output instead of failing JSON.parse", async () => {
    nextResponse = completion('{"title": "cut', { finish_reason: "length" });
    await expect(requestStructuredNote(client, input)).rejects.toThrow(
      /cut off/,
    );
  });

  it("surfaces refusals", async () => {
    nextResponse = completion(null, { refusal: "I can't help with that." });
    await expect(requestStructuredNote(client, input)).rejects.toThrow(
      /declined/,
    );
  });

  it("reports malformed JSON clearly", async () => {
    nextResponse = completion("not json");
    await expect(requestStructuredNote(client, input)).rejects.toThrow(
      /malformed JSON/,
    );
  });
});

describe("mimeToExtension", () => {
  it("maps recorder mime types to Whisper-accepted extensions", () => {
    expect(mimeToExtension("audio/webm;codecs=opus")).toBe("webm");
    expect(mimeToExtension("audio/mp4")).toBe("mp4");
    expect(mimeToExtension("audio/ogg;codecs=opus")).toBe("ogg");
    expect(mimeToExtension(undefined)).toBe("webm");
  });
});
