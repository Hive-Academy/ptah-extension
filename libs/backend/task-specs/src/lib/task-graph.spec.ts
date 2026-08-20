/**
 * `buildTaskGraph` / `deriveCrossFileIssues` — unit specs (TASK_2026_181).
 *
 * The module under test lives in `libs/shared` because both the scanner and the
 * board must run the SAME derivation. The spec lives here, beside the scanner
 * that consumes it, because this is where a regression would first hurt.
 *
 * ## Every cycle fixture carries an explicit timeout
 *
 * A graph walk that does not terminate does not fail a test — it hangs the
 * suite, and a hung suite gets diagnosed as "CI is flaky". Each cycle case
 * therefore declares a 2 s Jest timeout AND asserts on wall-clock elapsed, so
 * non-termination reports itself as a failure with a number attached.
 */
import {
  buildTaskGraph,
  deriveCrossFileIssues,
  labelColorIndex,
  labelKey,
  type TaskSpecSummary,
  type TaskValidationIssue,
} from '@ptah-extension/shared';

/** Two seconds is a generous ceiling for graphs of a few hundred nodes. */
const CYCLE_TIMEOUT_MS = 2000;

function task(
  overrides: Partial<TaskSpecSummary> & { id: string },
): TaskSpecSummary {
  return {
    folderName: overrides.id,
    status: 'backlog',
    type: 'FEATURE',
    title: overrides.id,
    dependsOn: [],
    labels: [],
    duplicates: [],
    relatesTo: [],
    created: '2026-08-01T00:00:00.000Z',
    updated: '2026-08-01T00:00:00.000Z',
    frontmatterValid: true,
    validationIssues: [],
    ...overrides,
  };
}

/** `TASK_2026_007` from `7`. Keeps every fixture id inside the contract. */
function id(n: number): string {
  return `TASK_2026_${String(n).padStart(3, '0')}`;
}

function codesFor(
  issues: ReadonlyMap<string, readonly TaskValidationIssue[]>,
  taskId: string,
): string[] {
  return (issues.get(taskId) ?? []).map((issue) => issue.code);
}

/** Run `fn`, returning how long it took. Non-termination shows up as a number. */
function timed(fn: () => void): number {
  const started = Date.now();
  fn();
  return Date.now() - started;
}

// ---------------------------------------------------------------------------
// Parentage — cycles
// ---------------------------------------------------------------------------

