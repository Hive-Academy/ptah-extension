/**
 * `capFinalizedTree` specs.
 *
 * The rule under test is the one `agent-output-retention.ts` states and this
 * module inherits: a cap the user cannot see is indistinguishable from data
 * corruption. So every case here asks two questions — was the payload bounded,
 * and can the user tell. A case that bounds without marking is a failure even
 * when the bytes went down.
 */

import type { ExecutionNode } from '@ptah-extension/shared';
import {
  capFinalizedTree,
  MAX_RETAINED_MESSAGE_CHARS,
  MAX_RETAINED_TOOL_INPUT_CHARS,
  MAX_RETAINED_TOOL_OUTPUT_CHARS,
} from './execution-tree-retention';

function node(partial: Partial<ExecutionNode> = {}): ExecutionNode {
  return {
    id: 'n1',
    type: 'tool',
    status: 'complete',
    content: null,
    children: [],
    isCollapsed: false,
    ...partial,
  } as ExecutionNode;
}

/** Distinguishable filler, so a head/tail assertion cannot pass by accident. */
function filler(length: number, char: string): string {
  return char.repeat(length);
}

describe('capFinalizedTree — under budget', () => {
  it('returns the exact same object reference when nothing is over budget', () => {
    const tree = node({
      id: 'root',
      type: 'message',
      children: [
        node({ id: 'a', toolOutput: 'small output' }),
        node({ id: 'b', toolInput: { file_path: '/tmp/x.ts' } }),
      ],
    });

    expect(capFinalizedTree(tree)).toBe(tree);
  });

  it('writes no retention field on an under-budget node', () => {
    const tree = node({ id: 'root', toolOutput: 'tiny' });
    expect(capFinalizedTree(tree).retention).toBeUndefined();
  });

  it('leaves a non-string payload as the object it is, so specialized renderers still match', () => {
    const todo = { todos: [{ content: 'do a thing', status: 'pending' }] };
    const tree = node({ id: 'root', toolName: 'TodoWrite', toolInput: todo });

    const capped = capFinalizedTree(tree);
    expect(capped).toBe(tree);
    expect(capped.toolInput).toBe(todo);
  });
});

describe('capFinalizedTree — toolOutput over budget', () => {
  const head = filler(1000, 'H');
  const middle = filler(MAX_RETAINED_TOOL_OUTPUT_CHARS * 2, 'M');
  const tail = filler(1000, 'T');
  const output = head + middle + tail;

  it('keeps a head AND a tail, not just a head', () => {
    const capped = capFinalizedTree(node({ toolOutput: output }));
    const kept = capped.toolOutput as string;

    expect(typeof kept).toBe('string');
    expect(kept.startsWith('HHHH')).toBe(true);
    expect(kept.endsWith('TTTT')).toBe(true);
  });

  it('puts the marker between the head and the tail, in band', () => {
    const kept = capFinalizedTree(node({ toolOutput: output }))
      .toolOutput as string;

    expect(kept).toContain('characters dropped to bound this transcript');
    expect(kept).toContain('reopen the session to reload it');
    // The marker sits between the surviving slices, not at either end.
    const markerAt = kept.indexOf('characters dropped');
    expect(markerAt).toBeGreaterThan(0);
    expect(markerAt).toBeLessThan(kept.length - 1000);
  });

  it('does not promise a re-fetch that does not exist', () => {
    const kept = capFinalizedTree(node({ toolOutput: output }))
      .toolOutput as string;

    expect(kept).not.toContain('click to expand');
    expect(kept).not.toMatch(/re-?fetch/i);
  });

  it('reports an exact dropped count in the typed field, matching the in-band line', () => {
    const capped = capFinalizedTree(node({ toolOutput: output }));
    const kept = capped.toolOutput as string;

    const retention = capped.retention;
    expect(retention).toBeDefined();
    expect(retention?.capped).toEqual(['toolOutput']);
    expect(retention?.foldFailed).toBe(false);

    const inBand = /… (\d+) characters dropped/.exec(kept);
    expect(inBand).not.toBeNull();
    expect(Number(inBand?.[1])).toBe(retention?.droppedChars);

    // Exact, not approximate: the head and tail slices together spend the whole
    // field budget, so everything else is what went.
    expect(retention?.droppedChars).toBe(
      output.length - MAX_RETAINED_TOOL_OUTPUT_CHARS,
    );
  });

  it('brings the retained payload back within a stated ceiling', () => {
    const capped = capFinalizedTree(node({ toolOutput: output }));
    const kept = capped.toolOutput as string;

    // Budget plus the one marker line the precedent requires to survive.
    expect(kept.length).toBeLessThan(MAX_RETAINED_TOOL_OUTPUT_CHARS + 512);
    expect(output.length).toBeGreaterThan(MAX_RETAINED_TOOL_OUTPUT_CHARS * 2);
  });

  it('falls back to the folded string form for an over-budget non-string payload', () => {
    const bulky = { lines: [filler(MAX_RETAINED_TOOL_OUTPUT_CHARS * 2, 'L')] };
    const capped = capFinalizedTree(node({ toolOutput: bulky }));

    expect(typeof capped.toolOutput).toBe('string');
    expect(capped.toolOutput as string).toContain(
      'characters dropped to bound this transcript',
    );
    expect(capped.retention?.capped).toEqual(['toolOutput']);
  });

  it('does not mutate the input node', () => {
    const original = node({ toolOutput: output });
    const before = original.toolOutput;

    capFinalizedTree(original);

    expect(original.toolOutput).toBe(before);
    expect(original.retention).toBeUndefined();
  });
});

