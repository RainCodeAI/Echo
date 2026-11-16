import { createRoot } from "react-dom/client";
import { ConvexProvider } from "convex/react";
import { getFunctionName } from "convex/server";
import { NoteAiPanel } from "@/components/notes/note-ai-panel";
import { NoteAiRetryButton } from "@/components/notes/note-ai-retry-button";
import { NoteTranscriptEditor } from "@/components/notes/note-transcript-editor";
import { Card, CardContent } from "@/components/ui/card";
import type { Id } from "@/convex/_generated/dataModel";

const calls: { name: string; args: unknown }[] = [];
(window as unknown as { __calls: typeof calls }).__calls = calls;
const fakeClient = {
  // Queries (e.g. the assignee list) resolve to "loading".
  watchQuery() {
    return { localQueryResult: () => undefined, onUpdate: () => () => {} };
  },
  async mutation(ref: unknown, args: unknown) {
    calls.push({ name: getFunctionName(ref as never), args });
    return "ok";
  },
};
const noteId = "note1" as Id<"voiceNotes">;

createRoot(document.getElementById("root")!).render(
  <ConvexProvider client={fakeClient as never}>
    <div className="mx-auto max-w-3xl space-y-6 p-4">
      <Card>
        <CardContent className="pt-6">
          <NoteTranscriptEditor
            noteId={noteId}
            rawTranscript="North valley is leaking, need three bundles of shingles and drip edge. Customer Ramirez wants it done by Friday."
            transcriptSource="whisper"
            hasAudio
          />
        </CardContent>
      </Card>
      <NoteAiPanel
        noteId={noteId}
        ownerEditedFields={["title", "urgency"]}
        aiStatus="completed"
        aiTitle="North valley leak — shingles needed"
        aiSummary="Active leak at the north valley. Crew needs shingles and drip edge; customer wants completion by Friday."
        materials={[
          { name: "Architectural shingles", quantity: "3", unit: "bundles" },
          { name: "Drip edge", quantity: "4", unit: "pieces", notes: "white" },
        ]}
        actionItems={[
          { title: "Order shingles from supplier", priority: "high", assigneeHint: "Office", dueHint: "today" },
          { title: "Confirm Friday with Ramirez", priority: "medium" },
        ]}
        siteAddress="412 Oak St"
        timelineNotes="Customer wants it done by Friday."
        tags={["materials_needed", "leak"]}
        aiConfidence={0.86}
      />
      <Card>
        <CardContent className="pt-6">
          <NoteAiRetryButton noteId={noteId} hasOwnerEdits />
        </CardContent>
      </Card>
    </div>
  </ConvexProvider>,
);
