-- Seed marketing campaign templates v2.
--
-- Two intents in one data-only migration (no DDL):
--
--  A. Refresh the 4 original default templates (seeded by
--     20260607000000_seed_marketing_templates) with improved copy/design and
--     the Pro -> Builders reframing.
--     Idempotency/safety: each uses
--       ON CONFLICT ("name") DO UPDATE ... WHERE html_body = <exact original seed html>
--     so ONLY rows that still hold the untouched original seed content are
--     refreshed. Admin-edited rows (html_body differs) are left untouched, and
--     fresh installs INSERT the improved version directly. Re-running is a no-op.
--
--  B. Add new-purpose templates (new names) with ON CONFLICT ("name") DO NOTHING,
--     matching the original migration's non-clobbering intent.
--
-- SQL style mirrors the original: gen_random_uuid(), CURRENT_TIMESTAMP,
-- created_by = 'seed', single quotes escaped as ''.
--
-- FOOTER: template bodies intentionally omit an unsubscribe footer. At send
-- time TemplateRenderService.render() appends the CAN-SPAM/GDPR compliance
-- footer (postal address + Unsubscribe link) via injectCampaignFooter, so a
-- single canonical footer is added to every send. This matches the original 4
-- seed templates, which also carried no embedded footer.

-- ---------------------------------------------------------------------------
-- A. Enhance the original 4 defaults (upsert only if still the original seed)
-- ---------------------------------------------------------------------------