describe('capFinalizedTree — toolInput over budget', () => {
  it('keeps the small identifying params and folds the big one', () => {
    const content = filler(MAX_RETAINED_TOOL_INPUT_CHARS * 2, 'C');
    const capped = capFinalizedTree(
      node({
        toolName: 'Write',
        toolInput: { file_path: '/repo/src/big.ts', content },
      }),
    );

    const input = capped.toolInput as Record<string, unknown>;
    expect(input['file_path']).toBe('/repo/src/big.ts');
    expect(input['content']).not.toBe(content);
    expect(input['content'] as string).toContain(
      'characters dropped to bound this transcript',
    );
    expect(capped.retention?.capped).toEqual(['toolInput']);
    expect(capped.retention?.droppedChars).toBeGreaterThan(0);
  });

  it('preserves the original key order of the record', () => {
    const capped = capFinalizedTree(
      node({
        toolInput: {
          first: 'a',
          huge: filler(MAX_RETAINED_TOOL_INPUT_CHARS * 2, 'X'),
          last: 'z',
        },
      }),
    );

    expect(Object.keys(capped.toolInput as Record<string, unknown>)).toEqual([
      'first',
      'huge',
      'last',
    ]);
  });
});

describe('capFinalizedTree — the fold-failure branch', () => {
  it('emits the marker WITH a reason when the payload cannot be serialized', () => {
    const cyclic: Record<string, unknown> = { name: 'loop' };
    cyclic['self'] = cyclic;

    const capped = capFinalizedTree(node({ toolOutput: cyclic }));

    expect(capped).not.toBe(cyclic);
    expect(capped.retention?.foldFailed).toBe(true);
    expect(capped.retention?.reason).toBeTruthy();
    expect(capped.retention?.capped).toEqual(['toolOutput']);
    expect(capped.toolOutput as string).toContain('could not be preserved');
    expect(capped.toolOutput as string).toContain('reopen the session');
  });

  it('keeps nothing of the unserializable payload', () => {
    const throwing = {
      get boom(): string {
        throw new Error('getter exploded');
      },
    };

    const capped = capFinalizedTree(node({ toolOutput: throwing }));

    expect(typeof capped.toolOutput).toBe('string');
    expect(capped.retention?.foldFailed).toBe(true);
    expect(capped.retention?.reason).toContain('getter exploded');
  });

  it('marks a BigInt payload rather than throwing out of the turn-commit path', () => {
    const capped = capFinalizedTree(
      node({ toolOutput: { size: BigInt(9007199254740993n) } }),
    );

    expect(capped.retention?.foldFailed).toBe(true);
    expect(capped.toolOutput as string).toContain('could not be preserved');
  });

  it('marks an unserializable input entry and keeps the serializable siblings', () => {
    const capped = capFinalizedTree(
      node({
        toolInput: {
          file_path: '/repo/a.ts',
          callback: (): void => undefined,
        },
      }),
    );

    const input = capped.toolInput as Record<string, unknown>;
    expect(input['file_path']).toBe('/repo/a.ts');
    expect(input['callback'] as string).toContain('could not be preserved');
    expect(capped.retention?.foldFailed).toBe(true);
  });
});

