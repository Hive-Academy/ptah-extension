/**
 * Transport bounds for `parse` replies: the worker caps node count and node
 * text, and the host's check of the largest reply it can accept stays well
 * inside one main-loop slice.
 */
import { performance } from 'node:perf_hooks';
import type { GenericAstNode } from '../ast.types';
import type { TreeSitterLogger } from '../tree-sitter-engine';
import { FakeWorkerFactory } from '../../testing/tree-sitter-worker-fakes';
import {
  MAX_TRANSPORT_NODE_TEXT_CHARS,
  TRANSPORT_AST_LIMITS,
  boundAstForTransport,
  isGenericAstNode,
} from './ast-transport-bounds';
import { TreeSitterWorkerClient } from './tree-sitter-worker.client';

function node(type: string, text: string, children: GenericAstNode[] = []): GenericAstNode {
  return {
    type,
    text,
    startPosition: { row: 0, column: 0 },
    endPosition: { row: 0, column: text.length },
    isNamed: true,
    fieldName: null,
    children,
  };
}

/** A tree of `count` nodes, breadth first, `fanOut` children each. */
function wideTree(count: number, textChars: number, fanOut = 4): GenericAstNode {
  const root = node('program', 'r'.repeat(textChars));
  const queue = [root];
  let made = 1;
  for (let i = 0; made < count; i++) {
    const parent = queue[i];
    for (let k = 0; k < fanOut && made < count; k++) {
      const child = node('identifier', `n${made}`.padEnd(textChars, 'x'));
      parent.children.push(child);
      queue.push(child);
      made++;
    }
  }
  return root;
}

function countNodes(root: GenericAstNode): number {
  let count = 0;
  const pending = [root];
  while (pending.length > 0) {
    const next = pending.pop();
    if (!next) break;
    count++;
    pending.push(...next.children);
  }
  return count;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

describe('boundAstForTransport', () => {
  it('returns an equal tree when it is within the bound', () => {
    const tree = node('program', 'let a = 1;', [node('lexical_declaration', 'let a = 1;')]);
    expect(boundAstForTransport(tree)).toEqual(tree);
  });

  it('cuts long text to one character more than ptah.ast.parse shows, and flags it', () => {
    const bounded = boundAstForTransport(node('program', 'y'.repeat(5_000)));
    expect(bounded.text).toHaveLength(MAX_TRANSPORT_NODE_TEXT_CHARS);
    expect(bounded.textTruncated).toBe(true);
  });

  it('keeps nodes breadth first up to the cap and flags the parents that lost children', () => {
    const tree = wideTree(50, 4, 3);
    const bounded = boundAstForTransport(tree, 10);
    expect(countNodes(bounded)).toBe(10);
    // Root and its three children are whole; the cut falls in level two.
    expect(bounded.children).toHaveLength(3);
    expect(bounded.childrenTruncated).toBeUndefined();
    const flagged = bounded.children.filter((child) => child.childrenTruncated);
    expect(flagged.length).toBeGreaterThan(0);
  });
});

describe('isGenericAstNode', () => {
  it('accepts a bounded tree and rejects one over the node or text cap', () => {
    const tree = wideTree(20, 10);
    expect(isGenericAstNode(tree, { maxNodes: 20, maxTextChars: 200 })).toBe(true);
    expect(isGenericAstNode(tree, { maxNodes: 19, maxTextChars: 200 })).toBe(false);
    expect(isGenericAstNode(tree, { maxNodes: 20, maxTextChars: 199 })).toBe(false);
  });

  it('rejects malformed nodes anywhere in the tree', () => {
    const limits = TRANSPORT_AST_LIMITS;
    expect(isGenericAstNode(null, limits)).toBe(false);
    expect(isGenericAstNode({ ...node('a', 'a'), fieldName: 3 }, limits)).toBe(false);
    const badChild: unknown = {
      ...node('a', 'a'),
      children: [{ ...node('b', 'b'), startPosition: { row: 'x' } }],
    };
    expect(isGenericAstNode(badChild, limits)).toBe(false);
    expect(isGenericAstNode({ ...node('a', 'a'), textTruncated: false }, limits)).toBe(false);
  });
});

describe('host-side handling of the largest accepted parse reply', () => {
  it('validates and settles a worst-case reply in under 50 ms', async () => {
    const logger: TreeSitterLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    // The worst case the worker can send: the node cap, every node at the
    // per-node text cap (what a 1 MiB source bounds to at most).
    const ast = wideTree(TRANSPORT_AST_LIMITS.maxNodes, MAX_TRANSPORT_NODE_TEXT_CHARS);
    const samples: number[] = [];
    for (let run = 0; run < 5; run++) {
      const factory = new FakeWorkerFactory();
      const client = new TreeSitterWorkerClient(factory, logger);
      const pending = client.parse('source', 'typescript');
      const worker = factory.latest();
      const reply = { kind: 'result', id: worker.lastRequest().id, ok: true, value: { op: 'parse', ast } };
      const started = performance.now();
      worker.emit(reply);
      samples.push(performance.now() - started);
      const result = await pending;
      expect(result.isOk()).toBe(true);
    }
    expect(median(samples)).toBeLessThan(50);
  });

  it('rejects a reply over the node cap instead of handing it to the caller', async () => {
    const logger: TreeSitterLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    const factory = new FakeWorkerFactory();
    const client = new TreeSitterWorkerClient(factory, logger);
    const pending = client.parse('source', 'typescript');
    const worker = factory.latest();
    const ast = wideTree(TRANSPORT_AST_LIMITS.maxNodes + 1, 4);
    worker.emit({ kind: 'result', id: worker.lastRequest().id, ok: true, value: { op: 'parse', ast } });
    const result = await pending;
    expect(result.error?.message).toContain('invalid reply to parse (typescript)');
  });
});
