/**
 * Registers the `/ptah` slash command with Discord's REST API.
 *
 * Guild-scoped registration (one POST per allow-listed guild) appears in the
 * server immediately; global registration (no guilds) can take up to ~1h to
 * propagate. The command shape mirrors what the Discord adapter consumes:
 * command name `ptah`, one required string option `prompt`.
 */

const PTAH_COMMAND = {
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
} as const;

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
  const body = JSON.stringify(PTAH_COMMAND);
  const base = `https://discord.com/api/v10/applications/${opts.applicationId}`;

  if (opts.guildIds.length === 0) {
    const res = await doFetch(`${base}/commands`, {
      method: 'POST',
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
      method: 'POST',
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
