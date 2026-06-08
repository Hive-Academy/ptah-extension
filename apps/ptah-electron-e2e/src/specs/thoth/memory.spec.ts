import { test, expect } from '../../support/fixtures';

interface MemoryWireFixture {
  id: string;
  sessionId: string | null;
  workspaceRoot: string | null;
  tier: 'core' | 'recall' | 'archival';
  kind: string;
  subject: string | null;
  content: string;
  sourceMessageIds: string[];
  salience: number;
  decayRate: number;
  hits: number;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
}

function makeEntry(
  id: string,
  tier: 'core' | 'recall' | 'archival',
): MemoryWireFixture {
  return {
    id,
    sessionId: null,
    workspaceRoot: 'C:\\ptah-e2e-ws',
    tier,
    kind: 'fact',
    subject: 'entry ' + id,
    content: 'mocked memory content ' + id,
    sourceMessageIds: [],
    salience: 0.5,
    decayRate: 0.1,
    hits: 0,
    pinned: false,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
  };
}

test.describe('Thoth — Memory tab', () => {
  test('Memory tab renders with mocked stats', async ({ ui }) => {
    const entries: MemoryWireFixture[] = [
      makeEntry('m1', 'core'),
      makeEntry('m2', 'recall'),
      makeEntry('m3', 'archival'),
    ];

    await ui.mockRpc({
      'memory:stats': {
        core: 3,
        recall: 5,
        archival: 2,
        codeIndex: 120,
        lastCuratedAt: 1_700_000_000_000,
      },
      'memory:list': { memories: entries, total: entries.length },
      'memory:searchSymbols': { items: [], total: 0 },
      'indexing:getStatus': {
        state: 'ready',
        lastIndexedAt: 1_700_000_000_000,
        pipelineEnabled: true,
      },
    });

    await ui.openTab('memory');

    const page = ui.page;

    await expect(page.locator('[data-testid="memory-stat-core"]')).toHaveText(
      '3',
    );
    await expect(page.locator('[data-testid="memory-stat-recall"]')).toHaveText(
      '5',
    );
    await expect(
      page.locator('[data-testid="memory-stat-archival"]'),
    ).toHaveText('2');
    await expect(
      page.locator('[data-testid="memory-stat-code-index"]'),
    ).toHaveText('120');

    await expect(page.locator('[data-testid="memory-entry-row"]')).toHaveCount(
      3,
    );
  });

  test('search debounces and calls memory:search', async ({ ui }) => {
    const all: MemoryWireFixture[] = [
      makeEntry('m1', 'core'),
      makeEntry('m2', 'recall'),
      makeEntry('m3', 'archival'),
    ];
    const hit = makeEntry('m2', 'recall');

    await ui.mockRpc({
      'memory:stats': {
        core: 3,
        recall: 5,
        archival: 2,
        codeIndex: 120,
        lastCuratedAt: 1_700_000_000_000,
      },
      'memory:list': { memories: all, total: all.length },
      'memory:searchSymbols': { items: [], total: 0 },
      'indexing:getStatus': {
        state: 'ready',
        lastIndexedAt: 1_700_000_000_000,
        pipelineEnabled: true,
      },
      'memory:search': {
        hits: [
          {
            memory: hit,
            chunk: {
              id: 'c2',
              memoryId: 'm2',
              ordinal: 0,
              content: hit.content,
              tokenCount: 0,
              createdAt: hit.createdAt,
            },
            score: 0.9,
            bm25Rank: 1,
            vecRank: 1,
          },
        ],
        bm25Only: false,
      },
    });

    await ui.openTab('memory');

    const page = ui.page;

    await expect(page.locator('[data-testid="memory-entry-row"]')).toHaveCount(
      3,
    );

    await page.locator('[data-testid="memory-search-input"]').fill('m2');

    await expect(page.locator('[data-testid="memory-entry-row"]')).toHaveCount(
      1,
    );

    const observed = await ui.waitForObservedCall('memory:search');
    expect((observed.params as { query?: string }).query).toBe('m2');
  });

  test('pin updates the row', async ({ ui }) => {
    const entry = makeEntry('m1', 'core');

    await ui.mockRpc({
      'memory:stats': {
        core: 1,
        recall: 0,
        archival: 0,
        codeIndex: 0,
        lastCuratedAt: 1_700_000_000_000,
      },
      'memory:list': { memories: [entry], total: 1 },
      'memory:searchSymbols': { items: [], total: 0 },
      'indexing:getStatus': {
        state: 'ready',
        lastIndexedAt: 1_700_000_000_000,
        pipelineEnabled: true,
      },
      'memory:pin': { success: true, pinned: true },
    });

    await ui.openTab('memory');

    const page = ui.page;
    const row = page.locator('[data-testid="memory-entry-row"]');

    await expect(row).toHaveCount(1);
    await expect(row.locator('[data-testid="memory-entry-pin"]')).toBeVisible();

    await row.locator('[data-testid="memory-entry-pin"]').click();

    await expect(
      row.locator('[data-testid="memory-entry-unpin"]'),
    ).toBeVisible();
    await expect(row.getByText('pinned')).toBeVisible();
  });
});
