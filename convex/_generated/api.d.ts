/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as ai from "../ai.js";
import type * as companies from "../companies.js";
import type * as crons from "../crons.js";
import type * as invites from "../invites.js";
import type * as jobs from "../jobs.js";
import type * as leads from "../leads.js";
import type * as ops from "../ops.js";
import type * as storageCleanup from "../storageCleanup.js";
import type * as teamMembers from "../teamMembers.js";
import type * as users from "../users.js";
import type * as voiceNotes from "../voiceNotes.js";
import type * as lib_configCheck from "../lib/configCheck.js";
import type * as lib_email from "../lib/email.js";
import type * as lib_fieldJobs from "../lib/fieldJobs.js";
import type * as lib_fieldSession from "../lib/fieldSession.js";
import type * as lib_noteEdits from "../lib/noteEdits.js";
import type * as lib_openaiCalls from "../lib/openaiCalls.js";
import type * as lib_pin from "../lib/pin.js";
import type * as lib_prompts from "../lib/prompts.js";
import type * as lib_tenant from "../lib/tenant.js";
import type * as lib_uploadQuota from "../lib/uploadQuota.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  ai: typeof ai;
  companies: typeof companies;
  crons: typeof crons;
  invites: typeof invites;
  jobs: typeof jobs;
  leads: typeof leads;
  ops: typeof ops;
  storageCleanup: typeof storageCleanup;
  teamMembers: typeof teamMembers;
  users: typeof users;
  voiceNotes: typeof voiceNotes;
  "lib/configCheck": typeof lib_configCheck;
  "lib/email": typeof lib_email;
  "lib/fieldJobs": typeof lib_fieldJobs;
  "lib/fieldSession": typeof lib_fieldSession;
  "lib/noteEdits": typeof lib_noteEdits;
  "lib/openaiCalls": typeof lib_openaiCalls;
  "lib/pin": typeof lib_pin;
  "lib/prompts": typeof lib_prompts;
  "lib/tenant": typeof lib_tenant;
  "lib/uploadQuota": typeof lib_uploadQuota;
}>;

export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;
