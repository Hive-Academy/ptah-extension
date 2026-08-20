/**
 * Registers Ptah's Discord application commands via bulk overwrite.
 *
 * `PUT /applications/{appId}/guilds/{guildId}/commands` (guild scope,
 * instant) or `PUT /applications/{appId}/commands` (global scope, up to ~1h
 * to propagate) — Discord's canonical idempotent registration. One REST call
 * per scope replaces ALL of this application's commands in that scope with
 * the array below; acceptable because Ptah owns every command it registers.
 *
 * The array carries the prompt command (`/ptah`, unchanged shape) plus the
 * five control-plane commands consumed by the Discord adapter:
 * `/sessions`, `/session use`, `/new`, `/workspace list`, `/workspace use`.
 */

const PTAH_COMMANDS = [
  {
    name: 'ptah',
    description: 'Ask Ptah a question',
    type: 1,
    options: [
      {
        name: 'prompt',
        description: 'What you want Ptah to do',
        type: 3,
        required: true,
      },
    ],
  },
  {
    name: 'sessions',
    type: 1,
    description: "List resumable Ptah sessions for this thread's workspace",
  },
  {
    name: 'session',
    type: 1,
    description: 'Manage which Ptah session this thread drives',
    options: [
      {
        type: 1,
        name: 'use',
        description: 'Point this thread at an existing session',
        options: [
          {
            type: 3,
            name: 'pick',
            required: true,
            autocomplete: true,
            description: 'Session to attach — pick from the list',
          },
        ],
      },
    ],
  },
  {
    name: 'new',
    type: 1,
    description: 'Start a fresh Ptah session in this thread',
  },
  {
    name: 'workspace',
    type: 1,
    description: 'See or switch the workspace this thread targets',
    options: [
      {
        type: 1,
        name: 'list',
        description: 'List workspaces Ptah can target',
      },
      {
        type: 1,
        name: 'use',
        description: 'Switch this thread to an allowed workspace',
        options: [
          {
            type: 3,
            name: 'pick',
            required: true,
            autocomplete: true,
            description: 'Workspace to target — pick from the list',
          },
        ],
      },
    ],
  },
] as const;

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  /**
   * Present on a real `fetch` Response. Optional so the hand-rolled fakes in
   * specs (and any caller passing a minimal `fetchImpl`) stay assignable.
   */
  headers?: { get(name: string): string | null };
  text(): Promise<string>;
}

export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
  },
) => Promise<FetchResponseLike>;

export interface RegisterDiscordCommandsOptions {
  token: string;
  applicationId: string;
  guildIds: ReadonlyArray<string>;
  fetchImpl?: FetchLike;
  /** Test seam — replaces the `setTimeout` used between 429 retries. */
  sleepImpl?: (ms: number) => Promise<void>;
}

/**
 * Outcome of the single bulk-overwrite PUT for one scope. `guildId` is
 * `'global'` for the application-scope call, which has no guild.
 */
export interface DiscordCommandScopeResult {
  guildId: string;
  ok: boolean;
  error?: string;
}

export interface RegisterDiscordCommandsResult {
  /** Number of scopes that registered successfully. */
  registered: number;
  scope: 'guild' | 'global';
  /** One entry per attempted scope, in request order. */
  results: ReadonlyArray<DiscordCommandScopeResult>;
}

/** Retries AFTER the initial attempt, per request (TASK_2026_271 #8). */
const MAX_RETRIES_PER_REQUEST = 3;
/**
 * A `Retry-After` longer than this is not worth blocking registration on —
 * Discord hands these out for daily command-create quotas, which no amount of
 * waiting inside one call will clear.
 */
