// @vitest-environment edge-runtime
import { expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import { makeTest } from "./setup";

test("invite is only claimed with the JWT's verified email, not a client-supplied one", async () => {
  const t = makeTest();
  const companyId = await t.run(async (ctx) => {
    const companyId = await ctx.db.insert("companies", { name: "Acme", createdAt: 0 });
    const ownerId = await ctx.db.insert("users", {
      clerkUserId: "owner", companyId, name: "Owner", email: "o@acme.com", role: "owner", createdAt: 0,
    });
    await ctx.db.insert("invites", {
      companyId, email: "crew@acme.com", role: "member", status: "pending", invitedBy: ownerId, createdAt: 0,
    });
    return companyId;
  });

  // Attacker's JWT carries no email claim; they pass the victim's in args.
  const attacker = t.withIdentity({ subject: "attacker" });
  await attacker.mutation(api.users.store, { email: "crew@acme.com" });
  const attackerUser = await attacker.query(api.users.current, {});
  expect(attackerUser?.companyId).not.toBe(companyId);

  // An unverified email in the JWT doesn't claim the invite either.
  const unverified = t.withIdentity({ subject: "unverified", email: "crew@acme.com", emailVerified: false });
  await unverified.mutation(api.users.store, {});
  expect((await unverified.query(api.users.current, {}))?.companyId).not.toBe(companyId);

  const invitee = t.withIdentity({ subject: "crew", email: "crew@acme.com", emailVerified: true });
  await invitee.mutation(api.users.store, {});
  expect((await invitee.query(api.users.current, {}))?.companyId).toBe(companyId);
});
