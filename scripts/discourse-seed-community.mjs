#!/usr/bin/env node
/**
 * discourse-seed-community.mjs — create the Builders cohort's forum scaffold.
 *
 * Seeds the STRUCTURE a cohort needs (start-here, weekly build threads, a Q&A
 * thread, a public welcome) as real staff-authored topics. It deliberately does
 * NOT fabricate member conversation — fake chatter is worthless to members and
 * embarrassing if it ever reaches production.
 *
 * Idempotent: a topic whose exact title already exists in the target category is
 * skipped, so re-running after adding a week is safe.
 *
 * Auth reuses the theme-deploy credentials (Global-scope admin key) — the
 * license server's scoped DISCOURSE_API_KEY cannot create topics.
 *
 *   DISCOURSE_THEME_API_KEY        (required)
 *   DISCOURSE_THEME_API_USERNAME   (default: system)
 *
 * Usage:
 *   node scripts/discourse-seed-community.mjs --url http://localhost:3001
 *   node scripts/discourse-seed-community.mjs --url https://community.ptah.live --yes
 *   node scripts/discourse-seed-community.mjs --url ... --weeks 8 --dry-run
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Read repo-root `.env` into a map. Matches the loader in discourse-e2e.mjs —
 * this script is run with plain `node`, which (unlike an Nx target) does not
 * populate process.env from the dotenv file. A real environment variable wins.
 */
function loadEnv() {
  const out = {};
  let text;
  try {
    text = readFileSync(join(ROOT, '.env'), 'utf8');
  } catch {
    return out;
  }
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2];
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

const dotenv = loadEnv();
const envVar = (name) => process.env[name]?.trim() || dotenv[name]?.trim();

const DEFAULT_WEEKS = 8;

/** Week themes — mirror the 8-week cohort map in the course-pack assessment. */
const WEEK_THEMES = [
  'Foundation — workspace, boundaries, CI',
  'The domain — modelling and migrations',
  'Authentication and tenancy',
  'Billing and entitlements',
  'The first vertical slice',
  'Agents, memory and skills',
  'Hardening — tests, policies, observability',
  'Deploy and launch',
];

