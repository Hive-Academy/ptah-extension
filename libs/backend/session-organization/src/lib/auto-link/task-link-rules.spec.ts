import {
  AUTO_RULES,
  isProtectedSource,
  parseOrchestrateExpansion,
  parseOrchestrateTaskId,
  planAutoLinks,
  rankOfRule,
  sourceOfRule,
  taskIdsInWorktreeName,
  worktreeEvidence,
  type AutoCandidate,
  type CurrentTaskLink,
  type TaskLinkWrite,
} from './task-link-rules';
import { SESSION_TASK_LINK_SOURCES } from '@ptah-extension/shared';

const A = 'TASK_2026_101';
const B = 'TASK_2026_102';
const C = 'TASK_2026_103';

function explicit(
  taskId: string,
  role: CurrentTaskLink['role'],
  source: CurrentTaskLink['source'] = 'user',
  createdAt = 1,
): CurrentTaskLink {
  return { taskId, role, source, autoRule: null, autoEvidence: null, createdAt };
}

function candidate(
  taskId: string,
  rule: AutoCandidate['rule'],
  role: AutoCandidate['role'] = rule === 'R6' ? 'related' : 'primary',
  evidence: string | null = null,
): AutoCandidate {
  return { taskId, rule, role, evidence };
}

/** Apply writes to rows the way the store does (demote-then-write). */
function apply(
  current: readonly CurrentTaskLink[],
  writes: readonly TaskLinkWrite[],
  now = 100,
): CurrentTaskLink[] {
  let rows = current.map((row) => ({ ...row }));
  for (const write of writes) {
    if (write.kind === 'delete') {
      rows = rows.filter((row) => row.taskId !== write.taskId);
      continue;
    }
    if (write.role === 'primary') {
      for (const row of rows) {
        if (row.role === 'primary' && row.taskId !== write.taskId) {
          row.role = 'related';
        }
      }
    }
    const existing = rows.find((row) => row.taskId === write.taskId);
    const next = {
      taskId: write.taskId,
      role: write.role,
      source: write.source,
      autoRule: write.autoRule,
      autoEvidence: write.autoEvidence,
      createdAt: existing?.createdAt ?? now,
    };
    rows = existing
      ? rows.map((row) => (row.taskId === write.taskId ? next : row))
      : [...rows, next];
  }
  return rows.sort((a, b) => a.taskId.localeCompare(b.taskId));
}

function reconcile(
  current: readonly CurrentTaskLink[],
  desired: readonly AutoCandidate[],
  suppressed: ReadonlySet<string> = new Set(),
): CurrentTaskLink[] {
  return apply(current, planAutoLinks(current, suppressed, desired));
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [
      item,
      ...rest,
    ]),
  );
}

describe('precedence table', () => {
  it('ranks R3 < R4 < R5 < R7 < R6 below the explicit sources', () => {
    const order = [...AUTO_RULES].sort((a, b) => rankOfRule(a) - rankOfRule(b));
    expect(order).toEqual(['R3', 'R4', 'R5', 'R7', 'R6']);
    expect(rankOfRule('R3')).toBeGreaterThan(1);
  });

  it('protects exactly user, agent and board-start', () => {
    expect(SESSION_TASK_LINK_SOURCES.filter(isProtectedSource)).toEqual([
      'board-start',
      'agent',
      'user',
    ]);
  });

  it('maps each rule to its stored source', () => {
    expect(AUTO_RULES.map(sourceOfRule)).toEqual([
      'orchestrate',
      'worktree',
      'worktree',
      'inherited',
      'inherited',
    ]);
  });
});