describe('buildTaskGraph — parent cycles terminate', () => {
  it(
    'handles a self-reference (cycle of length 1)',
    () => {
      const tasks = [task({ id: id(1), parent: id(1) })];

      let graph!: ReturnType<typeof buildTaskGraph>;
      const elapsed = timed(() => {
        graph = buildTaskGraph(tasks);
      });

      expect(elapsed).toBeLessThan(CYCLE_TIMEOUT_MS);
      // The task STAYS on the board — the claim is dropped, not the task.
      expect(graph.byId.has(id(1))).toBe(true);
      expect(graph.effectiveParent.has(id(1))).toBe(false);
      expect(graph.children.size).toBe(0);
      expect(codesFor(deriveCrossFileIssues(tasks), id(1))).toEqual([
        'parent_cycle',
      ]);
    },
    CYCLE_TIMEOUT_MS,
  );

  it(
    'handles a 2-cycle',
    () => {
      const tasks = [
        task({ id: id(10), parent: id(11) }),
        task({ id: id(11), parent: id(10) }),
      ];

      let graph!: ReturnType<typeof buildTaskGraph>;
      const elapsed = timed(() => {
        graph = buildTaskGraph(tasks);
      });

      expect(elapsed).toBeLessThan(CYCLE_TIMEOUT_MS);
      expect(graph.effectiveParent.size).toBe(0);
      expect(graph.byId.size).toBe(2);
      const issues = deriveCrossFileIssues(tasks);
      expect(codesFor(issues, id(10))).toEqual(['parent_cycle']);
      expect(codesFor(issues, id(11))).toEqual(['parent_cycle']);
    },
    CYCLE_TIMEOUT_MS,
  );

  it(
    'handles a 3-cycle',
    () => {
      const tasks = [
        task({ id: id(20), parent: id(21) }),
        task({ id: id(21), parent: id(22) }),
        task({ id: id(22), parent: id(20) }),
      ];

      let graph!: ReturnType<typeof buildTaskGraph>;
      const elapsed = timed(() => {
        graph = buildTaskGraph(tasks);
      });

      expect(elapsed).toBeLessThan(CYCLE_TIMEOUT_MS);
      expect(graph.effectiveParent.size).toBe(0);
      const issues = deriveCrossFileIssues(tasks);
      for (const n of [20, 21, 22]) {
        expect(codesFor(issues, id(n))).toEqual(['parent_cycle']);
      }
    },
    CYCLE_TIMEOUT_MS,
  );

  it(
    'handles a 200-cycle',
    () => {
      const members = Array.from({ length: 200 }, (_unused, i) => id(200 + i));
      const tasks = members.map((memberId, i) =>
        task({ id: memberId, parent: members[(i + 1) % members.length] }),
      );

      let graph!: ReturnType<typeof buildTaskGraph>;
      const elapsed = timed(() => {
        graph = buildTaskGraph(tasks);
      });

      expect(elapsed).toBeLessThan(CYCLE_TIMEOUT_MS);
      expect(graph.byId.size).toBe(200);
      // EVERY member is on the cycle, so not one parent claim is honoured and
      // no member gains a child.
      expect(graph.effectiveParent.size).toBe(0);
      expect(graph.children.size).toBe(0);
      expect(graph.rollup.size).toBe(0);

      const issues = deriveCrossFileIssues(tasks);
      expect(issues.size).toBe(200);
      for (const memberId of members) {
        expect(codesFor(issues, memberId)).toEqual(['parent_cycle']);
      }
    },
    CYCLE_TIMEOUT_MS,
  );

  it(
    'handles a long chain that FEEDS a cycle without mis-marking the tail',
    () => {
      // 400 -> 401 -> 402 -> 403 -> 401. Only 401..403 are on the cycle; 400
      // merely points into it, so it is `parent_depth_exceeded`, not a member.
      const tasks = [
        task({ id: id(400), parent: id(401) }),
        task({ id: id(401), parent: id(402) }),
        task({ id: id(402), parent: id(403) }),
        task({ id: id(403), parent: id(401) }),
      ];

      let graph!: ReturnType<typeof buildTaskGraph>;
      const elapsed = timed(() => {
        graph = buildTaskGraph(tasks);
      });

      expect(elapsed).toBeLessThan(CYCLE_TIMEOUT_MS);
      expect(graph.effectiveParent.size).toBe(0);
      const issues = deriveCrossFileIssues(tasks);
      expect(codesFor(issues, id(400))).toEqual(['parent_depth_exceeded']);
      for (const n of [401, 402, 403]) {
        expect(codesFor(issues, id(n))).toEqual(['parent_cycle']);
      }
    },
    CYCLE_TIMEOUT_MS,
  );
});

// ---------------------------------------------------------------------------
// Parentage — precedence table
// ---------------------------------------------------------------------------

