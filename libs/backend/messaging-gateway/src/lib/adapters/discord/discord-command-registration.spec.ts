import {
  registerDiscordSlashCommands,
  type FetchLike,
} from './discord-command-registration';

function okFetch(): { impl: FetchLike; calls: string[] } {
  const calls: string[] = [];
  const impl: FetchLike = async (url) => {
    calls.push(url);
    return { ok: true, status: 200, text: async () => '{}' };
  };
  return { impl, calls };
}

describe('registerDiscordSlashCommands', () => {
  it('registers one guild command per guild id (instant scope)', async () => {
    const { impl, calls } = okFetch();

    const res = await registerDiscordSlashCommands({
      token: 'tok',
      applicationId: 'app-1',
      guildIds: ['g1', 'g2'],
      fetchImpl: impl,
    });

    expect(res).toEqual({ registered: 2, scope: 'guild' });
    expect(calls).toEqual([
      'https://discord.com/api/v10/applications/app-1/guilds/g1/commands',
      'https://discord.com/api/v10/applications/app-1/guilds/g2/commands',
    ]);
  });

  it('falls back to a single global registration when no guilds are set', async () => {
    const { impl, calls } = okFetch();

    const res = await registerDiscordSlashCommands({
      token: 'tok',
      applicationId: 'app-1',
      guildIds: [],
      fetchImpl: impl,
    });

    expect(res).toEqual({ registered: 1, scope: 'global' });
    expect(calls).toEqual([
      'https://discord.com/api/v10/applications/app-1/commands',
    ]);
  });

  it('sends the Bot authorization header and the ptah command body', async () => {
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
    const parsed = JSON.parse(call.body);
    expect(parsed.name).toBe('ptah');
    expect(parsed.options[0]).toEqual(
      expect.objectContaining({ name: 'prompt', type: 3, required: true }),
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