describe('planAutoLinks', () => {
  it('R3/R4/R5 ask for primary; the best rank wins it', () => {
    const rows = reconcile(
      [],
      [candidate(A, 'R5'), candidate(B, 'R4'), candidate(C, 'R6')],
    );
    expect(rows).toEqual([
      expect.objectContaining({ taskId: A, role: 'related', autoRule: 'R5' }),
      expect.objectContaining({ taskId: B, role: 'primary', autoRule: 'R4', source: 'worktree' }),
      expect.objectContaining({ taskId: C, role: 'related', autoRule: 'R6', source: 'inherited' }),
    ]);
  });

  it('never writes a protected row, even when a rule names its task', () => {
    const current = [explicit(A, 'related', 'agent')];
    const writes = planAutoLinks(current, new Set(), [candidate(A, 'R4')]);
    expect(writes).toEqual([]);
  });

  it('a protected primary turns every automatic candidate into related', () => {
    const rows = reconcile(
      [explicit(A, 'primary', 'user')],
      [candidate(B, 'R3'), candidate(C, 'R4')],
    );
    expect(rows.map((r) => [r.taskId, r.role])).toEqual([
      [A, 'primary'],
      [B, 'related'],
      [C, 'related'],
    ]);
  });

  it('never outputs a suppressed task and deletes its automatic row', () => {
    const current: CurrentTaskLink[] = [
      { ...explicit(A, 'primary'), source: 'worktree', autoRule: 'R4' },
    ];
    expect(planAutoLinks(current, new Set([A]), [candidate(A, 'R4')])).toEqual(
      [{ kind: 'delete', taskId: A }],
    );
  });

  it('deletes an R4 row whose evidence vanished and adds the new one', () => {
    const before = reconcile([], [candidate(A, 'R4', 'primary', 'wt-a')]);
    const after = reconcile(before, [candidate(B, 'R4', 'primary', 'wt-b')]);
    expect(after).toEqual([
      expect.objectContaining({ taskId: B, role: 'primary', autoEvidence: 'wt-b' }),
    ]);
  });

  it('removes an R5 row when the peers become ambiguous', () => {
    const before = reconcile([], [candidate(A, 'R5')]);
    expect(reconcile(before, [])).toEqual([]);
  });

  it('an R6 row follows the parent primary', () => {
    const before = reconcile([], [candidate(A, 'R6', 'related', 'parent')]);
    const after = reconcile(before, [candidate(B, 'R6', 'related', 'parent')]);
    expect(after).toEqual([
      expect.objectContaining({ taskId: B, role: 'related', autoRule: 'R6' }),
    ]);
  });

  it('R7 copies the fork source roles', () => {
    const rows = reconcile(
      [],
      [candidate(A, 'R7', 'related', 'src'), candidate(B, 'R7', 'primary', 'src')],
    );
    expect(rows.map((r) => [r.taskId, r.role, r.source])).toEqual([
      [A, 'related', 'inherited'],
      [B, 'primary', 'inherited'],
    ]);
  });

  it('keeps R3 rows without evidence; the earliest R3 keeps primary', () => {
    const current: CurrentTaskLink[] = [
      { ...explicit(A, 'primary'), source: 'orchestrate', autoRule: 'R3', createdAt: 5 },
      { ...explicit(B, 'related'), source: 'orchestrate', autoRule: 'R3', createdAt: 9 },
    ];
    expect(planAutoLinks(current, new Set(), [])).toEqual([]);
    // A later /orchestrate of a third task does not take the primary.
    const rows = reconcile(current, [candidate(C, 'R3')]);
    expect(rows.find((r) => r.role === 'primary')?.taskId).toBe(A);
  });

  it('an R4 candidate beats an existing R5 primary', () => {
    const before = reconcile([], [candidate(A, 'R5')]);
    const after = reconcile(before, [candidate(B, 'R4')]);
    expect(after).toEqual([expect.objectContaining({ taskId: B, role: 'primary' })]);
  });

  it('keeps the best rank when two rules name the same task', () => {
    const rows = reconcile([], [candidate(A, 'R6'), candidate(A, 'R4')]);
    expect(rows).toEqual([
      expect.objectContaining({ taskId: A, role: 'primary', autoRule: 'R4' }),
    ]);
  });

  it('a user adoption (rule cleared) is never touched again', () => {
    const adopted = [explicit(A, 'related', 'user')];
    expect(planAutoLinks(adopted, new Set(), [candidate(A, 'R4')])).toEqual([]);
    expect(planAutoLinks(adopted, new Set(), [])).toEqual([]);
  });

  it('a legacy row with an unknown rule is treated as protected', () => {
    const legacy: CurrentTaskLink[] = [
      { ...explicit(A, 'primary'), source: 'worktree', autoRule: 'R9' },
    ];
    expect(planAutoLinks(legacy, new Set(), [])).toEqual([]);
  });

  it('writes deletes first and the primary last', () => {
    const current: CurrentTaskLink[] = [
      { ...explicit(A, 'primary'), source: 'worktree', autoRule: 'R5' },
      { ...explicit(C, 'related'), source: 'inherited', autoRule: 'R6' },
    ];
    const writes = planAutoLinks(current, new Set(), [
      candidate(A, 'R5'),
      candidate(B, 'R4'),
    ]);
    expect(writes.map((w) => `${w.kind}:${w.taskId}`)).toEqual([
      `delete:${C}`,
      `upsert:${A}`,
      `upsert:${B}`,
    ]);
  });

  describe('properties', () => {
    const scenarios: Array<{ name: string; desired: AutoCandidate[] }> = [
      { name: 'R4 + R5 on different tasks', desired: [candidate(A, 'R4'), candidate(B, 'R5')] },
      { name: 'R3 + R4 + R6', desired: [candidate(A, 'R3'), candidate(B, 'R4'), candidate(C, 'R6')] },
      { name: 'R7 primary + R6', desired: [candidate(A, 'R7', 'primary'), candidate(B, 'R6')] },
    ];

    it.each(scenarios)('is idempotent: $name', ({ desired }) => {
      const once = reconcile([], desired);
      expect(planAutoLinks(once, new Set(), desired)).toEqual([]);
    });

    it('gives identical rows for every trigger order of {R3, R4, R5, R6}', () => {
      // Each trigger adds its evidence; R3 is an event that stays once seen.
      const triggers: AutoCandidate[] = [
        candidate(A, 'R3'),
        candidate(B, 'R4'),
        candidate(C, 'R5'),
        candidate('TASK_2026_104', 'R6'),
      ];
      const results = permutations(triggers).map((order) => {
        let rows: CurrentTaskLink[] = [];
        const seen: AutoCandidate[] = [];
        for (const trigger of order) {
          seen.push(trigger);
          // R3 rows persist on their own; the state-derived rules recompute.
          rows = reconcile(rows, seen.filter((c) => c.rule !== 'R3' || c === trigger));
        }
        return rows.map(({ createdAt: _createdAt, ...rest }) => rest);
      });
      for (const result of results) expect(result).toEqual(results[0]);
      expect(results[0].find((r) => r.role === 'primary')?.taskId).toBe(A);
    });

    it('R5 then R4 and R4 then R5 end the same', () => {
      const r5First = reconcile(reconcile([], [candidate(A, 'R5')]), [candidate(B, 'R4')]);
      const r4First = reconcile(reconcile([], [candidate(B, 'R4')]), [candidate(B, 'R4')]);
      expect(r5First).toEqual(r4First);
    });
  });
});