describe('buildTaskGraph — parent precedence', () => {
  it('honours a plain one-level claim and rolls the children up', () => {
    const tasks = [
      task({ id: id(30) }),
      task({ id: id(31), parent: id(30), status: 'done' }),
      task({ id: id(32), parent: id(30), status: 'cancelled' }),
      task({ id: id(33), parent: id(30), status: 'in_progress' }),
    ];

    const graph = buildTaskGraph(tasks);

    expect(graph.children.get(id(30))).toEqual([id(31), id(32), id(33)]);
    expect(graph.rollup.get(id(30))).toEqual({
      total: 3,
      done: 1,
      cancelled: 1,
      open: 1,
    });
    // A childless task has no rollup at all, so the card can render nothing
    // rather than a "0 / 0" that reads like a problem.
    expect(graph.rollup.has(id(31))).toBe(false);
    expect(deriveCrossFileIssues(tasks).size).toBe(0);
  });

  it('reports a dangling parent and keeps BOTH the claim and the task', () => {
    const tasks = [task({ id: id(40), parent: id(999) })];

    const graph = buildTaskGraph(tasks);

    expect(graph.byId.get(id(40))?.parent).toBe(id(999));
    expect(graph.effectiveParent.has(id(40))).toBe(false);
    expect(codesFor(deriveCrossFileIssues(tasks), id(40))).toEqual([
      'dangling_parent',
    ]);
  });

  it('raises parent_depth_exceeded on the CHILD making the depth-3 claim', () => {
    // 50 <- 51 <- 52. 51's claim is fine; 52's is two levels deep.
    const tasks = [
      task({ id: id(50) }),
      task({ id: id(51), parent: id(50) }),
      task({ id: id(52), parent: id(51) }),
    ];

    const graph = buildTaskGraph(tasks);
    const issues = deriveCrossFileIssues(tasks);

    expect(graph.effectiveParent.get(id(51))).toBe(id(50));
    expect(graph.effectiveParent.has(id(52))).toBe(false);
    expect(graph.children.get(id(50))).toEqual([id(51)]);
    expect(graph.children.has(id(51))).toBe(false);

    // The warning lands on 52 and on NOBODY else — 50 and 51 did nothing.
    expect(codesFor(issues, id(52))).toEqual(['parent_depth_exceeded']);
    expect(issues.has(id(50))).toBe(false);
    expect(issues.has(id(51))).toBe(false);
    // Both tasks stay on the board.
    expect(graph.byId.size).toBe(3);
  });

  it('treats a parent whose OWN parent is dangling as a one-level claim', () => {
    // 61's parent claim is not honoured, so 62's claim is not a depth-3 claim.
    const tasks = [
      task({ id: id(61), parent: id(998) }),
      task({ id: id(62), parent: id(61) }),
    ];

    const graph = buildTaskGraph(tasks);

    expect(graph.effectiveParent.get(id(62))).toBe(id(61));
    expect(codesFor(deriveCrossFileIssues(tasks), id(62))).toEqual([]);
  });

  it('is independent of the order tasks arrive in', () => {
    const forward = [
      task({ id: id(70) }),
      task({ id: id(71), parent: id(70) }),
      task({ id: id(72), parent: id(70) }),
    ];
    const reversed = [...forward].reverse();

    const a = buildTaskGraph(forward);
    const b = buildTaskGraph(reversed);

    expect([...a.children]).toEqual([...b.children]);
    expect([...a.effectiveParent]).toEqual([...b.effectiveParent]);
  });
});

// ---------------------------------------------------------------------------
// Inverse relations
// ---------------------------------------------------------------------------

