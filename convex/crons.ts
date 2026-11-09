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

export default crons;
