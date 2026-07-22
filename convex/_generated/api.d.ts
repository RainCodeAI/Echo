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
import type * as teamMembers from "../teamMembers.js";
import type * as users from "../users.js";
import type * as voiceNotes from "../voiceNotes.js";
import type * as lib_fieldSession from "../lib/fieldSession.js";
import type * as lib_pin from "../lib/pin.js";
import type * as lib_prompts from "../lib/prompts.js";
import type * as lib_tenant from "../lib/tenant.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  ai: typeof ai;
  companies: typeof companies;
  teamMembers: typeof teamMembers;
  users: typeof users;
  voiceNotes: typeof voiceNotes;
  "lib/fieldSession": typeof lib_fieldSession;
  "lib/pin": typeof lib_pin;
  "lib/prompts": typeof lib_prompts;
  "lib/tenant": typeof lib_tenant;
}>;

export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;