describe('capFinalizedTree — re-application', () => {
  it('is stable: capping an already-capped tree returns it by reference', () => {
    const tree = node({
      toolOutput: filler(MAX_RETAINED_TOOL_OUTPUT_CHARS * 2, 'O'),
    });

    const once = capFinalizedTree(tree);
    const twice = capFinalizedTree(once);

    expect(once).not.toBe(tree);
    expect(twice).toBe(once);
  });

  it('does not truncate an already-truncated payload a second time', () => {
    const once = capFinalizedTree(
      node({ toolOutput: filler(MAX_RETAINED_TOOL_OUTPUT_CHARS * 2, 'O') }),
    );
    const twice = capFinalizedTree(once);

    expect(twice.toolOutput).toBe(once.toolOutput);
    expect(twice.retention?.droppedChars).toBe(once.retention?.droppedChars);
  });

  it('accumulates counts across passes by reading the number, not re-parsing the prose', () => {
    // A node restored from a previous session's cap, now over budget on its
    // OTHER payload. The prior count must roll forward.
    const restored = node({
      toolOutput: 'already bounded on a previous pass',
      toolInput: { content: filler(MAX_RETAINED_TOOL_INPUT_CHARS * 2, 'I') },
      retention: {
        droppedChars: 4321,
        capped: ['toolOutput'],
        foldFailed: false,
      },
    });

    const capped = capFinalizedTree(restored);

    expect(capped.retention?.capped).toEqual(['toolInput', 'toolOutput']);
    expect(capped.retention?.droppedChars).toBeGreaterThan(4321);
    // The prose of the earlier pass is never a source of truth: the untouched
    // toolOutput still reads as plain text and contributes no count.
    expect(capped.toolOutput).toBe('already bounded on a previous pass');
  });

  it('carries a prior foldFailed forward instead of quietly clearing it', () => {
    const restored = node({
      toolOutput: 'x',
      toolInput: { content: filler(MAX_RETAINED_TOOL_INPUT_CHARS * 2, 'I') },
      retention: {
        droppedChars: 10,
        capped: ['toolOutput'],
        foldFailed: true,
        reason: 'Converting circular structure to JSON',
      },
    });

    const capped = capFinalizedTree(restored);

    expect(capped.retention?.foldFailed).toBe(true);
    expect(capped.retention?.reason).toBe(
      'Converting circular structure to JSON',
    );
  });
});

