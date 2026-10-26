import type {
  GenerationPreviewAgent,
  WizardPlanPackInstallResult,
  WizardPreviewGenerationResponse,
} from '@ptah-extension/shared';
import {
  TARGET_CHANGED_STATUS,
  agentsFolder,
  buildPackRows,
  buildWizardRows,
  bulkCountLabel,
  confirmLabel,
  controllableCount,
  decisionEntries,
  nextSnapshot,
  replaceAriaLabel,
  setAllDecisions,
  setDecision,
  stateBadge,
  summaryText,
  targetFolder,
  targetsSignature,
  type DecisionSnapshot,
} from './preview-decisions.state';

function agent(
  agentId: string,
  localState: 'new' | 'exists' | 'unreadable' | undefined,
  revision?: string,
  extra: Partial<GenerationPreviewAgent> = {},
): GenerationPreviewAgent {
  return {
    agentId,
    files: [
      {
        relPath: `.claude/agents/${agentId}.md`,
        target: 'claude',
        certainty: 'definite',
        willOverwrite: localState !== 'new',
        localState,
        revision,
      },
      {
        relPath: `.codex/agents/${agentId}.toml`,
        target: 'codex',
        certainty: 'definite',
        willOverwrite: false,
      },
    ],
    ...extra,
  };
}

function preview(
  ...agents: GenerationPreviewAgent[]
): WizardPreviewGenerationResponse {
  return { agents };
}

function packPlan(
  files: WizardPlanPackInstallResult['files'],
): WizardPlanPackInstallResult {
  return {
    planToken: 'plan-token',
    target: {
      harnessRoot: 'D:/work/acme',
      openedFolder: 'D:/work/acme/packages/api',
      chosen: 'harness-root',
      openedIsHarnessRoot: false,
    },
    files,
  };
}

function first(
  response: WizardPreviewGenerationResponse,
  target: 'harness-root' | 'opened-folder' = 'harness-root',
): DecisionSnapshot {
  return nextSnapshot(null, buildWizardRows(response), target);
}