describe('parseOrchestrateTaskId', () => {
  it.each([
    ['/orchestrate TASK_2026_123', 'TASK_2026_123'],
    ['/orchestrate TASK_2026_1234', 'TASK_2026_1234'],
    ['/orchestrate   TASK_2026_123_ab12 do the work', 'TASK_2026_123_ab12'],
    ['\n\n  /orchestrate TASK_2026_123\nmore lines', 'TASK_2026_123'],
    ['/orchestrate TASK_2026_123\r\nnext', 'TASK_2026_123'],
  ])('%j -> %s', (prompt, id) => {
    expect(parseOrchestrateTaskId(prompt)).toBe(id);
  });

  it.each([
    'please /orchestrate TASK_2026_123',
    'hello\n/orchestrate TASK_2026_123',
    '/orchestrate TASK_2026_12',
    '/orchestrate TASK_2026_123abc',
    '/orchestrate TASK_2026_123_AB12',
    '/orchestrateTASK_2026_123',
    '/orchestrate',
    '',
    '   \n  ',
  ])('rejects %j', (prompt) => {
    expect(parseOrchestrateTaskId(prompt)).toBeNull();
  });

  it('only scans a bounded prefix', () => {
    expect(
      parseOrchestrateTaskId(`${' '.repeat(70 * 1024)}/orchestrate ${A}`),
    ).toBeNull();
  });
});

describe('parseOrchestrateExpansion', () => {
  it('reads the first argument of the orchestrate slash command', () => {
    expect(parseOrchestrateExpansion('orchestrate', 'slash_command', ' TASK_2026_1234 go')).toBe(
      'TASK_2026_1234',
    );
  });

  it.each([
    ['other', 'slash_command', A],
    ['orchestrate', 'mcp_prompt', A],
    ['orchestrate', 'slash_command', 'fix TASK_2026_101'],
    ['orchestrate', 'slash_command', ''],
  ])('rejects %s / %s / %j', (slug, type, args) => {
    expect(parseOrchestrateExpansion(slug, type, args)).toBeNull();
  });
});

describe('taskIdsInWorktreeName', () => {
  it('reads bounded ids from the folder name and the branch', () => {
    expect(
      taskIdsInWorktreeName(
        'D:\\repo\\.claude-worktrees\\TASK_2026_101-auth',
        'feat/TASK_2026_1234_ab12-x',
      ),
    ).toEqual(['TASK_2026_101', 'TASK_2026_1234_ab12']);
  });

  it('ignores ids glued to letters or digits and the parent folders', () => {
    expect(
      taskIdsInWorktreeName('/r/TASK_2026_101/xTASK_2026_102', 'TASK_2026_1031x'),
    ).toEqual([]);
  });

  it('deduplicates and handles missing values', () => {
    expect(taskIdsInWorktreeName('/wt/TASK_2026_101', 'TASK_2026_101')).toEqual([
      'TASK_2026_101',
    ]);
    expect(taskIdsInWorktreeName(null, null)).toEqual([]);
  });

  it('builds R4 evidence from path and branch', () => {
    expect(worktreeEvidence('/wt', null)).toBe('/wt\u0000');
  });
});