describe('capFinalizedTree — the whole-message budget', () => {
  /** A turn of many individually-small tool calls, none over its own budget. */
  function manySmallTools(count: number, charsEach: number): ExecutionNode {
    return node({
      id: 'root',
      type: 'message',
      children: Array.from({ length: count }, (_, i) =>
        node({ id: `t${i}`, toolOutput: filler(charsEach, String(i % 10)) }),
      ),
    });
  }

  it('bounds a turn whose nodes are each under budget but together are not', () => {
    const tree = manySmallTools(60, 8 * 1024); // 480 KB across 60 nodes
    const capped = capFinalizedTree(tree);

    const sizeOf = (n: ExecutionNode): number =>
      sum(n.children) + ((n.toolOutput as string)?.length ?? 0);
    const sum = (nodes: readonly ExecutionNode[]): number =>
      nodes.reduce((acc, n) => acc + sizeOf(n), 0);

    const before = sizeOf(tree);
    const after = sizeOf(capped);

    expect(before).toBe(60 * 8 * 1024);
    // The payload itself is inside the budget. The result overshoots it only by
    // the markers — one per starved node — and that overshoot is the precedent's
    // deliberate trade: the notice always survives, because a bounded payload
    // with no notice is the defect this module exists to prevent.
    const markerOverhead = after - MAX_RETAINED_MESSAGE_CHARS;
    expect(markerOverhead).toBeGreaterThan(0);
    expect(markerOverhead).toBeLessThan(60 * 512);
    expect(after).toBeLessThan(before / 1.5);
  });

  it('spends the budget newest-node-first: the last tools survive intact', () => {
    const tree = manySmallTools(60, 8 * 1024);
    const capped = capFinalizedTree(tree);

    const last = capped.children[capped.children.length - 1];
    expect(last.retention).toBeUndefined();
    expect(last.toolOutput).toBe(
      tree.children[tree.children.length - 1].toolOutput as string,
    );
  });

  it('marks every node the whole-message budget dropped', () => {
    const tree = manySmallTools(60, 8 * 1024);
    const capped = capFinalizedTree(tree);

    const dropped = capped.children.filter((c) => c.retention !== undefined);
    expect(dropped.length).toBeGreaterThan(0);
    for (const child of dropped) {
      expect(child.retention?.capped).toEqual(['toolOutput']);
      expect(child.toolOutput as string).toContain('reopen the session');
    }
    // The oldest node is the one the newest-first spend starves.
    expect(capped.children[0].retention).toBeDefined();
  });

  it('preserves object identity for subtrees it did not touch', () => {
    const untouched = node({ id: 'leaf', toolOutput: 'small' });
    const tree = node({
      id: 'root',
      type: 'message',
      children: [
        untouched,
        node({
          id: 'big',
          toolOutput: filler(MAX_RETAINED_TOOL_OUTPUT_CHARS * 2, 'B'),
        }),
      ],
    });

    const capped = capFinalizedTree(tree);

    expect(capped).not.toBe(tree);
    expect(capped.children[0]).toBe(untouched);
    expect(capped.children[1]).not.toBe(tree.children[1]);
  });
});

describe('capFinalizedTree — what it must never touch', () => {
  it('leaves `content` on a text node alone at any size', () => {
    const prose = filler(MAX_RETAINED_MESSAGE_CHARS * 2, 'P');
    const tree = node({ id: 'root', type: 'text', content: prose });

    const capped = capFinalizedTree(tree);

    expect(capped).toBe(tree);
    expect(capped.content).toBe(prose);
    expect(capped.content?.length).toBe(prose.length);
  });

  it('leaves `content` alone even on a node whose tool payload IS capped', () => {
    const prose = filler(200 * 1024, 'P');
    const tree = node({
      id: 'root',
      type: 'message',
      content: prose,
      toolOutput: filler(MAX_RETAINED_TOOL_OUTPUT_CHARS * 2, 'O'),
    });

    const capped = capFinalizedTree(tree);

    expect(capped.content).toBe(prose);
    expect(capped.retention?.capped).toEqual(['toolOutput']);
  });

  it('preserves every other field of a rewritten node — no factory defaults applied', () => {
    const tree = node({
      id: 'keep-me',
      type: 'tool',
      status: 'interrupted',
      toolName: 'Bash',
      toolCallId: 'toolu_1',
      isCollapsed: true,
      isBackground: true,
      duration: 1234,
      toolOutput: filler(MAX_RETAINED_TOOL_OUTPUT_CHARS * 2, 'O'),
    });

    const capped = capFinalizedTree(tree);

    expect(capped.id).toBe('keep-me');
    expect(capped.status).toBe('interrupted');
    expect(capped.toolName).toBe('Bash');
    expect(capped.toolCallId).toBe('toolu_1');
    expect(capped.isCollapsed).toBe(true);
    expect(capped.isBackground).toBe(true);
    expect(capped.duration).toBe(1234);
  });

  it('is deterministic — the same input yields a byte-identical result', () => {
    const build = (): ExecutionNode =>
      node({
        id: 'root',
        type: 'message',
        children: [
          node({
            id: 'a',
            toolInput: {
              b: filler(20 * 1024, 'B'),
              a: 'small',
              c: filler(20 * 1024, 'C'),
            },
          }),
          node({
            id: 'b',
            toolOutput: filler(MAX_RETAINED_TOOL_OUTPUT_CHARS * 2, 'O'),
          }),
        ],
      });

    expect(JSON.stringify(capFinalizedTree(build()))).toBe(
      JSON.stringify(capFinalizedTree(build())),
    );
  });
});
