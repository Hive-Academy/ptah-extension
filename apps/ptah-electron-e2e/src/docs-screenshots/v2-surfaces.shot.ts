import { test, expect } from '../support/fixtures';
import { shoot, sizeForCapture } from './_harness/shooter';
import { visibleNewSessionTrigger } from '../support/new-session-trigger';

/** Ptah v2 README frames. All renderer RPC calls use the e2e fake listener. */
test.describe('docs screenshots — v2 Electron surfaces', () => {
  test.beforeEach(async ({ electronApp, mainWindow }) => {
    await sizeForCapture(electronApp, mainWindow);
  });

  // Skipped: the mocked RPC fixture has no data for this surface yet, so the
  // capture shows an empty or error state. Re-enable once its seed exists.
  test.skip('Voice stage', async ({ ui, mainWindow }) => {
    await ui.goto('canvas');
    await ui.pushEvent({ type: 'switchView', payload: { view: 'command-center' } });
    await expect(mainWindow.locator('ptah-command-center-page')).toBeVisible();
    await expect(mainWindow.getByRole('main')).toBeVisible();
    await shoot(mainWindow, 'v2-voice-stage');
  });

  test('Thoth Memory curator', async ({ ui, mainWindow }) => {
    const now = Date.now();
    const entry = (id: string, tier: 'core' | 'recall' | 'archival', subject: string, content: string) => ({
      id, sessionId: null, workspaceRoot: 'C:\\ptah-e2e-ws', tier,
      kind: 'fact', subject, content, sourceMessageIds: [], salience: 0.8,
      decayRate: 0.1, hits: 4, pinned: tier === 'core', createdAt: now, updatedAt: now,
    });
    const memories = [
      entry('architecture', 'core', 'Architecture', 'The desktop shell shares the agent engine with the CLI.'),
      entry('billing', 'recall', 'Billing workflow', 'Pricing changes require a review of annual plans.'),
      entry('release', 'archival', 'Release notes', 'The last release added an accessible session rail.'),
    ];
    await ui.mockRpc({
      'memory:stats': { core: 1, recall: 1, archival: 1, codeIndex: 120, lastCuratedAt: now },
      'memory:list': { memories, total: memories.length },
      'memory:searchSymbols': { items: [], total: 0 },
      'indexing:getStatus': { state: 'ready', lastIndexedAt: now, pipelineEnabled: true },
    });
    await ui.openTab('memory');
    await expect(mainWindow.getByTestId('memory-entry-row')).toHaveCount(3);
    await shoot(mainWindow, 'v2-thoth-memory');
  });

  // Skipped: the mocked RPC fixture has no data for this surface yet, so the
  // capture shows an empty or error state. Re-enable once its seed exists.
  test.skip('Canvas session rail', async ({ ui, mainWindow }) => {
    await ui.goto('canvas');
    for (let index = 0; index < 3; index++) {
      await (await visibleNewSessionTrigger(mainWindow)).click();
      await mainWindow.getByRole('button', { name: 'Create', exact: true }).click();
    }
    await expect(mainWindow.locator('ptah-canvas-rail')).toBeVisible();
    await expect(mainWindow.locator('[data-testid="canvas-tile"]')).toHaveCount(3);
    await shoot(mainWindow, 'v2-session-rail');
  });

  // Skipped: the mocked RPC fixture has no data for this surface yet, so the
  // capture shows an empty or error state. Re-enable once its seed exists.
  test.skip('Apps surface', async ({ ui, mainWindow }) => {
    await ui.goto('canvas');
    await ui.pushEvent({ type: 'switchView', payload: { view: 'apps' } });
    await expect(mainWindow.locator('ptah-apps-page')).toBeVisible();
    await expect(mainWindow.locator('ptah-apps-surface-panel')).toContainText('Revenue');
    await shoot(mainWindow, 'v2-apps');
  });

  // Skipped: the mocked RPC fixture has no data for this surface yet, so the
  // capture shows an empty or error state. Re-enable once its seed exists.
  test.skip('Attention bell', async ({ ui, mainWindow }) => {
    await ui.pushEvent({
      type: 'permission:request',
      payload: {
        id: 'f411d81c-2284-4f6d-8d80-4fb72500c913',
        toolName: 'Read',
        toolInput: { file_path: 'src/demo.ts' },
        toolUseId: 'docs-permission-1',
        agentToolCallId: 'docs-agent-call-1',
        timestamp: Date.now(),
        description: 'Read a sample source file',
        timeoutAt: Date.now() + 300_000,
        sessionId: 'bd14377c-bd4d-4f3e-b39a-d48ef09f8b74',
        tabId: '02f7ff94-9e0b-481a-a2e6-e89ffb21d4f1',
        surfaceMode: false,
      },
    });
    await mainWindow.getByTestId('notification-center-bell').click();
    const panel = mainWindow.getByTestId('notification-center-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('Permission');
    await shoot(mainWindow, 'v2-attention-bell');
  });

  // Skipped: the mocked RPC fixture has no data for this surface yet, so the
  // capture shows an empty or error state. Re-enable once its seed exists.
  test.skip('Display panel', async ({ ui, mainWindow }) => {
    await ui.goto('canvas');
    await (await visibleNewSessionTrigger(mainWindow)).click();
    await mainWindow.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(mainWindow.getByTestId('display-sheet')).toBeVisible();
    await mainWindow.getByTestId('display-sheet-tab').click();
    await expect(mainWindow.getByTestId('display-sheet-region')).toContainText('Revenue');
    await shoot(mainWindow, 'v2-display-panel');
  });
});
