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
});
