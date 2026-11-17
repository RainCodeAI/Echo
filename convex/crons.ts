import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Remove uploads no note references (abandoned / rejected field submits).
// Off-peak for North American crews. See convex/storageCleanup.ts.
crons.daily(
  "cleanup orphaned uploads",
  { hourUTC: 9, minuteUTC: 17 },
  internal.storageCleanup.cleanupOrphanedUploads,
  {},
);

// Daily digests: hourly pass sends whichever companies are at their chosen
// local hour (convex/digestRunner.ts). One digest per company per day.
crons.hourly("daily digests", { minuteUTC: 7 }, internal.digestRunner.runDueDigests, {});

// Daily ops report to OPS_EMAIL (convex/ops.ts). Mid-morning US Eastern,
// after the overnight digests and storage cleanup.
crons.daily("ops report", { hourUTC: 14, minuteUTC: 23 }, internal.ops.sendDailyReport, {});

export default crons;
