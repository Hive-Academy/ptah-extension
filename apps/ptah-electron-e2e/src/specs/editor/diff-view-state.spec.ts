import { test, expect } from '../../support/fixtures';
import { gitDiffFileMock } from '../../support/git-diff-mock';

/**
 * Diff editor lifecycle — EMPIRICAL verification in Electron (TASK_2026_173,
 * batch 3, tasks 3.2 / 3.4; B1 AC1, AC3, AC4).
 *
 * Three claims are checked against the REAL pinned Monaco (0.55.x) in the real
 * renderer, because none of them can be honestly settled by a faked API:
 *
 *   B1 AC1 — the diff editor instance survives a switch away and back. Proved
 *            by branding the live editor object and finding the brand again.
 *   B1 AC3 — scroll position is restored per tab via saveViewState /
 *            restoreViewState around setModel.
 *   B1 AC4 — collapsed regions. RISK A-3 says to verify this empirically and
 *            to RECORD A SHORTFALL rather than claim a pass. The probe reads
 *            the folding option and the folding contribution's saved state
 *            straight off the live editor; see the assertions at the bottom
 *            for what the pinned version actually does.
 */

const MAIN_TS_PATH = 'C:\\ptah-e2e-ws\\src\\big-file.ts';
const LINE_COUNT = 500;

function makeContent(changedLine: number, changedValue: string): string {
  const lines: string[] = [];
  for (let i = 1; i <= LINE_COUNT; i++) {
    lines.push(
      i === changedLine
        ? changedValue
        : `export function line${i}() {\n  return ${i};\n}`,
    );
  }
  return lines.join('\n') + '\n';
}

const ORIGINAL_CONTENT = makeContent(
  250,
  'export function line250() {\n  return -1;\n}',
);
const MODIFIED_CONTENT = makeContent(
  250,
  'export function line250() {\n  return 250;\n}',
);

interface DiffProbe {
  found: boolean;
  brand?: number;
  scrollTop?: number;
  foldingEnabled?: boolean;
  foldingState?: unknown;
  hasCollapsedRegions?: boolean;
}

/**
 * Read the live standalone diff editor. Declared as a string-free page
 * function so Playwright serializes it; `window.monaco` is the shared handle
 * the Monaco loader publishes for the ngx wrapper.
 */
function probeDiffEditor(action: 'brand' | 'read'): DiffProbe {
  interface StandaloneDiffEditor {
    __ptahBrand?: number;
    getModifiedEditor(): {
      getScrollTop(): number;
      setScrollTop(top: number): void;
      getRawOptions(): { folding?: boolean };
      saveViewState(): {
        contributionsState?: Record<string, unknown>;
      } | null;
    };
  }
  const monacoApi = (
    window as unknown as {
      monaco?: { editor: { getDiffEditors(): StandaloneDiffEditor[] } };
    }
  ).monaco;
  const editors = monacoApi?.editor.getDiffEditors() ?? [];
  const diffEditor = editors[0];
  if (!diffEditor) return { found: false };

  const modified = diffEditor.getModifiedEditor();
  if (action === 'brand') {
    diffEditor.__ptahBrand = 4173;
    modified.setScrollTop(400);
    return { found: true, brand: diffEditor.__ptahBrand };
  }

  const viewState = modified.saveViewState();
  const foldingState = viewState?.contributionsState?.[
    'editor.contrib.folding'
  ] as { collapsedRegions?: unknown[] } | undefined;

  return {
    found: true,
    brand: diffEditor.__ptahBrand,
    scrollTop: modified.getScrollTop(),
    foldingEnabled: modified.getRawOptions().folding !== false,
    foldingState: foldingState ?? null,
    hasCollapsedRegions: Array.isArray(foldingState?.collapsedRegions)
      ? foldingState.collapsedRegions.length > 0
      : false,
  };
}

