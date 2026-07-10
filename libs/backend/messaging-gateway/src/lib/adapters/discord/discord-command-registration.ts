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

export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
  },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface RegisterDiscordCommandsOptions {
  token: string;
  applicationId: string;
  guildIds: ReadonlyArray<string>;
  fetchImpl?: FetchLike;
}

export interface RegisterDiscordCommandsResult {
  registered: number;
  scope: 'guild' | 'global';
}

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

  const headers = {
    Authorization: `Bot ${opts.token}`,
    'Content-Type': 'application/json',
  };
  const body = JSON.stringify(PTAH_COMMANDS);
  const base = `https://discord.com/api/v10/applications/${opts.applicationId}`;

  if (opts.guildIds.length === 0) {
    const res = await doFetch(`${base}/commands`, {
      method: 'PUT',
      headers,
      body,
    });
    if (!res.ok) {
      throw new Error(
        `discord command registration failed (global): ${res.status} ${await safeText(res)}`,
      );
    }
    return { registered: 1, scope: 'global' };
  }

  let registered = 0;
  for (const guildId of opts.guildIds) {
    const res = await doFetch(`${base}/guilds/${guildId}/commands`, {
      method: 'PUT',
      headers,
      body,
    });
    if (!res.ok) {
      throw new Error(
        `discord command registration failed (guild ${guildId}): ${res.status} ${await safeText(res)}`,
      );
    }
    registered += 1;
  }
  return { registered, scope: 'guild' };
}

async function safeText(res: { text(): Promise<string> }): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}