describe('buildTaskGraph — inverse relations', () => {
  it('derives blocks / duplicatedBy over a dependency diamond', () => {
    // 80 <- {81, 82} <- 83: the classic diamond, which a traversal-based
    // implementation would visit twice. This one makes a single pass.
    const tasks = [
      task({ id: id(80) }),
      task({ id: id(81), dependsOn: [id(80)] }),
      task({ id: id(82), dependsOn: [id(80)] }),
      task({ id: id(83), dependsOn: [id(81), id(82)] }),
      task({ id: id(84), duplicates: [id(80)] }),
      task({ id: id(85), duplicates: [id(80)] }),
    ];

    const graph = buildTaskGraph(tasks);

    expect(graph.blocks.get(id(80))).toEqual([id(81), id(82)]);
    expect(graph.blocks.get(id(81))).toEqual([id(83)]);
    expect(graph.blocks.get(id(82))).toEqual([id(83)]);
    expect(graph.blocks.has(id(83))).toBe(false);
    expect(graph.duplicatedBy.get(id(80))).toEqual([id(84), id(85)]);
  });

  it('computes the symmetric closure of relates_to from ONE authored side', () => {
    const tasks = [
      task({ id: id(90), relatesTo: [id(91)] }),
      task({ id: id(91) }),
    ];

    const graph = buildTaskGraph(tasks);

    expect(graph.related.get(id(90))).toEqual([id(91)]);
    expect(graph.related.get(id(91))).toEqual([id(90)]);
  });

  it('reads a mutually-authored pair exactly like a one-sided one', () => {
    const oneSided = buildTaskGraph([
      task({ id: id(90), relatesTo: [id(91)] }),
      task({ id: id(91) }),
    ]);
    const mutual = buildTaskGraph([
      task({ id: id(90), relatesTo: [id(91)] }),
      task({ id: id(91), relatesTo: [id(90)] }),
    ]);

    expect([...mutual.related]).toEqual([...oneSided.related]);
  });

  it('orders related as authored-first, then derived id-sorted', () => {
    const tasks = [
      // 100 authors an out-of-order pair; both must keep AUTHORED order.
      task({ id: id(100), relatesTo: [id(103), id(102)] }),
      task({ id: id(102) }),
      task({ id: id(103) }),
      // Two later tasks name 100; those are derived and must be id-sorted and
      // appended AFTER the authored pair.
      task({ id: id(105), relatesTo: [id(100)] }),
      task({ id: id(104), relatesTo: [id(100)] }),
    ];

    const graph = buildTaskGraph(tasks);

    expect(graph.related.get(id(100))).toEqual([
      id(103),
      id(102),
      id(104),
      id(105),
    ]);
  });

  it('filters self-edges and entries that resolve to nothing', () => {
    const tasks = [
      task({
        id: id(110),
        dependsOn: [id(110), id(997)],
        duplicates: [id(110), id(997)],
        relatesTo: [id(110), id(997)],
      }),
    ];

    const graph = buildTaskGraph(tasks);

    expect(graph.blocks.size).toBe(0);
    expect(graph.duplicatedBy.size).toBe(0);
    expect(graph.related.size).toBe(0);
  });

  it('de-duplicates a relation declared twice in one array', () => {
    const tasks = [
      task({
        id: id(120),
        dependsOn: [id(121), id(121)],
        relatesTo: [id(121), id(121)],
      }),
      task({ id: id(121) }),
    ];

    const graph = buildTaskGraph(tasks);

    expect(graph.blocks.get(id(121))).toEqual([id(120)]);
    expect(graph.related.get(id(120))).toEqual([id(121)]);
    expect(graph.related.get(id(121))).toEqual([id(120)]);
  });

  it('counts only dependencies that are neither done nor cancelled as unmet', () => {
    const tasks = [
      task({ id: id(130), status: 'done' }),
      task({ id: id(131), status: 'cancelled' }),
      task({ id: id(132), status: 'in_progress' }),
      task({
        id: id(133),
        // The last entry names nothing: a typo is NOT an unmet dependency.
        dependsOn: [id(130), id(131), id(132), id(996)],
      }),
    ];

    const graph = buildTaskGraph(tasks);

    expect(graph.unmetDependencies.get(id(133))).toEqual([id(132)]);
    expect(graph.unmetDependencies.has(id(130))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Labels, colour, executors
// ---------------------------------------------------------------------------

describe('labelKey / labelColorIndex', () => {
  it('collapses case and surrounding whitespace', () => {
    expect(labelKey('Licensing')).toBe('licensing');
    expect(labelKey('licensing ')).toBe('licensing');
    expect(labelKey('  NEEDS:DESIGN  ')).toBe('needs:design');
  });

  it('gives two spellings of one label the SAME colour', () => {
    expect(labelColorIndex('Licensing', 8)).toBe(
      labelColorIndex('licensing ', 8),
    );
  });

  it('is deterministic and stays inside the palette', () => {
    for (const raw of [
      'licensing',
      'needs:design',
      '#urgent',
      '2fa',
      '日本語',
    ]) {
      const first = labelColorIndex(raw, 6);
      expect(labelColorIndex(raw, 6)).toBe(first);
      expect(first).toBeGreaterThanOrEqual(0);
      expect(first).toBeLessThan(6);
      expect(Number.isInteger(first)).toBe(true);
    }
  });

  it('returns 0 rather than NaN for a nonsensical palette size', () => {
    expect(labelColorIndex('licensing', 0)).toBe(0);
    expect(labelColorIndex('licensing', -3)).toBe(0);
    expect(labelColorIndex('licensing', 2.5)).toBe(0);
  });
});

describe('buildTaskGraph — label and executor unions', () => {
  it('unions labels first-seen-wins over id-sorted tasks', () => {
    const tasks = [
      task({ id: id(141), labels: ['licensing ', 'Board'] }),
      task({ id: id(140), labels: ['Licensing', 'needs:design'] }),
    ];

    const graph = buildTaskGraph(tasks);

    // 140 sorts first, so ITS spelling of the label is the canonical one even
    // though 141 appeared earlier in the array.
    expect(graph.knownLabels).toEqual(['Licensing', 'needs:design', 'Board']);
  });

  it('drops labels that are empty once trimmed', () => {
    const graph = buildTaskGraph([task({ id: id(150), labels: ['', '   '] })]);

    expect(graph.knownLabels).toEqual([]);
  });

  it('unions non-empty executors', () => {
    const graph = buildTaskGraph([
      task({ id: id(161), executor: 'backend-developer' }),
      task({ id: id(160), executor: 'frontend-developer' }),
      task({ id: id(162), executor: '   ' }),
      task({ id: id(163) }),
      task({ id: id(164), executor: 'backend-developer' }),
    ]);

    expect(graph.knownExecutors).toEqual([
      'frontend-developer',
      'backend-developer',
    ]);
  });
});

// ---------------------------------------------------------------------------
// deriveCrossFileIssues — relations, and the no-write property
// ---------------------------------------------------------------------------

describe('deriveCrossFileIssues', () => {
  it('reports a relation entry that resolves to nothing, or to itself', () => {
    const tasks = [
      task({
        id: id(170),
        duplicates: [id(995)],
        relatesTo: [id(170), id(171)],
      }),
      task({ id: id(171) }),
    ];

    const issues = deriveCrossFileIssues(tasks);

    expect(codesFor(issues, id(170))).toEqual([
      'dangling_relation',
      'dangling_relation',
    ]);
    const fields = (issues.get(id(170)) ?? []).map((issue) => issue.field);
    expect(fields).toEqual(['duplicates', 'relates_to']);
    // Each finding names the entry it is about. Two bad entries under ONE field
    // are otherwise indistinguishable, and a consumer folding these into the
    // parser's own findings has to be able to tell them apart.
    expect((issues.get(id(170)) ?? []).map((issue) => issue.ref)).toEqual([
      id(995),
      id(170),
    ]);
  });

  it('carries the offending entry on every parent issue', () => {
    const cycle = deriveCrossFileIssues([
      task({ id: id(172), parent: id(173) }),
      task({ id: id(173), parent: id(172) }),
    ]);
    expect(cycle.get(id(172))?.[0].ref).toBe(id(173));

    const dangling = deriveCrossFileIssues([
      task({ id: id(174), parent: id(993) }),
    ]);
    expect(dangling.get(id(174))?.[0].ref).toBe(id(993));

    const deep = deriveCrossFileIssues([
      task({ id: id(175) }),
      task({ id: id(176), parent: id(175) }),
      task({ id: id(177), parent: id(176) }),
    ]);
    expect(deep.get(id(177))?.[0].ref).toBe(id(176));
  });

  it('returns nothing at all for a clean set', () => {
    const issues = deriveCrossFileIssues([
      task({ id: id(180) }),
      task({ id: id(181), parent: id(180), dependsOn: [id(180)] }),
    ]);

    expect(issues.size).toBe(0);
  });

  it('names the offending value in every message', () => {
    const issues = deriveCrossFileIssues([
      task({ id: id(190), parent: id(994) }),
    ]);

    expect(issues.get(id(190))?.[0].message).toContain(id(994));
  });

  it('leaves the input untouched — the module cannot produce a write', () => {
    const tasks = [
      task({ id: id(195), parent: id(195), labels: ['a'], relatesTo: [] }),
      task({ id: id(196), dependsOn: [id(195)] }),
    ];
    const before = JSON.stringify(tasks);

    buildTaskGraph(tasks);
    deriveCrossFileIssues(tasks);

    expect(JSON.stringify(tasks)).toBe(before);
  });
});