const MAX_RETRY_AFTER_MS = 60_000;
const GLOBAL_SCOPE_ID = 'global';

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function registerDiscordSlashCommands(
  opts: RegisterDiscordCommandsOptions,
): Promise<RegisterDiscordCommandsResult> {
  if (!opts.token) {
    throw new Error('discord command registration: missing token');
  }
  if (!opts.applicationId) {
    throw new Error('discord command registration: missing applicationId');
  }

  const doFetch =
    opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike | undefined);
  if (!doFetch) {
    throw new Error('discord command registration: no fetch implementation');
  }

  const sleep = opts.sleepImpl ?? defaultSleep;
  const headers = {
    Authorization: `Bot ${opts.token}`,
    'Content-Type': 'application/json',
  };
  const body = JSON.stringify(PTAH_COMMANDS);
  const base = `https://discord.com/api/v10/applications/${opts.applicationId}`;

  if (opts.guildIds.length === 0) {
    const error = await putCommands(doFetch, sleep, `${base}/commands`, {
      headers,
      body,
      label: 'global',
    });
    if (error) {
      throw new Error(`discord command registration failed (global): ${error}`);
    }
    return {
      registered: 1,
      scope: 'global',
      results: [{ guildId: GLOBAL_SCOPE_ID, ok: true }],
    };
  }

  // One bad guild (bot kicked, missing `applications.commands` scope) must not
  // cost the other guilds their registration, so the loop always runs to the
  // end and reports per guild instead of throwing on the first failure.
  const results: DiscordCommandScopeResult[] = [];
  for (const guildId of opts.guildIds) {
    const error = await putCommands(
      doFetch,
      sleep,
      `${base}/guilds/${guildId}/commands`,
      { headers, body, label: `guild ${guildId}` },
    );
    results.push(error ? { guildId, ok: false, error } : { guildId, ok: true });
  }

  const registered = results.filter((r) => r.ok).length;
  if (registered === 0) {
    throw new Error(
      `discord command registration failed (${results
        .map((r) => `guild ${r.guildId}: ${r.error ?? 'unknown error'}`)
        .join('; ')})`,
    );
  }
  return { registered, scope: 'guild', results };
}

/**
 * Issues the bulk-overwrite PUT, honouring Discord's 429 `Retry-After`.
 * Resolves `null` on success or the `"<status> <body>"` description of the
 * final failure — it never throws, so the caller owns the abort decision.
 */
async function putCommands(
  doFetch: FetchLike,
  sleep: (ms: number) => Promise<void>,
  url: string,
  req: { headers: Record<string, string>; body: string; label: string },
): Promise<string | null> {
  let lastError = 'no response';
  for (let attempt = 0; attempt <= MAX_RETRIES_PER_REQUEST; attempt += 1) {
    let res: FetchResponseLike;
    try {
      res = await doFetch(url, {
        method: 'PUT',
        headers: req.headers,
        body: req.body,
      });
    } catch (error: unknown) {
      return error instanceof Error ? error.message : String(error);
    }
    if (res.ok) return null;

    const text = await safeText(res);
    lastError = `${res.status} ${text}`;
    if (res.status !== 429 || attempt === MAX_RETRIES_PER_REQUEST) {
      return lastError;
    }
    const waitMs = retryAfterMs(res, text);
    if (waitMs === null || waitMs > MAX_RETRY_AFTER_MS) return lastError;
    await sleep(waitMs);
  }
  return lastError;
}

/**
 * Discord expresses the cooldown in SECONDS, both in the `Retry-After` header
 * and as `retry_after` in the JSON body (the body value is fractional). The
 * header wins when both are present and parseable.
 */
function retryAfterMs(res: FetchResponseLike, text: string): number | null {
  const header =
    res.headers?.get('Retry-After') ?? res.headers?.get('retry-after');
  const fromHeader =
    header === null || header === undefined ? NaN : Number(header);
  if (Number.isFinite(fromHeader) && fromHeader >= 0) {
    return Math.ceil(fromHeader * 1_000);
  }
  const fromBody = parseRetryAfterBody(text);
  if (fromBody !== null) return Math.ceil(fromBody * 1_000);
  return null;
}

function parseRetryAfterBody(text: string): number | null {
  if (!text) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const value = (parsed as { retry_after?: unknown }).retry_after;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

async function safeText(res: { text(): Promise<string> }): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}
