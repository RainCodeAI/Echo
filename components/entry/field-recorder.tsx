"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation } from "convex/react";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Mic,
  Square,
  Type,
} from "lucide-react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { formatDurationShort } from "@/lib/utils";
import {
  getSpeechRecognitionConstructor,
  pickRecorderMimeType,
  type BrowserSpeechRecognition,
} from "@/lib/speech";

export type VerifiedFieldMember = {
  id: Id<"teamMembers">;
  name: string;
  verificationToken: string;
};

type FieldRecorderProps = {
  companyId: Id<"companies">;
  companyName: string;
  member: VerifiedFieldMember;
  onSwitchUser: () => void;
};

type Phase = "ready" | "recording" | "review" | "submitting" | "done";

export function FieldRecorder({
  companyId,
  companyName,
  member,
  onSwitchUser,
}: FieldRecorderProps) {
  const generateUploadUrl = useMutation(api.voiceNotes.generateFieldUploadUrl);
  const createNote = useMutation(api.voiceNotes.createFromField);

  const [phase, setPhase] = useState<Phase>("ready");
  const [transcript, setTranscript] = useState("");
  const [interim, setInterim] = useState("");
  const [speechSupported, setSpeechSupported] = useState(true);
  const [urgent, setUrgent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioMimeType, setAudioMimeType] = useState<string | undefined>();
  const [submittedId, setSubmittedId] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const startedAtRef = useRef<number>(0);
  const tickRef = useRef<number | null>(null);
  const finalTranscriptRef = useRef("");
  const clientUploadIdRef = useRef(
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `upload-${Date.now()}`,
  );

  useEffect(() => {
    setSpeechSupported(!!getSpeechRecognitionConstructor());
  }, []);

  const stopStreams = useCallback(() => {
    if (tickRef.current) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
    try {
      recognitionRef.current?.stop();
    } catch {
      /* ignore */
    }
    recognitionRef.current = null;
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => () => stopStreams(), [stopStreams]);

  async function startRecording() {
    setError(null);
    setTranscript("");
    setInterim("");
    setAudioBlob(null);
    finalTranscriptRef.current = "";
    clientUploadIdRef.current =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `upload-${Date.now()}`;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = pickRecorderMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      chunksRef.current = [];
      setAudioMimeType(recorder.mimeType || mimeType);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const type = recorder.mimeType || mimeType || "audio/webm";
        setAudioBlob(new Blob(chunksRef.current, { type }));
        setAudioMimeType(type);
      };
      mediaRecorderRef.current = recorder;
      recorder.start(250);

      const SpeechRecognition = getSpeechRecognitionConstructor();
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = "en-US";
        recognition.onresult = (event) => {
          let interimText = "";
          let finalChunk = "";
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const result = event.results[i];
            const text = result[0]?.transcript ?? "";
            if (result.isFinal) finalChunk += text;
            else interimText += text;
          }
          if (finalChunk) {
            finalTranscriptRef.current = `${finalTranscriptRef.current} ${finalChunk}`.trim();
            setTranscript(finalTranscriptRef.current);
          }
          setInterim(interimText);
        };
        recognition.onerror = () => {
          // Speech is best-effort; recording continues.
        };
        recognition.onend = () => {
          // Restart while still recording (some browsers stop after pauses).
          if (mediaRecorderRef.current?.state === "recording") {
            try {
              recognition.start();
            } catch {
              /* ignore */
            }
          }
        };
        recognitionRef.current = recognition;
        try {
          recognition.start();
        } catch {
          setSpeechSupported(false);
        }
      } else {
        setSpeechSupported(false);
      }

      startedAtRef.current = Date.now();
      setElapsedMs(0);
      tickRef.current = window.setInterval(() => {
        setElapsedMs(Date.now() - startedAtRef.current);
      }, 250);
      setPhase("recording");
    } catch {
      setError(
        "Microphone access is required to record. Check browser permissions and try again.",
      );
      stopStreams();
    }
  }

  function stopRecording() {
    const duration = Date.now() - startedAtRef.current;
    setElapsedMs(duration);
    if (tickRef.current) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
    try {
      recognitionRef.current?.stop();
    } catch {
      /* ignore */
    }
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setInterim("");
    setTranscript(finalTranscriptRef.current);
    setPhase("review");
  }

  async function handleSubmit() {
    const text = transcript.trim();
    if (!text && !audioBlob) {
      setError("Record something or type a short note before submitting.");
      return;
    }

    setPhase("submitting");
    setError(null);

    try {
      let audioStorageId: Id<"_storage"> | undefined;
      if (audioBlob && audioBlob.size > 0) {
        const uploadUrl = await generateUploadUrl({
          companyId,
          teamMemberId: member.id,
          verificationToken: member.verificationToken,
        });
        const response = await fetch(uploadUrl, {
          method: "POST",
          headers: {
            "Content-Type": audioMimeType || audioBlob.type || "audio/webm",
          },
          body: audioBlob,
        });
        if (!response.ok) {
          throw new Error("Audio upload failed. Check your connection and retry.");
        }
        const json = (await response.json()) as { storageId: Id<"_storage"> };
        audioStorageId = json.storageId;
      }

      const noteId = await createNote({
        companyId,
        teamMemberId: member.id,
        verificationToken: member.verificationToken,
        rawTranscript: text,
        clientUploadId: clientUploadIdRef.current,
        audioStorageId,
        audioMimeType: audioStorageId ? audioMimeType : undefined,
        audioDurationMs: elapsedMs || undefined,
        workerFlaggedUrgent: urgent,
        recordedAt: startedAtRef.current || Date.now(),
      });

      setSubmittedId(noteId);
      setPhase("done");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Submit failed. Your draft is still here — try again.",
      );
      setPhase("review");
    }
  }

  function resetForAnother() {
    stopStreams();
    setPhase("ready");
    setTranscript("");
    setInterim("");
    setAudioBlob(null);
    setUrgent(false);
    setError(null);
    setElapsedMs(0);
    setSubmittedId(null);
    finalTranscriptRef.current = "";
  }

  if (phase === "done") {
    return (
      <div className="space-y-6 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/15 text-primary">
          <CheckCircle2 className="h-9 w-9" />
        </div>
        <div className="space-y-2">
          <h2 className="text-2xl font-semibold">Saved, {member.name}</h2>
          <p className="text-sm text-muted-foreground">
            Your field note is on {companyName}&apos;s dashboard. AI structuring
            will enrich it next.
          </p>
          {submittedId ? (
            <p className="font-mono text-[10px] text-muted-foreground">
              {submittedId}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button type="button" onClick={resetForAnother}>
            Record another
          </Button>
          <Button type="button" variant="outline" onClick={onSwitchUser}>
            Switch user
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <p className="text-sm text-muted-foreground">{companyName}</p>
        <h2 className="text-xl font-semibold">Hi, {member.name}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Record a voice note from the job site.
        </p>
      </div>

      {/* Record control */}
      <div className="flex flex-col items-center gap-3 py-2">
        {phase === "recording" ? (
          <button
            type="button"
            onClick={stopRecording}
            className="flex h-28 w-28 flex-col items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-lg animate-pulse-record"
            aria-label="Stop recording"
          >
            <Square className="h-8 w-8 fill-current" />
            <span className="mt-1 text-xs font-medium">
              {formatDurationShort(elapsedMs)}
            </span>
          </button>
        ) : (
          <button
            type="button"
            onClick={startRecording}
            disabled={phase === "submitting"}
            className="flex h-28 w-28 flex-col items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition hover:bg-primary/90 disabled:opacity-50"
            aria-label="Start recording"
          >
            <Mic className="h-10 w-10" />
            <span className="mt-1 text-xs font-medium">
              {phase === "review" ? "Re-record" : "Record"}
            </span>
          </button>
        )}
        <p className="text-xs text-muted-foreground">
          {phase === "recording"
            ? "Listening… tap to stop"
            : phase === "review"
              ? "Review below, then submit"
              : "Tap the green button and speak"}
        </p>
      </div>

      {/* Transcript */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="transcript" className="flex items-center gap-1.5">
            <Type className="h-3.5 w-3.5" />
            Transcript
          </Label>
          {!speechSupported ? (
            <span className="text-[11px] text-amber-700">
              Live speech unavailable — type or rely on audio
            </span>
          ) : null}
        </div>
        <textarea
          id="transcript"
          value={
            phase === "recording"
              ? [transcript, interim].filter(Boolean).join(" ")
              : transcript
          }
          onChange={(e) => {
            if (phase === "recording") return;
            setTranscript(e.target.value);
            finalTranscriptRef.current = e.target.value;
          }}
          readOnly={phase === "recording" || phase === "submitting"}
          rows={5}
          placeholder="What you say will appear here…"
          className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
        />
        {audioBlob && phase !== "recording" ? (
          <p className="text-xs text-muted-foreground">
            Audio attached ({Math.round(audioBlob.size / 1024)} KB
            {elapsedMs ? ` · ${formatDurationShort(elapsedMs)}` : ""})
          </p>
        ) : null}
      </div>

      <label className="flex items-start gap-3 rounded-lg border bg-muted/30 px-3 py-3">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 rounded border-input"
          checked={urgent}
          disabled={phase === "submitting" || phase === "recording"}
          onChange={(e) => setUrgent(e.target.checked)}
        />
        <div>
          <div className="flex items-center gap-1.5 text-sm font-medium">
            <AlertTriangle className="h-3.5 w-3.5 text-orange-600" />
            Flag as urgent
          </div>
          <p className="text-xs text-muted-foreground">
            Surfaces this note for the owner right away.
          </p>
        </div>
      </label>

      {error ? (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <Button
          type="button"
          size="lg"
          className="w-full"
          disabled={
            phase === "recording" ||
            phase === "submitting" ||
            phase === "ready" ||
            (!transcript.trim() && !audioBlob)
          }
          onClick={handleSubmit}
        >
          {phase === "submitting" ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving…
            </>
          ) : (
            "Submit note"
          )}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={phase === "submitting" || phase === "recording"}
          onClick={onSwitchUser}
        >
          Not {member.name}? Switch user
        </Button>
      </div>
    </div>
  );
}
