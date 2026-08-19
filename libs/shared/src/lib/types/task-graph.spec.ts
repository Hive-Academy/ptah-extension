/**
 * Derived task graph — parentage, inverse relations, label union, colour hash.
 *
 * ## Why this module gets an exhaustive spec
 *
 * There is exactly ONE implementation because the backend scanner and the
 * `tasks-ui` board must agree, precisely, on what a task's children are. Every
 * failure mode here is a board that disagrees with the index for reasons
 * nobody can reproduce:
 *
 *  - a parent cycle that does not terminate hangs activation,
 *  - a rejected parent claim that still lands in `children` shows a task under
 *    a parent its author never gave it,
 *  - a dangling `depends_on` counted as UNMET states a blocking relationship
 *    the author never established,
 *  - a non-deterministic label order changes chip colours between the
 *    extension host and the webview, which reads as corrupt data.
 *
 * Every assertion below is one of those.
 */
import {
  buildTaskGraph,
  deriveCrossFileIssues,
  labelColorIndex,
  labelKey,
} from './task-graph';
import type { TaskSpecSummary, TaskStatus } from './task-spec.types';

/** A valid summary with every array present, so no consumer has to null-check. */
function task(
  id: string,
  overrides: Partial<TaskSpecSummary> = {},
): TaskSpecSummary {
  return {
    id,
    folderName: id,
    status: 'backlog' as TaskStatus,
    type: 'FEATURE',
    title: id,
    dependsOn: [],
    labels: [],
    duplicates: [],
    relatesTo: [],
    created: null,
    updated: null,
    frontmatterValid: true,
    validationIssues: [],
    ...overrides,
  };
}

/** Read a map bucket as a plain array so failures print readably. */
function bucket(
  map: ReadonlyMap<string, readonly string[]>,
  key: string,
): string[] {
  return [...(map.get(key) ?? [])];
}

describe('labelKey', () => {
  it('folds case and surrounding whitespace', () => {
    expect(labelKey('  Licensing ')).toBe('licensing');
    expect(labelKey('LICENSING')).toBe(labelKey('licensing'));
  });

  it('does not fold interior whitespace', () => {
    // `needs review` and `needsreview` are different labels; collapsing them
    // would silently merge two authors' vocabularies.
    expect(labelKey('needs review')).toBe('needs review');
  });
});

