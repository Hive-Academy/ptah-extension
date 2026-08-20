-- Repair the "Founding / Waitlist Invite" template to the canonical 70%-off offer.
--
-- ── WHY THIS MIGRATION EXISTS, AND WHY IT IS NOT AN EDIT ──────────────────────
-- Commit 4db8de4df ("relaunch Builders early-adopter offer at 70% off the first
-- year") replaced this template's body IN PLACE, inside
-- `20260724120000_seed_marketing_templates_v2/migration.sql`, which had ALREADY
-- been applied to developer databases. That broke two things at once:
--
--   1. BOOKKEEPING. Prisma records a checksum per applied migration. Editing an
--      applied file makes `prisma migrate dev` refuse to run and demand a full
--      database RESET — which on this workspace would destroy the seeded dev
--      entitlement the TASK_2026_177 B1/B3/B6 exit gates depend on. TASK_2026_177
--      migration 1 had to be hand-authored and applied with `migrate deploy` to
--      dodge it. That workaround does not scale: migrations 2-5 all follow.
--
--   2. DATA, AND THIS IS THE WORSE ONE. That template's INSERT ends in
--      `ON CONFLICT ("name") DO NOTHING`. So on any database that had already
--      seeded the row, re-running the migration is a NO-OP — the edit could never
--      reach it. Those databases still hold the WITHDRAWN copy, which promises
--      "a founding-member price locked in for as long as you stay". That promise
--      was deliberately retired; the offer is now 70% off the first year, then
--      list price. This template is what `Admin -> Waitlist -> Send Founding
--      Invites` mails out, so a stale row is a wrong commitment in a real email.
--
-- THE FIX, IN TWO PARTS. `20260724120000_...` has been RESTORED to its pre-edit
-- content, so its checksum matches every database that applied it and the
-- "applied migrations are immutable" invariant holds again. This migration then
-- carries 4db8de4df's INTENT forward, the way it should have been carried in the
-- first place.
--
-- IDEMPOTENT AND SAFE EVERYWHERE. `DO UPDATE` rather than `DO NOTHING`, so it
-- repairs a stale row and is a no-op write on a correct one. On a database that
-- has never seeded the template it simply inserts it. Production has never
-- applied `20260724120000_...` at all, so it will seed the old copy and then be
-- corrected by this file moments later, in the same `migrate deploy`.

INSERT INTO "marketing_campaign_templates" ("id", "name", "subject", "html_body", "variables", "created_by", "created_at", "updated_at")
VALUES (
  gen_random_uuid(),
  'Founding / Waitlist Invite',
  'Your founding Builder invite is ready, {{firstName}}',
  '<div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif;color:#111827;line-height:1.6;"><h1 style="font-size:24px;color:#111827;">You''re invited to become a founding Builder</h1><p>Hi {{firstName}}, you joined the Ptah Builders waitlist — and your invite is ready.</p><p>As a <strong>founding Builder</strong> you get:</p><ul><li>The premium <strong>SaaS-building course</strong> — build and ship a production SaaS with the full Ptah orchestra.</li><li><strong>Weekly live sessions</strong> — Q&amp;A, tutorials, and live builds.</li><li><strong>70% off your first year</strong> — $8.70/month for your first 12 billing cycles, or $87 for the first year, then list price ($29/mo or $290/yr).</li><li>A direct line to Abdallah and the team to shape what we build next.</li></ul><p style="text-align:center;margin:32px 0;"><a href="https://ptah.live/pricing" style="background-color:#b8860b;color:#ffffff;padding:12px 28px;text-decoration:none;border:1px solid #b8860b;">Claim your founding invite</a></p><p>Spots are limited — this invite is yours to claim while they last.</p><p>— Abdallah, creator of Ptah</p></div>',
  ARRAY['firstName']::TEXT[],
  'seed',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("name") DO UPDATE
  SET "subject"    = EXCLUDED."subject",
      "html_body"  = EXCLUDED."html_body",
      "variables"  = EXCLUDED."variables",
      "updated_at" = CURRENT_TIMESTAMP;
