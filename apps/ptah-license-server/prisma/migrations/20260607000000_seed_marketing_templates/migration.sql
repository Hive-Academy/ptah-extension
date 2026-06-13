-- Seed starter marketing campaign templates.
-- Idempotent: ON CONFLICT ("name") DO NOTHING so it never overwrites admin edits
-- and is safe to re-run against any environment via `prisma migrate deploy`.

INSERT INTO "marketing_campaign_templates" ("id", "name", "subject", "html_body", "variables", "created_by", "created_at", "updated_at")
VALUES (
  gen_random_uuid(),
  'Welcome / Onboarding',
  'Welcome to Ptah, {{firstName}}',
  '<div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif;color:#111827;line-height:1.6;"><h1 style="font-size:24px;color:#111827;">Welcome to Ptah, {{firstName}}</h1><p>Thanks for signing up. Ptah is your AI coding orchestra — one workspace that conducts your AI coding assistants across VS Code, the desktop app, and the CLI.</p><p>Three things to try on day one:</p><ul><li><strong>Install the extension</strong> and open any workspace to start a session.</li><li><strong>Connect your providers</strong> in Settings to route work to the right model.</li><li><strong>Open the orchestra canvas</strong> to run multiple agents side by side.</li></ul><p style="text-align:center;margin:32px 0;"><a href="https://ptah.live/download" style="background-color:#b8860b;color:#ffffff;padding:12px 28px;text-decoration:none;border:1px solid #b8860b;">Download Ptah</a></p><p>Questions? Just reply to this email — we read every message.</p><p>— The Ptah Team</p></div>',
  ARRAY['firstName']::TEXT[],
  'seed',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("name") DO NOTHING;

INSERT INTO "marketing_campaign_templates" ("id", "name", "subject", "html_body", "variables", "created_by", "created_at", "updated_at")
VALUES (
  gen_random_uuid(),
  'Product Update',
  'What''s new in Ptah',
  '<div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif;color:#111827;line-height:1.6;"><h1 style="font-size:24px;color:#111827;">What''s new in Ptah</h1><p>Hi {{firstName}}, we shipped a batch of improvements we think you will like:</p><ul><li><strong>Faster multi-agent runs</strong> across the orchestra canvas.</li><li><strong>Messaging gateway</strong> — drive sessions from Telegram, Discord, and Slack.</li><li><strong>Smarter memory</strong> that carries context across sessions.</li></ul><p style="text-align:center;margin:32px 0;"><a href="https://docs.ptah.live" style="background-color:#b8860b;color:#ffffff;padding:12px 28px;text-decoration:none;border:1px solid #b8860b;">Read the release notes</a></p><p>— The Ptah Team</p></div>',
  ARRAY['firstName']::TEXT[],
  'seed',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("name") DO NOTHING;

INSERT INTO "marketing_campaign_templates" ("id", "name", "subject", "html_body", "variables", "created_by", "created_at", "updated_at")
VALUES (
  gen_random_uuid(),
  'Upgrade to Pro',
  'Unlock the full Ptah orchestra',
  '<div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif;color:#111827;line-height:1.6;"><h1 style="font-size:24px;color:#111827;">Unlock Ptah Pro</h1><p>Hi {{firstName}}, your account ({{email}}) is on the free plan. Upgrade to Pro to remove limits and unlock the full orchestra:</p><ul><li>Unlimited concurrent agents on the canvas.</li><li>Premium setup wizard and harness builder.</li><li>Priority support.</li></ul><p style="text-align:center;margin:32px 0;"><a href="https://ptah.live/pricing" style="background-color:#b8860b;color:#ffffff;padding:12px 28px;text-decoration:none;border:1px solid #b8860b;">Upgrade to Pro</a></p><p>— The Ptah Team</p></div>',
  ARRAY['firstName','email']::TEXT[],
  'seed',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("name") DO NOTHING;

INSERT INTO "marketing_campaign_templates" ("id", "name", "subject", "html_body", "variables", "created_by", "created_at", "updated_at")
VALUES (
  gen_random_uuid(),
  'Discord Promotion / Free Year',
  'Join the Ptah Discord — claim a free year of Pro',
  '<div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif;color:#111827;line-height:1.6;"><h1 style="font-size:24px;color:#111827;">Get a full year of Ptah Pro, on the house</h1><p>Hi {{firstName}}, here is a thank-you for being an early Ptah user.</p><p>Join our Discord community and you will get:</p><ul><li><strong>A free 1-year Pro license key</strong> — the full orchestra, unlocked.</li><li><strong>A direct line to me</strong>, the creator of Ptah, for any question, bug, or error you run into.</li><li><strong>Live webinars and working sessions</strong> where I show how I use Ptah day to day, including every new feature as it ships.</li></ul><p style="text-align:center;margin:32px 0;"><a href="https://discord.gg/pZcbrqNRzq" style="background-color:#5865f2;color:#ffffff;padding:12px 28px;text-decoration:none;border:1px solid #5865f2;">Join the Ptah Discord</a></p><p>See you inside,</p><p>— Abdallah, creator of Ptah</p></div>',
  ARRAY['firstName']::TEXT[],
  'seed',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("name") DO NOTHING;
