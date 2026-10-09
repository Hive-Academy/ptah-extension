import { EventEmitter } from 'events';
import type { IProcessSpawner } from '@ptah-extension/platform-core';
import {
  parseCodexModelCatalog,
  probeCodexModelCatalog,
} from './codex-model-catalog';

/** Shape of `codex debug models` (codex-cli 0.161.0), trimmed to the read fields. */
const CATALOG = {
  models: [
    {
      slug: 'gpt-5.6-luna',
      display_name: 'GPT-5.6-Luna',
      visibility: 'list',
      priority: 9,
    },
    {
      slug: 'gpt-6.1-sol',
      display_name: 'GPT-6.1-Sol',
      visibility: 'list',
      priority: 1,
    },
    {
      slug: 'codex-auto-review',
      display_name: 'Codex Auto Review',
      visibility: 'hide',
      priority: 43,
    },
    {
      slug: 'gpt-6-astra',
      display_name: 'GPT-6-Astra',
      visibility: 'list',
      priority: 2,
    },
    {
      slug: 'gpt-reserve',
      display_name: 'GPT-Reserve',
      visibility: 'hide',
      priority: 4,
    },
  ],
};

describe('parseCodexModelCatalog', () => {
  it('offers only listed models, in menu (priority) order', () => {
    expect(parseCodexModelCatalog(JSON.stringify(CATALOG))).toEqual([
      { id: 'gpt-6.1-sol', name: 'GPT-6.1-Sol' },
      { id: 'gpt-6-astra', name: 'GPT-6-Astra' },
      { id: 'gpt-5.6-luna', name: 'GPT-5.6-Luna' },
    ]);
  });

  it('falls back to the slug for a missing name and keeps input order without priority', () => {
    const stdout = JSON.stringify({
      models: [
        { slug: 'b-model', visibility: 'list' },
        { slug: 'a-model', display_name: ' ', visibility: 'list' },
      ],
    });
    expect(parseCodexModelCatalog(stdout)).toEqual([
      { id: 'b-model', name: 'b-model' },
      { id: 'a-model', name: 'a-model' },
    ]);
  });

  it.each([
    ['non-JSON output', 'error: unknown command debug'],
    ['an unexpected shape', JSON.stringify({ data: [] })],
    [
      'an entry without a slug',
      JSON.stringify({ models: [{ visibility: 'list' }] }),
    ],
  ])('returns [] for %s so the caller falls back', (_case, stdout) => {
    expect(parseCodexModelCatalog(stdout)).toEqual([]);
  });
});

describe('probeCodexModelCatalog', () => {
  it('resolves undefined on timeout even when the handle throws on kill', async () => {
    const child = Object.assign(new EventEmitter(), {
      stdout: Object.assign(new EventEmitter(), { setEncoding: jest.fn() }),
      kill: jest.fn(() => {
        throw new Error('kill failed');
      }),
    });
    const spawner = {
      spawnProcess: jest.fn(() => child),
    } as unknown as IProcessSpawner;

    await expect(
      probeCodexModelCatalog('codex', { spawner, timeoutMs: 5 }),
    ).resolves.toBeUndefined();
    expect(child.kill).toHaveBeenCalledTimes(1);
  });
});