describe('preview-decisions.state', () => {
  describe('buildWizardRows', () => {
    it('builds one Keep row per agent from its Claude source file', () => {
      const rows = buildWizardRows(
        preview(
          agent('backend', 'exists', 'r1', { libraryCopyEdited: true }),
          agent('tester', 'new'),
          agent('planner', 'unreadable', 'r2'),
          agent('reviewer', 'exists', 'r3', {
            unchangedSinceWizardWrite: true,
          }),
        ),
      );
      expect(rows.map((row) => [row.id, row.state, row.decision])).toEqual([
        ['backend', 'exists', 'keep'],
        ['tester', 'new', 'keep'],
        ['planner', 'unreadable', 'keep'],
        ['reviewer', 'exists', 'keep'],
      ]);
      expect(rows[0].path).toBe('.claude/agents/backend.md');
      expect(rows[0].libraryCopyEdited).toBe(true);
      expect(rows[2].forcedKeep).toBe(true);
      expect(rows[3].unchangedSinceWizardWrite).toBe(true);
      expect(stateBadge(rows[0])).toBe('Exists — may be replaced');
      expect(stateBadge(rows[1])).toBe('New');
      expect(stateBadge(rows[2])).toBe('Could not read file');
    });

    it('treats an unknown local state on an existing path as forced Keep', () => {
      const [row] = buildWizardRows(preview(agent('legacy', undefined)));
      expect(row.state).toBe('unreadable');
      expect(row.forcedKeep).toBe(true);
    });

    it('skips agents without a definite Claude source file', () => {
      const rows = buildWizardRows(
        preview({ agentId: 'odd', files: [] }, agent('ok', 'new')),
      );
      expect(rows.map((row) => row.id)).toEqual(['ok']);
    });
  });

  describe('buildPackRows', () => {
    it('maps every plan file, with texts for the diff', () => {
      const rows = buildPackRows(
        packPlan([
          { file: 'a.md', state: 'new', revision: 'n' },
          { file: 'b.md', state: 'identical', revision: 'i' },
          {
            file: 'c.md',
            state: 'differs',
            revision: 'd',
            localText: 'old',
            incomingText: 'new',
          },
          { file: 'd.md', state: 'unreadable', revision: 'u' },
        ]),
      );
      expect(rows.map(stateBadge)).toEqual([
        'New',
        'Already current',
        'Differs from local file',
        'Could not read file',
      ]);
      expect(rows.every((row) => row.decision === 'keep')).toBe(true);
      expect(rows[2].localText).toBe('old');
      expect(rows[2].incomingText).toBe('new');
      expect(rows[3].forcedKeep).toBe(true);
      expect(controllableCount(rows)).toBe(1);
    });
  });

  describe('decisions', () => {
    const base = () =>
      first(
        preview(
          agent('a', 'exists', 'ra'),
          agent('b', 'exists', 'rb'),
          agent('u', 'unreadable', 'ru'),
          agent('n', 'new'),
        ),
      );

    it('starts every row on Keep', () => {
      const snapshot = base();
      expect(snapshot.rows.every((row) => row.decision === 'keep')).toBe(true);
      expect(snapshot.status).toBeNull();
      expect(summaryText(snapshot.rows)).toBe('3 kept, 0 to replace');
      expect(decisionEntries(snapshot.rows)).toEqual({});
    });

    it('never sets Replace on a forced-keep or new row', () => {
      let snapshot = base();
      snapshot = setDecision(snapshot, 'u', 'replace');
      snapshot = setDecision(snapshot, 'n', 'replace');
      expect(snapshot.rows.every((row) => row.decision === 'keep')).toBe(true);
    });

    it('Replace all skips the forced-keep row; Keep all resets', () => {
      let snapshot = setAllDecisions(base(), 'replace');
      expect(
        Object.fromEntries(snapshot.rows.map((row) => [row.id, row.decision])),
      ).toEqual({ a: 'replace', b: 'replace', u: 'keep', n: 'keep' });
      expect(summaryText(snapshot.rows)).toBe('1 kept, 2 to replace');
      snapshot = setAllDecisions(snapshot, 'keep');
      expect(snapshot.rows.every((row) => row.decision === 'keep')).toBe(true);
    });

    it('sends {decision, revision} for each Replace only', () => {
      const snapshot = setDecision(base(), 'b', 'replace');
      expect(decisionEntries(snapshot.rows)).toEqual({
        b: { decision: 'replace', revision: 'rb' },
      });
    });

    it('returns the same snapshot when nothing changes', () => {
      const snapshot = base();
      expect(setDecision(snapshot, 'a', 'keep')).toBe(snapshot);
      expect(setAllDecisions(snapshot, 'keep')).toBe(snapshot);
    });
  });

  describe('nextSnapshot', () => {
    it('keeps a Replace when the revision is unchanged', () => {
      const before = setDecision(
        first(preview(agent('a', 'exists', 'r1'))),
        'a',
        'replace',
      );
      const after = nextSnapshot(
        before,
        buildWizardRows(preview(agent('a', 'exists', 'r1'))),
        'harness-root',
      );
      expect(after.rows[0].decision).toBe('replace');
      expect(after.status).toBeNull();
    });

    it('exists(A) -> exists(B) re-preview resets Replace to Keep', () => {
      const before = setDecision(
        first(preview(agent('a', 'exists', 'rev-A'))),
        'a',
        'replace',
      );
      const after = nextSnapshot(
        before,
        buildWizardRows(preview(agent('a', 'exists', 'rev-B'))),
        'harness-root',
      );
      expect(after.rows[0].decision).toBe('keep');
      expect(decisionEntries(after.rows)).toEqual({});
    });

    it('does not carry a Replace onto a row that became unreadable', () => {
      const before = setDecision(
        first(preview(agent('a', 'exists', 'r1'))),
        'a',
        'replace',
      );
      const after = nextSnapshot(
        before,
        buildWizardRows(preview(agent('a', 'unreadable', 'r1'))),
        'harness-root',
      );
      expect(after.rows[0].decision).toBe('keep');
    });

    it('does not carry a Replace when either revision is missing', () => {
      const before = setDecision(
        first(preview(agent('a', 'exists'))),
        'a',
        'replace',
      );
      const after = nextSnapshot(
        before,
        buildWizardRows(preview(agent('a', 'exists'))),
        'harness-root',
      );
      expect(after.rows[0].decision).toBe('keep');
    });

    it('a target change resets every choice to Keep and sets the status', () => {
      const before = setAllDecisions(
        first(preview(agent('a', 'exists', 'r1'), agent('b', 'exists', 'r2'))),
        'replace',
      );
      const after = nextSnapshot(
        before,
        buildWizardRows(
          preview(agent('a', 'exists', 'r1'), agent('b', 'exists', 'r2')),
        ),
        'opened-folder',
      );
      expect(after.rows.every((row) => row.decision === 'keep')).toBe(true);
      expect(after.target).toBe('opened-folder');
      expect(after.status).toBe(TARGET_CHANGED_STATUS);
    });

    it('pack differs(A) -> differs(B) resets Replace to Keep', () => {
      const plan = (revision: string) =>
        buildPackRows(
          packPlan([{ file: 'perf-tuner.md', state: 'differs', revision }]),
        );
      const before = setDecision(
        nextSnapshot(null, plan('A'), 'harness-root'),
        'perf-tuner.md',
        'replace',
      );
      expect(before.rows[0].decision).toBe('replace');
      const same = nextSnapshot(before, plan('A'), 'harness-root');
      expect(same.rows[0].decision).toBe('replace');
      const changed = nextSnapshot(before, plan('B'), 'harness-root');
      expect(changed.rows[0].decision).toBe('keep');
    });
  });

  describe('labels', () => {
    it('confirm labels per surface', () => {
      expect(confirmLabel('wizard-modal', 0)).toBe('Confirm Generate');
      expect(confirmLabel('wizard-modal', 1)).toBe(
        'Confirm Generate, replace 1 file',
      );
      expect(confirmLabel('sidebar-dialog', 0)).toBe('Confirm and generate');
      expect(confirmLabel('sidebar-dialog', 3)).toBe(
        'Confirm and generate, replace 3 files',
      );
      expect(confirmLabel('pack', 0)).toBe('Install pack');
      expect(confirmLabel('pack', 2)).toBe('Install pack, replace 2 files');
    });

    it('bulk count labels', () => {
      expect(bulkCountLabel('wizard', 4)).toBe('4 existing files');
      expect(bulkCountLabel('wizard', 1)).toBe('1 existing file');
      expect(bulkCountLabel('pack', 2)).toBe('2 files can be replaced');
      expect(bulkCountLabel('pack', 1)).toBe('1 file can be replaced');
    });

    it('replace accessible names, with the forced-keep suffix', () => {
      expect(replaceAriaLabel('a.md', 'wizard', false)).toBe(
        'Replace a.md with generated version',
      );
      expect(replaceAriaLabel('a.md', 'pack', true)).toBe(
        'Replace a.md with pack version (not available: file could not be read)',
      );
    });

    it('summary is null when no row has a control', () => {
      expect(summaryText(buildWizardRows(preview(agent('n', 'new'))))).toBe(
        null,
      );
    });
  });

  describe('targets', () => {
    it('signature ignores order and duplicates, and sees overwrite changes', () => {
      const a = preview(agent('a', 'exists', 'r'), agent('b', 'new'));
      const b = preview(agent('b', 'new'), agent('a', 'exists', 'r'));
      expect(targetsSignature(a)).toBe(targetsSignature(b));
      const c = preview(agent('a', 'exists', 'r'), agent('b', 'exists', 'r'));
      expect(targetsSignature(c)).not.toBe(targetsSignature(a));
    });

    it('ignores conditional targets in the signature', () => {
      const plain = preview(agent('a', 'new'));
      const withConditional = preview({
        ...agent('a', 'new'),
        files: [
          ...agent('a', 'new').files,
          {
            relPath: '.opencode/agents/a.md',
            target: 'opencode',
            certainty: 'conditional',
            condition: 'if agent sync is enabled for this agent',
            willOverwrite: false,
          },
        ],
      });
      expect(targetsSignature(withConditional)).toBe(targetsSignature(plain));
    });

    it('agents folder keeps the root separator style', () => {
      expect(agentsFolder('D:/work/acme/')).toBe('D:/work/acme/.claude/agents');
      expect(agentsFolder('D:\\work\\acme')).toBe(
        'D:\\work\\acme\\.claude\\agents',
      );
      expect(
        targetFolder(packPlan([]).target, 'opened-folder'),
      ).toBe('D:/work/acme/packages/api/.claude/agents');
    });
  });
});
