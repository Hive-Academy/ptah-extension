/**
 * Size bounds for ASTs that cross the tree-sitter worker boundary.
 *
 * A full `GenericAstNode` tree repeats each ancestor's whole source text,
 * so an unbounded `parse` reply for a 1 MiB file could take the host far
 * longer to deserialise and check than the parse it moved off the main
 * thread. The worker bounds every `parse` reply with
 * {@link boundAstForTransport}; the host re-checks the bound with the cheap
 * iterative {@link isGenericAstNode} guard instead of a recursive schema
 * (structured clone already guarantees plain data).
 *
 * Limits (fix-9a review, benchmarked in `ast-transport-bounds.spec.ts`):
 * 10,000 nodes of at most 101 text characters each deserialised in about
 * 22 ms and checked in about 2 ms on the development machine. The one Electron
 * `parse` caller, `ptah.ast.parse` (`ast-namespace.builder.ts`
 * `simplifyAstNode`), shows at most 100 characters of a node's text plus
 * `...` when it is longer, so 101 characters gives it exactly the same output.
 */
import type { GenericAstNode } from '../ast.types';

export interface AstSizeLimits {
  readonly maxNodes: number;
  /** Total `text` characters over every node. */
  readonly maxTextChars: number;
}

/** Characters of `text` kept per node: one more than the caller shows. */
export const MAX_TRANSPORT_NODE_TEXT_CHARS = 101;

export const TRANSPORT_AST_LIMITS: AstSizeLimits = {
  maxNodes: 10_000,
  maxTextChars: 10_000 * MAX_TRANSPORT_NODE_TEXT_CHARS,
};

/** No size bound: query captures, whose depth the engine already caps. */
export const UNBOUNDED_AST_LIMITS: AstSizeLimits = {
  maxNodes: Number.POSITIVE_INFINITY,
  maxTextChars: Number.POSITIVE_INFINITY,
};

function copyNode(source: GenericAstNode): GenericAstNode {
  const cut = source.text.length > MAX_TRANSPORT_NODE_TEXT_CHARS;
  return {
    type: source.type,
    text: cut ? source.text.slice(0, MAX_TRANSPORT_NODE_TEXT_CHARS) : source.text,
    startPosition: { ...source.startPosition },
    endPosition: { ...source.endPosition },
    isNamed: source.isNamed,
    fieldName: source.fieldName,
    children: [],
    ...(cut ? { textTruncated: true as const } : {}),
  };
}

/**
 * A copy of `root` with at most `TRANSPORT_AST_LIMITS.maxNodes` nodes, each
 * `text` cut to {@link MAX_TRANSPORT_NODE_TEXT_CHARS}. Nodes are kept
 * breadth first, so the upper levels a depth-limited reader shows stay
 * whole; a node that lost children is marked `childrenTruncated`.
 */
export function boundAstForTransport(
  root: GenericAstNode,
  maxNodes: number = TRANSPORT_AST_LIMITS.maxNodes,
): GenericAstNode {
  const boundedRoot = copyNode(root);
  const pending: [GenericAstNode, GenericAstNode][] = [[root, boundedRoot]];
  let kept = 1;
  for (let i = 0; i < pending.length; i++) {
    const [source, target] = pending[i];
    for (const child of source.children) {
      if (kept >= maxNodes) {
        target.childrenTruncated = true;
        break;
      }
      const copy = copyNode(child);
      target.children.push(copy);
      pending.push([child, copy]);
      kept++;
    }
  }
  return boundedRoot;
}

function isPosition(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'row' in value &&
    typeof value.row === 'number' &&
    'column' in value &&
    typeof value.column === 'number'
  );
}

function isOptionalTrue(value: object, key: string): boolean {
  return !(key in value) || Reflect.get(value, key) === true;
}

/**
 * Whether `value` is a `GenericAstNode` tree within `limits`. Iterative, so
 * a deep tree cannot overflow the stack, and it stops at the first node
 * over a limit.
 */
export function isGenericAstNode(
  value: unknown,
  limits: AstSizeLimits,
): value is GenericAstNode {
  const pending: unknown[] = [value];
  let nodes = 0;
  let textChars = 0;
  while (pending.length > 0) {
    const node = pending.pop();
    if (typeof node !== 'object' || node === null) return false;
    nodes++;
    if (nodes > limits.maxNodes) return false;
    if (
      !('type' in node && typeof node.type === 'string') ||
      !('text' in node && typeof node.text === 'string') ||
      !('isNamed' in node && typeof node.isNamed === 'boolean') ||
      !('fieldName' in node) ||
      !(node.fieldName === null || typeof node.fieldName === 'string') ||
      !('startPosition' in node && isPosition(node.startPosition)) ||
      !('endPosition' in node && isPosition(node.endPosition)) ||
      !('children' in node && Array.isArray(node.children)) ||
      !isOptionalTrue(node, 'textTruncated') ||
      !isOptionalTrue(node, 'childrenTruncated')
    ) {
      return false;
    }
    textChars += node.text.length;
    if (textChars > limits.maxTextChars) return false;
    for (const child of node.children) pending.push(child);
  }
  return true;
}
