#!/usr/bin/env node
/**
 * google-sessions-smoke.mjs — verify the Builders "live sessions" Google
 * Calendar wiring the moment GOOGLE_OAUTH_* are filled in `.env`, mirroring
 * exactly what apps/ptah-license-server/src/google-sessions/ does at runtime.
 *
 * It does NOT go through the license server or require a Builders DB account —
 * it exercises the same refresh-token grant + Calendar v3 REST calls the
 * providers use, so a green run here means the members/sessions endpoint will
 * return real events for a Builders member.
 *
 * Checks:
 *   1. Refresh-token grant → access token          (GoogleAuthProvider path)
 *   2. List events for the next 60 days on          (SessionsService read path)
 *      GOOGLE_CALENDAR_ID, singleEvents expanded; report count + meet links
 *   3. If BUILDERS_SESSION_EVENT_ID is set:          (SessionsService write target)
 *      fetch the master event, print summary / recurrence / attendees / meetLink
 *
 * Usage: node scripts/google-sessions-smoke.mjs
 * Zero npm dependencies — pure node fetch. Reads secrets from repo-root `.env`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv() {
  const out = {};
  try {
    for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!m) continue;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      out[m[1]] = v;
    }
  } catch {
    /* rely on process.env */
  }
  return out;
}

const fileEnv = loadEnv();
const env = (k) => (process.env[k] ?? fileEnv[k] ?? '').trim();

const CLIENT_ID = env('GOOGLE_OAUTH_CLIENT_ID');
const CLIENT_SECRET = env('GOOGLE_OAUTH_CLIENT_SECRET');
const REFRESH_TOKEN = env('GOOGLE_OAUTH_REFRESH_TOKEN');
const CALENDAR_ID = env('GOOGLE_CALENDAR_ID') || 'primary';
const SESSION_EVENT_ID = env('BUILDERS_SESSION_EVENT_ID');

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

console.log(`\nGoogle sessions smoke test  (calendar: ${CALENDAR_ID})\n`);

if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
  console.log(
    red('✗ GOOGLE_OAUTH_* not fully set') +
      ' — fill GOOGLE_OAUTH_CLIENT_ID / _SECRET / _REFRESH_TOKEN in .env (runbook Workstream B), then re-run.',
  );
  process.exitCode = 2;
} else {
  await run();
}

async function getAccessToken() {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: REFRESH_TOKEN,
    grant_type: 'refresh_token',
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
  });
  if (!res.ok) {
    let hint = '';
    try {
      const j = await res.json();
      hint = j.error === 'invalid_grant' ? ' (invalid_grant → refresh token revoked/expired; re-mint via OAuth Playground §7.2)' : ` (${j.error ?? ''})`;
    } catch {
      /* ignore */
    }
    throw new Error(`token endpoint ${res.status}${hint}`);
  }
  const j = await res.json();
  if (!j.access_token) throw new Error('response missing access_token');
  return j.access_token;
}

async function cal(token, path) {
  const res = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Calendar API ${res.status} on ${path.split('?')[0]}`);
  return res.json();
}

function meetLink(ev) {
  if (ev.hangoutLink) return ev.hangoutLink;
  const v = ev.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video' && e.uri);
  return v?.uri ?? null;
}

async function run() {
  let failed = 0;
  try {
    // 1. token
    const token = await getAccessToken();
    console.log(green('✓') + ' 1. refresh-token grant → access token');

    // 2. list next 60 days
    const now = new Date();
    const timeMax = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
    const q = new URLSearchParams({
      timeMin: now.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '50',
      showDeleted: 'false',
    });
    const list = await cal(token, `/calendars/${encodeURIComponent(CALENDAR_ID)}/events?${q}`);
    const items = (list.items ?? []).filter((e) => e.status !== 'cancelled');
    console.log(green('✓') + ` 2. listed ${items.length} upcoming event(s) in the next 60 days`);
    const withMeet = items.filter((e) => meetLink(e));
    for (const e of items.slice(0, 5)) {
      const start = e.start?.dateTime ?? e.start?.date ?? '?';
      console.log(dim(`      • ${start}  ${e.summary ?? '(no title)'}  ${meetLink(e) ? '📹 ' + meetLink(e) : '(no meet link)'}`));
    }
    if (items.length && !withMeet.length) {
      console.log(dim('      note: no event in the window has a Meet link yet — add Google Meet to the session event (§7.3).'));
    }

    // 3. master session event
    if (SESSION_EVENT_ID) {
      try {
        const ev = await cal(token, `/calendars/${encodeURIComponent(CALENDAR_ID)}/events/${encodeURIComponent(SESSION_EVENT_ID)}`);
        const recurring = Boolean(ev.recurrence || ev.recurringEventId);
        const link = meetLink(ev);
        console.log(green('✓') + ` 3. BUILDERS_SESSION_EVENT_ID resolves: "${ev.summary ?? '(no title)'}"`);
        console.log(dim(`      recurring: ${recurring ? 'yes' : 'NO (expected a recurring master event)'}  |  attendees: ${(ev.attendees ?? []).length}  |  meetLink: ${link ?? 'MISSING'}`));
        if (!recurring) { failed++; console.log(red('      ✗ event is not recurring — set BUILDERS_SESSION_EVENT_ID to the master recurring event id (§7.3).')); }
        if (!link) { failed++; console.log(red('      ✗ event has no Meet link — add Google Meet video conferencing to it (§7.3).')); }
      } catch (e) {
        failed++;
        console.log(red(`      ✗ 3. could not fetch BUILDERS_SESSION_EVENT_ID: ${e.message} (check the id is the master event, not an instance).`));
      }
    } else {
      console.log(dim('  3. BUILDERS_SESSION_EVENT_ID unset — read path works; attendee add/remove will no-op until it is set (§7.3).'));
    }

    console.log(failed === 0 ? '\n' + green('Google sessions wiring OK.') + '\n' : '\n' + red(`${failed} issue(s) — see above.`) + '\n');
    process.exitCode = failed === 0 ? 0 : 1;
  } catch (e) {
    console.log(red(`✗ ${e.message}`));
    process.exitCode = 1;
  }
}