function parseArgs(argv) {
  const args = { yes: false, dryRun: false, weeks: DEFAULT_WEEKS };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--yes') args.yes = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--url') args.url = argv[++i];
    else if (a === '--cohort') args.cohort = argv[++i];
    else if (a === '--weeks') args.weeks = Number(argv[++i]);
    else {
      console.error(`[seed] unknown argument: ${a}`);
      process.exitCode = 1;
      throw new Error('bad usage');
    }
  }
  return args;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeClient(base, apiKey, apiUsername) {
  const root = base.replace(/\/+$/, '');
  return async function call(method, path, body, attempt = 0) {
    const res = await fetch(`${root}${path}`, {
      method,
      headers: {
        'Api-Key': apiKey,
        'Api-Username': apiUsername,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const raw = await res.text();

    // Discourse rate-limits writes aggressively and tells us exactly how long to
    // wait. Seeding is a burst of topic creates, and re-running is an advertised
    // feature, so honour the hint rather than failing the run.
    if (res.status === 429 && attempt < 5) {
      let waitSeconds = 5;
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed?.extras?.wait_seconds === 'number') {
          waitSeconds = parsed.extras.wait_seconds;
        }
      } catch {
        /* fall back to the default wait */
      }
      console.log(`[seed] rate limited — waiting ${waitSeconds}s`);
      await sleep((waitSeconds + 1) * 1000);
      return call(method, path, body, attempt + 1);
    }

    if (!res.ok) {
      // Discourse hides admin routes behind 404 for non-admin keys, and renders
      // HTML rather than JSON on auth failures — say so plainly.
      const hint =
        res.status === 404
          ? ' (a 404 here usually means the key is scoped, not Global)'
          : '';
      throw new Error(
        `${method} ${path} -> HTTP ${res.status}${hint}: ${raw.slice(0, 200)}`,
      );
    }
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  };
}

/** Category id by exact name, or null. */
async function findCategory(call, name) {
  const data = await call('GET', '/categories.json?include_subcategories=true');
  const list = data?.category_list?.categories ?? [];
  const hit = list.find((c) => c.name === name);
  return hit ? hit.id : null;
}

/**
 * True when a topic with this exact title already exists in the category.
 * Uses the category listing rather than search, so it works on a fresh instance
 * where the search index has not caught up.
 */
async function topicExists(call, categoryId, title) {
  const data = await call('GET', `/c/${categoryId}.json?page=0`);
  const topics = data?.topic_list?.topics ?? [];
  return topics.some((t) => t.title === title);
}

async function createTopic(call, { title, raw, categoryId, pinned }) {
  const post = await call('POST', '/posts.json', {
    title,
    raw,
    category: categoryId,
  });
  const topicId = post?.topic_id;
  if (pinned && topicId) {
    // status/pinned is a separate call; a failure here is cosmetic, not fatal.
    try {
      await call('PUT', `/t/${topicId}/status.json`, {
        status: 'pinned',
        enabled: 'true',
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`[seed] could not pin "${title}": ${msg}`);
    }
  }
  return topicId;
}

function buildPlan(cohortLabel, weeks) {
  const lounge = [];

  lounge.push({
    pinned: true,
    title: 'Start here — how this cohort works',
    raw: [
      `Welcome to **${cohortLabel}**.`,
      '',
      'This is a build cohort, not a video course. Over the next few weeks you',
      'ship a real application to production, and everything here exists to',
      'support that.',
      '',
      '### How a week runs',
      '',
      '1. **Live session.** We build together. Bring your screen and your blockers.',
      '2. **Build thread.** Each week has one thread below — post progress, screenshots and questions there so the answers stay findable.',
      '3. **Review.** Share a branch or a diff and get it looked at before it ships.',
      '',
      '### What you have access to',
      '',
      '- The private source pack repository',
      '- The full foundation course',
      '- This category, for members only',
      '- The weekly live session',
      '',
      '### Ground rules',
      '',
      '- Ask early. A blocked member is the only real failure mode here.',
      '- Post in the open. A question in the build thread helps everyone; a DM helps one person.',
      '- Working beats elegant. Ship it, then improve it.',
    ].join('\n'),
  });

  lounge.push({
    title: 'Questions — ask anything here',
    raw: [
      'A catch-all for questions that do not belong to a specific week.',
      '',
      'No question is too basic. If you are stuck on setup, tooling, an error',
      'message, or a decision you cannot make, this is the place. Include the',
      'command you ran and the full output where you can — it usually turns a',
      'long thread into a short one.',
    ].join('\n'),
  });

  for (let w = 1; w <= weeks; w++) {
    const theme = WEEK_THEMES[w - 1] ?? `Week ${w}`;
    lounge.push({
      title: `Week ${w} build thread — ${theme}`,
      raw: [
        `**Week ${w}: ${theme}**`,
        '',
        'Post here as you work through this week.',
        '',
        '- What you shipped',
        '- What broke, and what the error actually said',
        '- Anything you want reviewed before it merges',
        '',
        'Screenshots and diffs welcome. If you are behind, say so — the point is',
        'to finish, not to keep pace with a schedule.',
      ].join('\n'),
    });
  }

  const general = [
    {
      title: 'Welcome to the Ptah community',
      raw: [
        'This is the public side of the Ptah community — open to everyone,',
        'whether or not you are a member.',
        '',
        'Ptah is an AI coding orchestra: a VS Code extension, a desktop app and',
        'a headless CLI sharing one core. Use this space to ask questions about',
        'the tool, share what you have built with it, and tell us what is',
        'missing.',
        '',
        'Bug reports and feature requests are both welcome. So is criticism —',
        'we would rather hear it here than not at all.',
      ].join('\n'),
    },
  ];

  return { lounge, general };
}

async function seedInto(call, categoryName, topics, dryRun) {
  const categoryId = await findCategory(call, categoryName);
  if (!categoryId) {
    console.warn(`[seed] category "${categoryName}" not found — skipping.`);
    return { created: 0, skipped: 0 };
  }

  let created = 0;
  let skipped = 0;
  for (const t of topics) {
    if (await topicExists(call, categoryId, t.title)) {
      console.log(`[seed] exists, skipping: ${t.title}`);
      skipped++;
      continue;
    }
    if (dryRun) {
      console.log(`[seed] would create: ${t.title}`);
      created++;
      continue;
    }
    const id = await createTopic(call, { ...t, categoryId });
    console.log(`[seed] created (#${id}): ${t.title}`);
    created++;
  }
  return { created, skipped };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.url) throw new Error('--url is required');

  const apiKey = envVar('DISCOURSE_THEME_API_KEY');
  if (!apiKey) {
    throw new Error(
      'DISCOURSE_THEME_API_KEY is not set — needs a Global-scope admin key',
    );
  }
  const apiUsername = envVar('DISCOURSE_THEME_API_USERNAME') || 'system';

  const isLocal =
    /^https?:\/\/(localhost|127\.0\.0\.1|host\.docker\.internal)(:|\/|$)/.test(
      args.url,
    );
  if (!isLocal && !args.yes && !process.env.CI) {
    throw new Error(
      `refusing to seed a non-local target (${args.url}) without --yes`,
    );
  }

  const cohortLabel = args.cohort || 'the Ptah Builders cohort';
  const weeks = Number.isFinite(args.weeks) ? args.weeks : DEFAULT_WEEKS;
  const call = makeClient(args.url, apiKey, apiUsername);
  const plan = buildPlan(cohortLabel, weeks);

  console.log(
    `[seed] ${args.dryRun ? 'DRY RUN — ' : ''}seeding ${args.url} as ${apiUsername} (${weeks} weeks)`,
  );

  const lounge = await seedInto(
    call,
    'Builders Lounge',
    plan.lounge,
    args.dryRun,
  );
  const general = await seedInto(call, 'General', plan.general, args.dryRun);

  console.log(
    `[seed] done — created ${lounge.created + general.created}, skipped ${lounge.skipped + general.skipped}`,
  );
}

main().catch((error) => {
  console.error(`[seed] ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