describe('labelColorIndex', () => {
  it('gives case- and whitespace-variants of one label the same slot', () => {
    // R9: `Licensing` and `licensing ` are ONE label, so ONE colour.
    expect(labelColorIndex('Licensing', 8)).toBe(
      labelColorIndex('licensing ', 8),
    );
  });

  it('is stable across calls and within the palette range', () => {
    for (const label of [
      'a',
      'licensing',
      'needs-design',
      'a much longer one',
    ]) {
      const first = labelColorIndex(label, 8);
      expect(labelColorIndex(label, 8)).toBe(first);
      expect(first).toBeGreaterThanOrEqual(0);
      expect(first).toBeLessThan(8);
    }
  });

  it('spreads labels across the palette rather than collapsing to one slot', () => {
    const slots = new Set(
      [
        'alpha',
        'beta',
        'gamma',
        'delta',
        'epsilon',
        'zeta',
        'eta',
        'theta',
      ].map((l) => labelColorIndex(l, 8)),
    );
    expect(slots.size).toBeGreaterThan(1);
  });

  it.each([
    ['zero', 0],
    ['negative', -4],
    ['non-integer', 3.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('returns 0 rather than NaN for a %s palette size', (_label, size) => {
    // A presentation-layer mistake must not put `undefined` in a class binding.
    expect(labelColorIndex('licensing', size)).toBe(0);
  });

  it('handles the empty label without throwing', () => {
    expect(labelColorIndex('', 8)).toBeGreaterThanOrEqual(0);
  });
});

describe('buildTaskGraph — byId and determinism', () => {
  it('keeps the first occurrence when ids repeat', () => {
    const graph = buildTaskGraph([
      task('A', { title: 'first' }),
      task('A', { title: 'second' }),
    ]);
    expect(graph.byId.size).toBe(1);
    expect(graph.byId.get('A')?.title).toBe('first');
  });

  it('produces the same result whatever order the filesystem hands folders back', () => {
    const tasks = [
      task('C', { labels: ['gamma'], executor: 'x' }),
      task('A', { labels: ['alpha'], relatesTo: ['B'] }),
      task('B', { labels: ['beta'], parent: 'A', executor: 'y' }),
    ];
    const forward = buildTaskGraph(tasks);
    const reversed = buildTaskGraph([...tasks].reverse());

    expect(reversed.knownLabels).toEqual(forward.knownLabels);
    expect(reversed.knownExecutors).toEqual(forward.knownExecutors);
    expect([...reversed.children]).toEqual([...forward.children]);
  });

  it('returns empty structures for an empty input', () => {
    const graph = buildTaskGraph([]);
    expect(graph.byId.size).toBe(0);
    expect(graph.children.size).toBe(0);
    expect(graph.knownLabels).toEqual([]);
    expect(graph.knownExecutors).toEqual([]);
  });
});

describe('buildTaskGraph — parentage precedence table', () => {
  it('honours a plain one-level claim and lists the child under the parent', () => {
    const graph = buildTaskGraph([task('P'), task('C', { parent: 'P' })]);

    expect(graph.effectiveParent.get('C')).toBe('P');
    expect(bucket(graph.children, 'P')).toEqual(['C']);
  });

  it('leaves a task with no parent key out of effectiveParent entirely', () => {
    const graph = buildTaskGraph([task('A'), task('B')]);
    expect(graph.effectiveParent.size).toBe(0);
    expect(graph.children.size).toBe(0);
  });

  it('rejects a self-parent without honouring it', () => {
    const graph = buildTaskGraph([task('A', { parent: 'A' })]);

    expect(graph.effectiveParent.has('A')).toBe(false);
    expect(graph.children.size).toBe(0);
    // The task still appears on the board (NFR-11).
    expect(graph.byId.has('A')).toBe(true);
  });

  it('rejects every member of a two-node cycle', () => {
    const graph = buildTaskGraph([
      task('A', { parent: 'B' }),
      task('B', { parent: 'A' }),
    ]);

    expect(graph.effectiveParent.size).toBe(0);
    expect(graph.byId.size).toBe(2);
  });

  it('rejects every member of a longer cycle and terminates', () => {
    const graph = buildTaskGraph([
      task('A', { parent: 'B' }),
      task('B', { parent: 'C' }),
      task('C', { parent: 'A' }),
    ]);
    expect(graph.effectiveParent.size).toBe(0);
  });

  it('terminates on a long chain that ends in a cycle, without a depth cap', () => {
    // 500 nodes: the recursive form of this walk blows the stack, and a deep
    // tree is user data, not a bug.
    const chain = Array.from({ length: 500 }, (_, i) =>
      task(`T${String(i).padStart(4, '0')}`, {
        parent: `T${String(i + 1).padStart(4, '0')}`,
      }),
    );
    // Close the loop: the last one points back at the first.
    chain[chain.length - 1] = task('T0499', { parent: 'T0000' });

    const graph = buildTaskGraph(chain);
    expect(graph.effectiveParent.size).toBe(0);
  });

  it('honours a long acyclic chain only at its first level', () => {
    // A→B→C: B's claim on C is honoured (C is standalone); A's claim on B is
    // two levels deep and is not.
    const graph = buildTaskGraph([
      task('A', { parent: 'B' }),
      task('B', { parent: 'C' }),
      task('C'),
    ]);

    expect(graph.effectiveParent.get('B')).toBe('C');
    expect(graph.effectiveParent.has('A')).toBe(false);
  });

  it('rejects a parent that does not resolve to a readable task', () => {
    const graph = buildTaskGraph([task('C', { parent: 'MISSING' })]);

    expect(graph.effectiveParent.has('C')).toBe(false);
    // The declared value survives on the summary — it is the only evidence of
    // what the author meant.
    expect(graph.byId.get('C')?.parent).toBe('MISSING');
  });

  it('treats a claim on a parent whose OWN parent is dangling as an ordinary claim', () => {
    // The grandparent must itself RESOLVE for this to be a two-level claim.
    const graph = buildTaskGraph([
      task('C', { parent: 'P' }),
      task('P', { parent: 'GONE' }),
    ]);

    expect(graph.effectiveParent.get('C')).toBe('P');
  });
});

describe('buildTaskGraph — children and rollup', () => {
  it('sorts children by id without a second sort pass', () => {
    const graph = buildTaskGraph([
      task('P'),
      task('C3', { parent: 'P' }),
      task('C1', { parent: 'P' }),
      task('C2', { parent: 'P' }),
    ]);
    expect(bucket(graph.children, 'P')).toEqual(['C1', 'C2', 'C3']);
  });

  it('derives open so the four numbers can never disagree', () => {
    const graph = buildTaskGraph([
      task('P'),
      task('C1', { parent: 'P', status: 'done' }),
      task('C2', { parent: 'P', status: 'cancelled' }),
      task('C3', { parent: 'P', status: 'in_progress' }),
      task('C4', { parent: 'P', status: 'backlog' }),
    ]);

    const rollup = graph.rollup.get('P');
    expect(rollup).toEqual({ total: 4, done: 1, cancelled: 1, open: 2 });
    expect(rollup?.open).toBe(
      (rollup?.total ?? 0) - (rollup?.done ?? 0) - (rollup?.cancelled ?? 0),
    );
  });

  it('gives children and rollup the same key set', () => {
    const graph = buildTaskGraph([
      task('P'),
      task('Q'),
      task('C', { parent: 'P' }),
    ]);
    expect([...graph.rollup.keys()]).toEqual([...graph.children.keys()]);
    // Only parents that HAVE children appear.
    expect(graph.children.has('Q')).toBe(false);
  });

  it('excludes children whose claim was rejected', () => {
    const graph = buildTaskGraph([
      task('P'),
      task('OK', { parent: 'P' }),
      task('CYCLE_A', { parent: 'CYCLE_B' }),
      task('CYCLE_B', { parent: 'CYCLE_A' }),
    ]);
    expect(bucket(graph.children, 'P')).toEqual(['OK']);
    expect(graph.children.size).toBe(1);
  });
});

describe('buildTaskGraph — blocks and unmetDependencies', () => {
  it('inverts dependsOn without any authored inverse key', () => {
    const graph = buildTaskGraph([
      task('A', { dependsOn: ['B'] }),
      task('C', { dependsOn: ['B'] }),
      task('B'),
    ]);
    expect(bucket(graph.blocks, 'B')).toEqual(['A', 'C']);
  });

  it('does not count a dependency on a done or cancelled task as unmet', () => {
    const graph = buildTaskGraph([
      task('A', { dependsOn: ['DONE', 'CANCELLED', 'OPEN'] }),
      task('DONE', { status: 'done' }),
      task('CANCELLED', { status: 'cancelled' }),
      task('OPEN', { status: 'in_progress' }),
    ]);

    expect(bucket(graph.unmetDependencies, 'A')).toEqual(['OPEN']);
  });

  it('leaves a task with no unmet dependency out of the map entirely', () => {
    const graph = buildTaskGraph([
      task('A', { dependsOn: ['DONE'] }),
      task('DONE', { status: 'done' }),
    ]);
    expect(graph.unmetDependencies.has('A')).toBe(false);
  });

  it('does NOT treat a dangling dependency as unmet', () => {
    // A typo is already reported as `dangling_depends_on`. Calling it an unmet
    // dependency would state a blocking relationship the author never made.
    const graph = buildTaskGraph([task('A', { dependsOn: ['GHOST'] })]);

    expect(graph.unmetDependencies.has('A')).toBe(false);
    expect(graph.blocks.has('GHOST')).toBe(false);
  });

  it('ignores a self-dependency', () => {
    const graph = buildTaskGraph([task('A', { dependsOn: ['A'] })]);
    expect(graph.blocks.size).toBe(0);
    expect(graph.unmetDependencies.size).toBe(0);
  });

  it('de-duplicates a dependency declared twice in one array', () => {
    const graph = buildTaskGraph([
      task('A', { dependsOn: ['B', 'B'] }),
      task('B'),
    ]);
    expect(bucket(graph.blocks, 'B')).toEqual(['A']);
    expect(bucket(graph.unmetDependencies, 'A')).toEqual(['B']);
  });
});

describe('buildTaskGraph — duplicatedBy', () => {
  it('inverts duplicates', () => {
    const graph = buildTaskGraph([
      task('A', { duplicates: ['ORIGINAL'] }),
      task('B', { duplicates: ['ORIGINAL'] }),
      task('ORIGINAL'),
    ]);
    expect(bucket(graph.duplicatedBy, 'ORIGINAL')).toEqual(['A', 'B']);
  });

  it('ignores self-references and entries naming nothing', () => {
    const graph = buildTaskGraph([task('A', { duplicates: ['A', 'GHOST'] })]);
    expect(graph.duplicatedBy.size).toBe(0);
  });
});

describe('buildTaskGraph — related is a symmetric closure over one authored side', () => {
  it('puts the authored entries first and the derived ones after', () => {
    // FR-B4.9: the board removes an authored entry here, but must NAVIGATE to
    // the other task to remove a derived one, so the split must be visible.
    const graph = buildTaskGraph([
      task('B'),
      task('M', { relatesTo: ['B'] }),
      task('A', { relatesTo: ['M'] }),
      task('Z', { relatesTo: ['M'] }),
    ]);

    // M authored `B`; A and Z named M, so they are derived and id-sorted.
    expect(bucket(graph.related, 'M')).toEqual(['B', 'A', 'Z']);
  });

  it('preserves authored order within the authored half', () => {
    const graph = buildTaskGraph([
      task('A', { relatesTo: ['Z', 'B'] }),
      task('B'),
      task('Z'),
    ]);
    expect(bucket(graph.related, 'A')).toEqual(['Z', 'B']);
  });

  it('reads a mutually-authored pair the same as a singly-authored one', () => {
    const mutual = buildTaskGraph([
      task('A', { relatesTo: ['B'] }),
      task('B', { relatesTo: ['A'] }),
    ]);
    const single = buildTaskGraph([task('A', { relatesTo: ['B'] }), task('B')]);

    expect(bucket(mutual.related, 'A')).toEqual(bucket(single.related, 'A'));
    expect(bucket(mutual.related, 'B')).toEqual(bucket(single.related, 'B'));
  });

  it('ignores self-references and entries naming nothing', () => {
    const graph = buildTaskGraph([task('A', { relatesTo: ['A', 'GHOST'] })]);
    expect(graph.related.size).toBe(0);
  });
});

describe('buildTaskGraph — label and executor unions', () => {
  it('de-duplicates on labelKey with FIRST-SEEN text winning', () => {
    // Tasks are visited id-sorted, so `A`'s spelling is the one rendered.
    const graph = buildTaskGraph([
      task('B', { labels: ['licensing '] }),
      task('A', { labels: ['Licensing'] }),
    ]);
    expect(graph.knownLabels).toEqual(['Licensing']);
  });

  it('keeps authored order within one task', () => {
    const graph = buildTaskGraph([task('A', { labels: ['zeta', 'alpha'] })]);
    expect(graph.knownLabels).toEqual(['zeta', 'alpha']);
  });

  it('drops labels that are empty or whitespace-only', () => {
    const graph = buildTaskGraph([task('A', { labels: ['', '   ', 'real'] })]);
    expect(graph.knownLabels).toEqual(['real']);
  });

  it('collects distinct trimmed executors and drops blank ones', () => {
    const graph = buildTaskGraph([
      task('A', { executor: 'senior-developer' }),
      task('B', { executor: '  senior-developer  ' }),
      task('C', { executor: '   ' }),
      task('D', { executor: 'team-leader' }),
      task('E'),
    ]);
    expect(graph.knownExecutors).toEqual(['senior-developer', 'team-leader']);
  });
});

describe('deriveCrossFileIssues', () => {
  it('reports nothing for a clean set', () => {
    const issues = deriveCrossFileIssues([
      task('P'),
      task('C', { parent: 'P', relatesTo: ['P'], duplicates: ['P'] }),
    ]);
    expect(issues.size).toBe(0);
  });

  it('names the self-parent case distinctly from a multi-node cycle', () => {
    const self = deriveCrossFileIssues([task('A', { parent: 'A' })]);
    expect(self.get('A')).toEqual([
      {
        field: 'parent',
        code: 'parent_cycle',
        message: "parent 'A' is this task itself; the claim is not honoured.",
        ref: 'A',
      },
    ]);

    const loop = deriveCrossFileIssues([
      task('A', { parent: 'B' }),
      task('B', { parent: 'A' }),
    ]);
    expect(loop.get('A')?.[0].code).toBe('parent_cycle');
    expect(loop.get('A')?.[0].message).toContain('closes a loop back onto');
  });

  it('reports a dangling parent with the offending entry in ref', () => {
    const issues = deriveCrossFileIssues([task('C', { parent: 'MISSING' })]);
    expect(issues.get('C')).toEqual([
      {
        field: 'parent',
        code: 'dangling_parent',
        message:
          "parent 'MISSING' does not resolve to a readable task; the claim is not honoured.",
        ref: 'MISSING',
      },
    ]);
  });

  it('lands parent_depth_exceeded on the CHILD, never on the ancestor', () => {
    // A warning on a task the author did not edit is one they cannot act on.
    const issues = deriveCrossFileIssues([
      task('A', { parent: 'B' }),
      task('B', { parent: 'C' }),
      task('C'),
    ]);

    expect(issues.get('A')?.[0].code).toBe('parent_depth_exceeded');
    expect(issues.get('A')?.[0].ref).toBe('B');
    expect(issues.has('B')).toBe(false);
    expect(issues.has('C')).toBe(false);
  });

  it('reports a self-reference under the YAML key the parser uses', () => {
    const issues = deriveCrossFileIssues([
      task('A', { duplicates: ['A'], relatesTo: ['A'] }),
    ]);

    // `field` must match the parser so the scanner's (code, field)
    // de-duplication works.
    expect(issues.get('A')).toEqual([
      {
        field: 'duplicates',
        code: 'dangling_relation',
        message: "duplicates entry 'A' refers to this task itself.",
        ref: 'A',
      },
      {
        field: 'relates_to',
        code: 'dangling_relation',
        message: "relates_to entry 'A' refers to this task itself.",
        ref: 'A',
      },
    ]);
  });

  it('reports an entry naming a folder whose carrier failed to parse', () => {
    const issues = deriveCrossFileIssues([
      task('A', { relatesTo: ['UNREADABLE'] }),
    ]);

    // Deliberately narrower than the parser's wording: this pass knows whether
    // the folder produced a readable TASK, which the parser cannot see.
    expect(issues.get('A')?.[0].message).toBe(
      "relates_to entry 'UNREADABLE' does not resolve to a task with a readable carrier.",
    );
  });

  it('accumulates several issues for one task, parent issue first', () => {
    const issues = deriveCrossFileIssues([
      task('A', {
        parent: 'GONE',
        duplicates: ['ALSO_GONE'],
        relatesTo: ['A'],
      }),
    ]);

    expect(issues.get('A')?.map((i) => i.code)).toEqual([
      'dangling_parent',
      'dangling_relation',
      'dangling_relation',
    ]);
    expect(issues.get('A')?.map((i) => i.field)).toEqual([
      'parent',
      'duplicates',
      'relates_to',
    ]);
  });

  it('reports several bad entries in one array separately, identified by ref', () => {
    // One field can carry several bad entries; (code, field) alone cannot tell
    // them apart, which is why `ref` exists.
    const issues = deriveCrossFileIssues([
      task('A', { duplicates: ['GONE_1', 'GONE_2'] }),
    ]);
    expect(issues.get('A')?.map((i) => i.ref)).toEqual(['GONE_1', 'GONE_2']);
  });

  it('keeps the first occurrence when ids repeat', () => {
    const issues = deriveCrossFileIssues([
      task('A', { parent: 'MISSING' }),
      task('A'),
    ]);
    expect(issues.get('A')?.[0].code).toBe('dangling_parent');
  });

  it('reports nothing for an empty set', () => {
    expect(deriveCrossFileIssues([]).size).toBe(0);
  });
});
