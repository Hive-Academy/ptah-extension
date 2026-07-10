import {
  registerDiscordSlashCommands,
  type FetchLike,
} from './discord-command-registration';

function okFetch(): {
  impl: FetchLike;
  calls: { url: string; method: string; body: string }[];
} {
  const calls: { url: string; method: string; body: string }[] = [];
  const impl: FetchLike = async (url, init) => {
    calls.push({ url, method: init.method, body: init.body });
    return { ok: true, status: 200, text: async () => '{}' };
  };
  return { impl, calls };
}

type CommandJson = {
  name: string;
  type: number;
  description: string;
  options?: Array<{
    type: number;
    name: string;
    required?: boolean;
    autocomplete?: boolean;
    options?: Array<{
      type: number;
      name: string;
      required?: boolean;
      autocomplete?: boolean;
    }>;
  }>;
};

describe('registerDiscordSlashCommands', () => {
  it('bulk-overwrites via one PUT per guild id (instant scope)', async () => {
    const { impl, calls } = okFetch();

    const res = await registerDiscordSlashCommands({
      token: 'tok',
      applicationId: 'app-1',
      guildIds: ['g1', 'g2'],
      fetchImpl: impl,
    });

    expect(res).toEqual({ registered: 2, scope: 'guild' });
    expect(calls.map((c) => c.url)).toEqual([
      'https://discord.com/api/v10/applications/app-1/guilds/g1/commands',
      'https://discord.com/api/v10/applications/app-1/guilds/g2/commands',
    ]);
    expect(calls.map((c) => c.method)).toEqual(['PUT', 'PUT']);
  });

  it('falls back to a single global PUT when no guilds are set', async () => {
    const { impl, calls } = okFetch();

    const res = await registerDiscordSlashCommands({
      token: 'tok',
      applicationId: 'app-1',
      guildIds: [],
      fetchImpl: impl,
    });

    expect(res).toEqual({ registered: 1, scope: 'global' });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      'https://discord.com/api/v10/applications/app-1/commands',
    );
    expect(calls[0].method).toBe('PUT');
  });

  it('sends the Bot authorization header and the full command tree in one array body', async () => {
    const captured: { headers: Record<string, string>; body: string }[] = [];
    const impl: FetchLike = async (_url, init) => {
      captured.push({ headers: init.headers, body: init.body });
      return { ok: true, status: 200, text: async () => '{}' };
    };

    await registerDiscordSlashCommands({
      token: 'super-secret',
      applicationId: 'app-1',
      guildIds: ['g1'],
      fetchImpl: impl,
    });

    expect(captured).toHaveLength(1);
    const call = captured[0];
    expect(call.headers['Authorization']).toBe('Bot super-secret');
    const parsed = JSON.parse(call.body) as CommandJson[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.map((c) => c.name)).toEqual([
      'ptah',
      'sessions',
      'session',
      'new',
      'workspace',
    ]);
    expect(parsed.every((c) => c.type === 1)).toBe(true);
  });

  it('keeps the /ptah prompt command shape byte-identical (AC-1.4)', async () => {
    const { impl, calls } = okFetch();

    await registerDiscordSlashCommands({
      token: 'tok',
      applicationId: 'app-1',
      guildIds: ['g1'],
      fetchImpl: impl,
    });

    const parsed = JSON.parse(calls[0].body) as CommandJson[];
    const ptah = parsed.find((c) => c.name === 'ptah');
    expect(ptah).toEqual({
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
    });
  });

  it('registers the control-plane subcommand tree with autocomplete picks', async () => {
    const { impl, calls } = okFetch();

    await registerDiscordSlashCommands({
      token: 'tok',
      applicationId: 'app-1',
      guildIds: ['g1'],
      fetchImpl: impl,
    });

    const parsed = JSON.parse(calls[0].body) as CommandJson[];

    const sessions = parsed.find((c) => c.name === 'sessions');
    expect(sessions?.options).toBeUndefined();

    const session = parsed.find((c) => c.name === 'session');
    expect(session?.options).toHaveLength(1);
    const sessionUse = session?.options?.[0];
    expect(sessionUse).toEqual(
      expect.objectContaining({ type: 1, name: 'use' }),
    );
    expect(sessionUse?.options?.[0]).toEqual(
      expect.objectContaining({
        type: 3,
        name: 'pick',
        required: true,
        autocomplete: true,
      }),
    );

    const fresh = parsed.find((c) => c.name === 'new');
    expect(fresh?.options).toBeUndefined();

    const workspace = parsed.find((c) => c.name === 'workspace');
    expect(workspace?.options?.map((o) => o.name)).toEqual(['list', 'use']);
    const workspaceList = workspace?.options?.[0];
    expect(workspaceList?.type).toBe(1);
    expect(workspaceList?.options).toBeUndefined();
    const workspaceUse = workspace?.options?.[1];
    expect(workspaceUse?.type).toBe(1);
    expect(workspaceUse?.options?.[0]).toEqual(
      expect.objectContaining({
        type: 3,
        name: 'pick',
        required: true,
        autocomplete: true,
      }),
    );
  });

  it('throws with the Discord status + body when a guild call fails', async () => {
    const impl: FetchLike = async () => ({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    });

    await expect(
      registerDiscordSlashCommands({
        token: 'bad',
        applicationId: 'app-1',
        guildIds: ['g1'],
        fetchImpl: impl,
      }),
    ).rejects.toThrow(/401 Unauthorized/);
  });

  it('rejects when token or applicationId is missing', async () => {
    const { impl } = okFetch();
    await expect(
      registerDiscordSlashCommands({
        token: '',
        applicationId: 'app-1',
        guildIds: [],
        fetchImpl: impl,
      }),
    ).rejects.toThrow(/missing token/);
    await expect(
      registerDiscordSlashCommands({
        token: 'tok',
        applicationId: '',
        guildIds: [],
        fetchImpl: impl,
      }),
    ).rejects.toThrow(/missing applicationId/);
  });
});