-- A1. Welcome / Onboarding
INSERT INTO "marketing_campaign_templates" ("id", "name", "subject", "html_body", "variables", "created_by", "created_at", "updated_at")
VALUES (
  gen_random_uuid(),
  'Welcome / Onboarding',
  'Welcome to Ptah, {{firstName}}',
  '<div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif;color:#111827;line-height:1.6;"><h1 style="font-size:24px;color:#111827;">Welcome to Ptah, {{firstName}}</h1><p>Thanks for joining. Ptah is your AI coding orchestra — one workspace that conducts your AI coding assistants across VS Code, the desktop app, and the CLI. It''s free and open source, so you can start building right now.</p><p>Three things to try on day one:</p><ul><li><strong>Install Ptah</strong> and open any workspace to start your first session.</li><li><strong>Connect your providers</strong> in Settings so each task routes to the right model.</li><li><strong>Open the orchestra canvas</strong> to run multiple agents side by side.</li></ul><p style="text-align:center;margin:32px 0;"><a href="https://ptah.live/download" style="background-color:#b8860b;color:#ffffff;padding:12px 28px;text-decoration:none;border:1px solid #b8860b;">Download Ptah</a></p><p>Ready for more horsepower? The <strong>Builders</strong> tier unlocks the full orchestra — explore it at <a href="https://ptah.live/pricing" style="color:#b8860b;text-decoration:underline;">ptah.live/pricing</a>.</p><p>Questions? Just reply to this email — we read every message.</p><p>— The Ptah Team</p></div>',
  ARRAY['firstName']::TEXT[],
  'seed',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("name") DO UPDATE
  SET "subject" = EXCLUDED."subject",
      "html_body" = EXCLUDED."html_body",
      "variables" = EXCLUDED."variables",
      "updated_at" = CURRENT_TIMESTAMP
  WHERE "marketing_campaign_templates"."html_body" = '<div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif;color:#111827;line-height:1.6;"><h1 style="font-size:24px;color:#111827;">Welcome to Ptah, {{firstName}}</h1><p>Thanks for signing up. Ptah is your AI coding orchestra — one workspace that conducts your AI coding assistants across VS Code, the desktop app, and the CLI.</p><p>Three things to try on day one:</p><ul><li><strong>Install the extension</strong> and open any workspace to start a session.</li><li><strong>Connect your providers</strong> in Settings to route work to the right model.</li><li><strong>Open the orchestra canvas</strong> to run multiple agents side by side.</li></ul><p style="text-align:center;margin:32px 0;"><a href="https://ptah.live/download" style="background-color:#b8860b;color:#ffffff;padding:12px 28px;text-decoration:none;border:1px solid #b8860b;">Download Ptah</a></p><p>Questions? Just reply to this email — we read every message.</p><p>— The Ptah Team</p></div>';

-- A2. Product Update
INSERT INTO "marketing_campaign_templates" ("id", "name", "subject", "html_body", "variables", "created_by", "created_at", "updated_at")
VALUES (
  gen_random_uuid(),
  'Product Update',
  'What''s new in Ptah',
  '<div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif;color:#111827;line-height:1.6;"><h1 style="font-size:24px;color:#111827;">What''s new in Ptah</h1><p>Hi {{firstName}}, we shipped a batch of improvements we think you''ll like:</p><ul><li><strong>Faster multi-agent runs</strong> across the orchestra canvas.</li><li><strong>Messaging gateway</strong> — drive sessions from Telegram, Discord, and Slack.</li><li><strong>Smarter memory</strong> that carries context across sessions.</li><li><strong>Now free and open source</strong> — Community is yours to keep, with <strong>Builders</strong> for when you want the full orchestra.</li></ul><p style="text-align:center;margin:32px 0;"><a href="https://docs.ptah.live" style="background-color:#b8860b;color:#ffffff;padding:12px 28px;text-decoration:none;border:1px solid #b8860b;">Read the release notes</a></p><p>— The Ptah Team</p></div>',
  ARRAY['firstName']::TEXT[],
  'seed',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("name") DO UPDATE
  SET "subject" = EXCLUDED."subject",
      "html_body" = EXCLUDED."html_body",
      "variables" = EXCLUDED."variables",
      "updated_at" = CURRENT_TIMESTAMP
  WHERE "marketing_campaign_templates"."html_body" = '<div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif;color:#111827;line-height:1.6;"><h1 style="font-size:24px;color:#111827;">What''s new in Ptah</h1><p>Hi {{firstName}}, we shipped a batch of improvements we think you will like:</p><ul><li><strong>Faster multi-agent runs</strong> across the orchestra canvas.</li><li><strong>Messaging gateway</strong> — drive sessions from Telegram, Discord, and Slack.</li><li><strong>Smarter memory</strong> that carries context across sessions.</li></ul><p style="text-align:center;margin:32px 0;"><a href="https://docs.ptah.live" style="background-color:#b8860b;color:#ffffff;padding:12px 28px;text-decoration:none;border:1px solid #b8860b;">Read the release notes</a></p><p>— The Ptah Team</p></div>';

-- A3. Upgrade to Pro -> reframed to Builders (name kept as the idempotent conflict key)
INSERT INTO "marketing_campaign_templates" ("id", "name", "subject", "html_body", "variables", "created_by", "created_at", "updated_at")
VALUES (
  gen_random_uuid(),
  'Upgrade to Pro',
  'Go premium with Ptah Builders',
  '<div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif;color:#111827;line-height:1.6;"><h1 style="font-size:24px;color:#111827;">Go premium with Ptah Builders</h1><p>Hi {{firstName}}, your account ({{email}}) is on the free Community plan. Upgrade to <strong>Builders</strong> to remove limits and unlock the full orchestra:</p><ul><li>Unlimited concurrent agents on the canvas.</li><li>The premium setup wizard and harness builder.</li><li>Priority support, straight from the team.</li></ul><p style="text-align:center;margin:32px 0;"><a href="https://ptah.live/pricing" style="background-color:#b8860b;color:#ffffff;padding:12px 28px;text-decoration:none;border:1px solid #b8860b;">Upgrade to Builders</a></p><p>Community stays free forever — Builders is for when you''re ready to scale.</p><p>— The Ptah Team</p></div>',
  ARRAY['firstName','email']::TEXT[],
  'seed',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("name") DO UPDATE
  SET "subject" = EXCLUDED."subject",
      "html_body" = EXCLUDED."html_body",
      "variables" = EXCLUDED."variables",
      "updated_at" = CURRENT_TIMESTAMP
  WHERE "marketing_campaign_templates"."html_body" = '<div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif;color:#111827;line-height:1.6;"><h1 style="font-size:24px;color:#111827;">Unlock Ptah Pro</h1><p>Hi {{firstName}}, your account ({{email}}) is on the free plan. Upgrade to Pro to remove limits and unlock the full orchestra:</p><ul><li>Unlimited concurrent agents on the canvas.</li><li>Premium setup wizard and harness builder.</li><li>Priority support.</li></ul><p style="text-align:center;margin:32px 0;"><a href="https://ptah.live/pricing" style="background-color:#b8860b;color:#ffffff;padding:12px 28px;text-decoration:none;border:1px solid #b8860b;">Upgrade to Pro</a></p><p>— The Ptah Team</p></div>';

-- A4. Discord Promotion / Free Year (Pro -> Builders reframing, keeps #5865f2 CTA)
INSERT INTO "marketing_campaign_templates" ("id", "name", "subject", "html_body", "variables", "created_by", "created_at", "updated_at")
VALUES (
  gen_random_uuid(),
  'Discord Promotion / Free Year',
  'Join the Ptah Discord — claim a free year of Builders',
  '<div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif;color:#111827;line-height:1.6;"><h1 style="font-size:24px;color:#111827;">Get a full year of Ptah Builders, on the house</h1><p>Hi {{firstName}}, here''s a thank-you for being an early Ptah user.</p><p>Join our Discord community and you''ll get:</p><ul><li><strong>A free 1-year Builders license key</strong> — the full orchestra, unlocked.</li><li><strong>A direct line to me</strong>, the creator of Ptah, for any question, bug, or error you run into.</li><li><strong>Live webinars and working sessions</strong> where I show how I use Ptah day to day, including every new feature as it ships.</li></ul><p style="text-align:center;margin:32px 0;"><a href="https://discord.gg/pZcbrqNRzq" style="background-color:#5865f2;color:#ffffff;padding:12px 28px;text-decoration:none;border:1px solid #5865f2;">Join the Ptah Discord</a></p><p>See you inside,</p><p>— Abdallah, creator of Ptah</p></div>',
  ARRAY['firstName']::TEXT[],
  'seed',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("name") DO UPDATE
  SET "subject" = EXCLUDED."subject",
      "html_body" = EXCLUDED."html_body",
      "variables" = EXCLUDED."variables",
      "updated_at" = CURRENT_TIMESTAMP
  WHERE "marketing_campaign_templates"."html_body" = '<div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif;color:#111827;line-height:1.6;"><h1 style="font-size:24px;color:#111827;">Get a full year of Ptah Pro, on the house</h1><p>Hi {{firstName}}, here is a thank-you for being an early Ptah user.</p><p>Join our Discord community and you will get:</p><ul><li><strong>A free 1-year Pro license key</strong> — the full orchestra, unlocked.</li><li><strong>A direct line to me</strong>, the creator of Ptah, for any question, bug, or error you run into.</li><li><strong>Live webinars and working sessions</strong> where I show how I use Ptah day to day, including every new feature as it ships.</li></ul><p style="text-align:center;margin:32px 0;"><a href="https://discord.gg/pZcbrqNRzq" style="background-color:#5865f2;color:#ffffff;padding:12px 28px;text-decoration:none;border:1px solid #5865f2;">Join the Ptah Discord</a></p><p>See you inside,</p><p>— Abdallah, creator of Ptah</p></div>';

-- ---------------------------------------------------------------------------
-- B. New-purpose templates (never overwrite existing rows)
-- ---------------------------------------------------------------------------

-- B1. Founding / Waitlist Invite
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
ON CONFLICT ("name") DO NOTHING;

-- B2. Payment Past Due / Billing Reminder
INSERT INTO "marketing_campaign_templates" ("id", "name", "subject", "html_body", "variables", "created_by", "created_at", "updated_at")
VALUES (
  gen_random_uuid(),
  'Payment Past Due / Billing Reminder',
  'Action needed: your Ptah Builders payment is past due',
  '<div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif;color:#111827;line-height:1.6;"><h1 style="font-size:24px;color:#111827;">Your payment didn''t go through</h1><p>Hi {{firstName}}, we couldn''t process the latest payment for your Ptah Builders subscription on {{email}}.</p><p>To keep your Builders features active, please update your payment method:</p><p style="text-align:center;margin:32px 0;"><a href="https://ptah.live/profile" style="background-color:#b8860b;color:#ffffff;padding:12px 28px;text-decoration:none;border:1px solid #b8860b;">Update payment method</a></p><p>If the balance isn''t settled, your subscription will move to the free Community plan — you won''t lose any work, but Builders features will pause.</p><p>Already sorted it out? You can safely ignore this message.</p><p>— The Ptah Team</p></div>',
  ARRAY['firstName','email']::TEXT[],
  'seed',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("name") DO NOTHING;

-- B3. Re-engagement / Win-back
INSERT INTO "marketing_campaign_templates" ("id", "name", "subject", "html_body", "variables", "created_by", "created_at", "updated_at")
VALUES (
  gen_random_uuid(),
  'Re-engagement / Win-back',
  'We miss you, {{firstName}} — here''s what''s new in Ptah',
  '<div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif;color:#111827;line-height:1.6;"><h1 style="font-size:24px;color:#111827;">We miss you, {{firstName}}</h1><p>It''s been a while since your last Ptah session, and a lot has changed. Here''s what''s new since you were last in the studio:</p><ul><li><strong>Ptah is now free and open source</strong> — the Community tier is yours to keep.</li><li><strong>A faster orchestra canvas</strong> for running agents side by side.</li><li><strong>Messaging gateway, smarter memory, and scheduled runs</strong> to automate the busywork.</li></ul><p style="text-align:center;margin:32px 0;"><a href="https://ptah.live/download" style="background-color:#b8860b;color:#ffffff;padding:12px 28px;text-decoration:none;border:1px solid #b8860b;">Pick up where you left off</a></p><p>Curious what the full orchestra can do? Explore <a href="https://ptah.live/pricing" style="color:#b8860b;text-decoration:underline;">Builders</a>.</p><p>— The Ptah Team</p></div>',
  ARRAY['firstName']::TEXT[],
  'seed',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("name") DO NOTHING;

-- B4. Builders Welcome / Early-Adopter Approved
INSERT INTO "marketing_campaign_templates" ("id", "name", "subject", "html_body", "variables", "created_by", "created_at", "updated_at")
VALUES (
  gen_random_uuid(),
  'Builders Welcome / Early-Adopter Approved',
  'You''re in — welcome to Ptah Builders, {{firstName}}',
  '<div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif;color:#111827;line-height:1.6;"><h1 style="font-size:24px;color:#111827;">Welcome to Ptah Builders, {{firstName}}</h1><p>Your complimentary <strong>Builders</strong> license is active — the full Ptah orchestra is now unlocked on your account.</p><p>Here''s how to make the most of it:</p><ul><li><strong>Open the orchestra canvas</strong> and run agents in parallel with no limits.</li><li><strong>Try the premium setup wizard and harness builder</strong> to stand up new workflows fast.</li><li><strong>Join the community</strong> on <a href="https://discord.gg/pZcbrqNRzq" style="color:#b8860b;text-decoration:underline;">Discord</a> to swap tips and get help.</li></ul><p style="text-align:center;margin:32px 0;"><a href="https://ptah.live/download" style="background-color:#b8860b;color:#ffffff;padding:12px 28px;text-decoration:none;border:1px solid #b8860b;">Open Ptah Builders</a></p><p>Thanks for being an early believer.</p><p>— Abdallah, creator of Ptah</p></div>',
  ARRAY['firstName']::TEXT[],
  'seed',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("name") DO NOTHING;