test.describe('diff editor lifecycle (B1 AC1/AC3/AC4)', () => {
  test('survives a tab round trip, restores scroll, and reports folding support', async ({
    ui,
  }) => {
    await ui.mockRpc({
      'editor:getFileTree': {
        tree: [{ name: 'big-file.ts', type: 'file', path: MAIN_TS_PATH }],
      },
      'editor:openFile': {
        content: MODIFIED_CONTENT,
        language: 'typescript',
        path: MAIN_TS_PATH,
        filePath: MAIN_TS_PATH,
      },
      // Built through the contract-typed factory, NOT hand-written. The inline
      // literal that used to sit here omitted `patch` and `hunks` — both
      // REQUIRED by `GitDiffFileResult` — which is the same drift TASK_2026_231
      // found in the perf M1 harness, and it cost this spec the same way: the
      // diff tab button never reached the DOM and the wait below timed out.
      // Confirmed by an A/B probe over this exact flow: with the literal the
      // tab strip ended at "Switch to big-file.ts" and the renderer logged six
      // `Angular Error: TypeError: Cannot read properties of undefined
      // (reading 'length')`; with a valid payload the diff tab appeared and
      // those errors were gone. See `git-diff-mock.ts` for the mechanism.
      'git:diffFile': gitDiffFileMock({
        path: 'src/big-file.ts',
        comparison: 'worktree',
        original: ORIGINAL_CONTENT,
        modified: MODIFIED_CONTENT,
        snapshotToken: 'view-state-probe',
      }),
    });

    await ui.goto('editor');
    const page = ui.page;

    const fileNode = page.locator('[data-testid="editor-file-node"]', {
      hasText: 'big-file.ts',
    });
    await expect(fileNode).toBeVisible();
    await fileNode.click();

    const fileTabBtn = page.locator(
      'ptah-editor-panel [role="tab"][aria-label="Switch to big-file.ts"]',
    );
    await expect(fileTabBtn).toBeVisible();

    await page.getByRole('tab', { name: 'Git' }).click();
    const changedRow = page.locator('[role="listitem"]', {
      hasText: 'big-file.ts',
    });
    await ui.pushEvent({
      type: 'git:status-update',
      payload: {
        branch: {
          branch: 'main',
          upstream: 'origin/main',
          ahead: 0,
          behind: 0,
        },
        files: [
          {
            path: 'src/big-file.ts',
            status: 'M',
            staged: false,
            isDirectory: false,
          },
        ],
        isGitRepo: true,
      },
    });
    await expect(changedRow).toBeVisible({ timeout: 10_000 });
    await changedRow.click();

    const diffTabBtn = page.locator(
      'ptah-editor-panel [role="tab"][aria-label="Switch to big-file.ts (working tree)"]',
    );
    await expect(diffTabBtn).toBeVisible();
    await expect(page.locator('ptah-diff-view .view-lines').last()).toBeVisible(
      {
        timeout: 15_000,
      },
    );

    // Brand the live editor and scroll the modified side.
    const branded = await page.evaluate(probeDiffEditor, 'brand' as const);
    expect(branded.found).toBe(true);

    // Round trip: away to the plain file tab, then back to the diff.
    await fileTabBtn.click();
    await expect(page.locator('ptah-diff-view')).toHaveCount(1);
    await expect(page.locator('ptah-diff-view .view-line')).toHaveCount(0);
    await diffTabBtn.click();
    await expect(page.locator('ptah-diff-view .view-line').first()).toBeVisible(
      {
        timeout: 15_000,
      },
    );

    const after = await page.evaluate(probeDiffEditor, 'read' as const);

    // B1 AC1 — same instance. A rebuilt editor would have lost the brand.
    expect(after.found).toBe(true);
    expect(after.brand).toBe(4173);

    // B1 AC3 — scroll position came back with the tab.
    expect(after.scrollTop).toBeGreaterThan(0);

    // B1 AC4 — RECORDED SHORTFALL, not a pass.
    //
    // Monaco's diff editor hard-disables classic folding on BOTH sub-editors
    // (`clonedOptions.folding = false`,
    // esm/vs/editor/browser/widget/diffEditor/components/diffEditorEditors.js).
    // FoldingController therefore reports `_isEnabled === false` and its
    // saveViewState() returns `{}` with no `collapsedRegions` at all — there is
    // no collapsed-region state to preserve because a diff editor cannot have
    // collapsed regions on this version. This assertion PINS that observation
    // so the day Monaco changes it, the shortfall is revisited rather than
    // silently assumed still true.
    expect(after.foldingEnabled).toBe(false);
    expect(after.hasCollapsedRegions).toBe(false);

    console.log(
      `[diff-view-state] brand=${after.brand} scrollTop=${after.scrollTop} ` +
        `foldingEnabled=${after.foldingEnabled} ` +
        `foldingState=${JSON.stringify(after.foldingState)}`,
    );
  });
});
