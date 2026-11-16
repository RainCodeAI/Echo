"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CloudOff,
  ImagePlus,
  Loader2,
  Mic,
  Square,
  Type,
  X,
} from "lucide-react";

import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { formatDurationShort } from "@/lib/utils";
import {
  getSpeechRecognitionConstructor,
  pickRecorderMimeType,
  type BrowserSpeechRecognition,
} from "@/lib/speech";
import { createQueuedNote } from "@/lib/offline/queue";
import {
  deleteDraft,
  draftKey,
  loadDraft,
  saveDraft,
} from "@/lib/offline/drafts";
import {
  requestPersistentStorage,
  useFieldQueue,
} from "@/components/entry/field-queue-provider";
import { FieldQueueStatus } from "@/components/entry/field-queue-status";

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

/** Auto-stop long recordings so blobs stay under the server cap. */
const MAX_RECORDING_MS = 10 * 60 * 1000;
/** Mirror of the server-side cap (Whisper also refuses files over 25 MB). */
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
/** Photo limits (mirror the server-side caps in convex/voiceNotes.ts). */
const MAX_PHOTOS = 6;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

type AttachedPhoto = { file: File; url: string };

export function FieldRecorder({
  companyId,
  companyName,
  member,
  onSwitchUser,
}: FieldRecorderProps) {
  const { runner, snapshot } = useFieldQueue();
  const draftStorageKey = draftKey(companyId, member.id);

  const [phase, setPhase] = useState<Phase>("ready");
  const [transcript, setTranscript] = useState("");
  const [interim, setInterim] = useState("");
  const [speechSupported, setSpeechSupported] = useState(true);
  const [urgent, setUrgent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [restoredDraft, setRestoredDraft] = useState(false);
  const [audioMimeType, setAudioMimeType] = useState<string | undefined>();
  const [photos, setPhotos] = useState<AttachedPhoto[]>([]);
  /** clientUploadId of the note just submitted (its send status is shown). */
  const [submittedUploadId, setSubmittedUploadId] = useState<string | null>(
    null,
  );

  const photoInputRef = useRef<HTMLInputElement | null>(null);

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

  // Restore an unsubmitted recording (reload, crash, phone killed the tab).
  useEffect(() => {
    let cancelled = false;
    void loadDraft(draftStorageKey).then((draft) => {
      if (cancelled || !draft) return;
      if (!draft.audio && !draft.transcript.trim() && draft.photos.length === 0) {
        return;
      }
      clientUploadIdRef.current = draft.clientUploadId;
      startedAtRef.current = draft.recordedAt;
      finalTranscriptRef.current = draft.transcript;
      setTranscript(draft.transcript);
      setAudioBlob(draft.audio ?? null);
      setAudioMimeType(draft.audioMimeType);
      setElapsedMs(draft.audioDurationMs ?? 0);
      setUrgent(draft.workerFlaggedUrgent);
      setPhotos(
        draft.photos.map((p) => {
          const file = new File([p.blob], p.name, { type: p.mimeType ?? p.blob.type });
          return { file, url: URL.createObjectURL(file) };
        }),
      );
      setRestoredDraft(true);
      setPhase((current) => (current === "ready" ? "review" : current));
    });
    return () => {
      cancelled = true;
    };
  }, [draftStorageKey]);

  // Save the unsubmitted recording to the phone whenever it changes.
  useEffect(() => {
    if (phase !== "review") return;
    if (!audioBlob && !transcript.trim() && photos.length === 0) return;
    const timer = window.setTimeout(() => {
      void saveDraft({
        key: draftStorageKey,
        clientUploadId: clientUploadIdRef.current,
        transcript,
        audio: audioBlob ?? undefined,
        audioMimeType,
        audioDurationMs: elapsedMs || undefined,
        photos: photos.map((p) => ({
          blob: p.file,
          name: p.file.name,
          mimeType: p.file.type || undefined,
        })),
        workerFlaggedUrgent: urgent,
        recordedAt: startedAtRef.current || Date.now(),
        savedAt: Date.now(),
      });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [
    phase,
    transcript,
    audioBlob,
    audioMimeType,
    elapsedMs,
    photos,
    urgent,
    draftStorageKey,
  ]);

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

  // Revoke any outstanding object URLs when the component unmounts.
  useEffect(
    () => () => {
      photos.forEach((p) => URL.revokeObjectURL(p.url));
    },
    // Cleanup reads the latest `photos` via closure only on unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  function addPhotos(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setError(null);
    const incoming = Array.from(fileList).filter((f) =>
      f.type.startsWith("image/"),
    );
    const accepted: AttachedPhoto[] = [];
    for (const file of incoming) {
      if (file.size > MAX_PHOTO_BYTES) {
        setError(
          `A photo is too large (max ${Math.round(
            MAX_PHOTO_BYTES / (1024 * 1024),
          )} MB).`,
        );
        continue;
      }
      accepted.push({ file, url: URL.createObjectURL(file) });
    }
    setPhotos((current) => {
      const room = MAX_PHOTOS - current.length;
      if (room <= 0) {
        setError(`You can attach at most ${MAX_PHOTOS} photos.`);
        accepted.forEach((p) => URL.revokeObjectURL(p.url));
        return current;
      }
      const toAdd = accepted.slice(0, room);
      accepted.slice(room).forEach((p) => URL.revokeObjectURL(p.url));
      return [...current, ...toAdd];
    });
  }

  function removePhoto(index: number) {
    setPhotos((current) => {
      const next = current.filter((_, i) => i !== index);
      const removed = current[index];
      if (removed) {
        URL.revokeObjectURL(removed.url);
      }
      return next;
    });
  }

  function clearPhotos() {
    setPhotos((current) => {
      current.forEach((p) => URL.revokeObjectURL(p.url));
      return [];
    });
  }

  async function startRecording() {
    setError(null);
    setTranscript("");
    setInterim("");
    setAudioBlob(null);
    finalTranscriptRef.current = "";
    setRestoredDraft(false);
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
        const elapsed = Date.now() - startedAtRef.current;
        setElapsedMs(elapsed);
        // Stop automatically at the max length so the blob stays under cap.
        if (elapsed >= MAX_RECORDING_MS) {
          stopRecording();
        }
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

    if (audioBlob && audioBlob.size > MAX_AUDIO_BYTES) {
      setError(
        `Recording is too large (max ${Math.round(
          MAX_AUDIO_BYTES / (1024 * 1024),
        )} MB). Re-record a shorter memo.`,
      );
      return;
    }

    setPhase("submitting");
    setError(null);

    // Save to the phone first; sending happens in the background and keeps
    // retrying through dead zones, reloads and expired sessions.
    const item = createQueuedNote({
      clientUploadId: clientUploadIdRef.current,
      companyId,
      teamMemberId: member.id,
      memberName: member.name,
      transcript: text,
      audio: audioBlob,
      audioMimeType,
      audioDurationMs: elapsedMs || undefined,
      photos: photos.map((p) => ({
        blob: p.file,
        mimeType: p.file.type || undefined,
      })),
      workerFlaggedUrgent: urgent,
      recordedAt: startedAtRef.current || Date.now(),
      now: Date.now(),
    });

    try {
      requestPersistentStorage();
      await runner.enqueue(item);
      await deleteDraft(draftStorageKey);
      setSubmittedUploadId(item.clientUploadId);
      setPhase("done");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Couldn't save the note on this phone. Your draft is still here — try again.",
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
    clearPhotos();
    setUrgent(false);
    setError(null);
    setElapsedMs(0);
    setSubmittedUploadId(null);
    setRestoredDraft(false);
    startedAtRef.current = 0;
    finalTranscriptRef.current = "";
    clientUploadIdRef.current =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `upload-${Date.now()}`;
  }

  if (phase === "done") {
    const sentNoteId = submittedUploadId
      ? snapshot.sent[submittedUploadId]
      : undefined;
    const queued = snapshot.items.find(
      (i) => i.clientUploadId === submittedUploadId,
    );
    const failed = queued?.status === "failed";
    return (
      <div className="space-y-6 text-center" data-testid="field-done">
        <div
          className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full ${
            failed
              ? "bg-destructive/15 text-destructive"
              : sentNoteId
                ? "bg-primary/15 text-primary"
                : "bg-amber-100 text-amber-700"
          }`}
        >
          {failed ? (
            <AlertTriangle className="h-9 w-9" />
          ) : sentNoteId ? (
            <CheckCircle2 className="h-9 w-9" />
          ) : (
            <CloudOff className="h-9 w-9" />
          )}
        </div>
        <div className="space-y-2">
          <h2 className="text-2xl font-semibold" data-testid="field-done-title">
            {failed
              ? "Couldn't send this note"
              : sentNoteId
                ? `Sent, ${member.name}`
                : "Saved on this phone"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {failed
              ? queued?.lastError
              : sentNoteId
                ? `Your field note is on ${companyName}'s dashboard. AI structuring will enrich it next.`
                : "It will send to the office automatically when you have signal — even if you close this page and come back later."}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button type="button" onClick={resetForAnother}>
            Record another
          </Button>
          <Button type="button" variant="outline" onClick={onSwitchUser}>
            Switch user
          </Button>
        </div>
        <div className="text-left">
          <FieldQueueStatus />
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

      {restoredDraft && phase === "review" ? (
        <p className="rounded-md bg-primary/10 px-3 py-2 text-sm text-primary" data-testid="draft-restored">
          Restored your unsent recording. Review it, then submit.
        </p>
      ) : null}

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

      {/* Photos */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Label className="flex items-center gap-1.5">
            <ImagePlus className="h-3.5 w-3.5" />
            Photos
          </Label>
          <span className="text-[11px] text-muted-foreground">
            {photos.length}/{MAX_PHOTOS}
          </span>
        </div>
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            addPhotos(e.target.files);
            e.target.value = "";
          }}
        />
        <div className="flex flex-wrap gap-2">
          {photos.map((photo, index) => (
            <div
              key={photo.url}
              className="relative h-20 w-20 overflow-hidden rounded-lg border bg-muted"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photo.url}
                alt={`Attached photo ${index + 1}`}
                className="h-full w-full object-cover"
              />
              <button
                type="button"
                onClick={() => removePhoto(index)}
                disabled={phase === "submitting"}
                aria-label={`Remove photo ${index + 1}`}
                className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          {photos.length < MAX_PHOTOS ? (
            <button
              type="button"
              onClick={() => photoInputRef.current?.click()}
              disabled={phase === "recording" || phase === "submitting"}
              className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-xs text-muted-foreground hover:bg-muted/40 disabled:opacity-50"
            >
              <ImagePlus className="h-5 w-5" />
              Add
            </button>
          ) : null}
        </div>
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

      <FieldQueueStatus />

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
