/**
 * The one reusable dashboard-spec boundary validator.
 *
 * TASK_2026_493_9f58, deliverable 2. `context.md` names TWO measurement points:
 * the MCP tool boundary before the broadcast, and the RPC boundary in the
 * webview. This task owns the first (see
 * `libs/backend/vscode-lm-tools/.../dashboard-namespace.builder.ts`) and
 * defines the validator so TASK_2026_494 can own the second by calling the
 * SAME function with the same limits. Neither boundary is allowed to hand-roll
 * a second opinion about what a valid spec is.
 *
 * WHY THE BYTE COUNTER IS AN ARGUMENT, not an import. `context.md` requires the
 * UTF-8 byte check to come from `libs/backend/platform-core/src/utils/json-budget.ts`
 * (`jsonUtf8Bytes`). This module cannot import it, for two independent reasons:
 *
 * 1. Cycle. `platform-core` already imports a type from `@ptah-extension/shared`
 *    (`interfaces/boot-readiness.interface.ts`) and documents that it must stay
 *    free of a runtime dependency on it (`settings-auth-key.ts:9-10`). A
 *    `shared → platform-core` edge would close a project cycle, which
 *    `@nx/enforce-module-boundaries` rejects.
 * 2. Runtime. `jsonUtf8Bytes` uses `Buffer`, which the webview — the second
 *    measurement point — does not have.
 *
 * So the backend passes `jsonUtf8Bytes` itself, and the webview passes a
 * `TextEncoder`-based equivalent. The BUDGET lives in one place
 * (`DASHBOARD_LIMITS.maxSpecBytes`); only the byte-counting primitive is
 * host-supplied.
 */

import type { z } from 'zod';
import { DASHBOARD_LIMITS } from './dashboard-catalog';
import { DashboardSpecEnvelopeSchema } from './dashboard-spec.schemas';
import type { DashboardSpecEnvelope } from './dashboard-spec.types';

/**
 * Counts the UTF-8 bytes of `value`'s JSON encoding.
 *
 * Satisfied by `jsonUtf8Bytes` from
 * `@ptah-extension/platform-core` on the backend, and by
 * `(v) => new TextEncoder().encode(JSON.stringify(v)).length` in a browser.
 */
export type DashboardJsonByteCounter = (value: unknown) => number;

/** Accepted: the envelope is trusted from here on and nothing re-validates it. */
export interface DashboardSpecAccepted {
  readonly ok: true;
  readonly spec: DashboardSpecEnvelope;
  readonly bytes: number;
}

/** Rejected: `reason` is plain text, safe to put in a tool result verbatim. */
export interface DashboardSpecRejected {
  readonly ok: false;
  readonly reason: string;
  /**
   * Absent only when the input could not be MEASURED — a structure so deeply
   * nested that the byte counter's own recursion overflowed before producing a
   * number. Present in every other rejection.
   */
  readonly bytes?: number;
}

export type DashboardSpecValidation =
  DashboardSpecAccepted | DashboardSpecRejected;

/** How many zod issues a rejection reason names before it summarises. */
const MAX_REPORTED_ISSUES = 8;

/**
 * Flatten zod issues into one plain-text line.
 *
 * The path is included because the single most common failure is a near-miss
 * key, and a reason that does not say WHERE makes an agent re-send the same
 * spec. Capped so a spec with 400 bad rows cannot produce a tool result longer
 * than the spec itself.
 */
export function formatDashboardSpecIssues(
  issues: readonly z.core.$ZodIssue[],
): string {
  const reported = issues.slice(0, MAX_REPORTED_ISSUES).map((issue) => {
    const path = issue.path.map(String).join('.');
    return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
  });
  const listed = reported.join('; ');
  const remainder = issues.length - reported.length;
  if (remainder === 0) return listed;
  const plural = remainder === 1 ? 'issue' : 'issues';
  return `${listed} (+${remainder} more ${plural})`;
}

/** A `children`/`components` array on an untyped, not-yet-validated node. */
function rawChildren(node: unknown, key: string): readonly unknown[] {
  if (typeof node !== 'object' || node === null || Array.isArray(node)) {
    return [];
  }
  const value = (node as Record<string, unknown>)[key];
  return Array.isArray(value) ? value : [];
}

/**
 * Bound the component tree BEFORE the recursive zod parse (revision 1,
 * finding 3).
 *
 * The depth and component-count budgets used to live only in the envelope's
 * `superRefine`, which zod runs AFTER parsing the whole tree — and parsing is
 * recursive through `children`. A stat nested 999 deep is 51,072 UTF-8 bytes,
 * comfortably inside the 256 KB cap, and it overflowed the stack: the validator
 * threw `RangeError: Maximum call stack size exceeded` instead of returning its
 * rejection union. Depth 9 and depth 200 rejected normally; 1,000 did not. That
 * is tolerable at the MCP boundary, where the dispatcher's catch still yields
 * `isError: true` and no push — but this is the validator TASK_2026_494 calls at
 * the webview boundary, where an exception and a rejection are not the same
 * answer.
 *
 * So the walk here is ITERATIVE, with an explicit stack, and it stops one level
 * past the budget rather than walking to the bottom of a hostile tree. It
 * follows only the two recursive keys — `components` on the envelope and
 * `children` on a node — because those are the only axis the schema recurses
 * through; every other nesting in the contract has a fixed, shallow depth that
 * a non-recursive schema already bounds.
 *
 * It deliberately does NOT re-implement validation. It answers exactly the two
 * questions no post-parse check can answer safely, and zod remains the
 * authority on everything else.
 *
 * The depth and count rules are consequently expressed TWICE — here and in the
 * envelope's `superRefine`. That is not accidental duplication: the refinements
 * are unreachable through this function (the walk always runs first) but they
 * are the only guard for a caller that uses `DashboardSpecEnvelopeSchema`
 * DIRECTLY, which the contract's own specs do and TASK_2026_494 may. Both
 * layers deliberately word the breach the same way, so a caller never has to
 * know which one fired.
 */
function findStructuralBreach(input: unknown): string | null {
  const roots = rawChildren(input, 'components');
  if (roots.length === 0) return null;

  const maxDepth = DASHBOARD_LIMITS.maxTreeDepth;
  const maxNodes = DASHBOARD_LIMITS.maxComponents;
  let nodes = 0;
  const stack: Array<{ node: unknown; depth: number }> = roots.map((node) => ({
    node,
    depth: 1,
  }));

  while (stack.length > 0) {
    const { node, depth } = stack.pop() as { node: unknown; depth: number };

    if (depth > maxDepth) {
      return `component tree is more than ${maxDepth} levels deep, over the ${maxDepth} limit.`;
    }
    nodes += 1;
    if (nodes > maxNodes) {
      return `spec carries more than ${maxNodes} components, over the ${maxNodes} limit.`;
    }

    for (const child of rawChildren(node, 'children')) {
      stack.push({ node: child, depth: depth + 1 });
    }
  }

  return null;
}

/**
 * Validate an untrusted dashboard spec.
 *
 * Fails closed and atomically: the first failure returns a reason and NO spec,
 * so a caller has nothing partial to broadcast. It NEVER throws — see the
 * `catch` at the end, and `findStructuralBreach` for why that is not belt and
 * braces but a requirement of the second boundary.
 *
 * Order is deliberate:
 *
 * 1. Byte budget, against the value as it ARRIVED. Measuring after the parse
 *    would measure a document the agent did not send, and a 10 MB spec would
 *    be walked in full before being refused.
 * 2. Structural bound, iteratively. Cheap, and it is what stops a pathological
 *    tree from reaching a recursive parser.
 * 3. The zod parse, which is the authority on everything else.
 */
export function validateDashboardSpec(
  input: unknown,
  countUtf8Bytes: DashboardJsonByteCounter,
): DashboardSpecValidation {
  let bytes: number | undefined;
  try {
    bytes = countUtf8Bytes(input);
    if (bytes > DASHBOARD_LIMITS.maxSpecBytes) {
      return {
        ok: false,
        bytes,
        reason:
          `spec is ${bytes} UTF-8 bytes, over the ${DASHBOARD_LIMITS.maxSpecBytes} byte limit. ` +
          'Reference large datasets with { "data": { "resultId": "..." } } instead of embedding rows.',
      };
    }

    const breach = findStructuralBreach(input);
    if (breach !== null) {
      return { ok: false, bytes, reason: breach };
    }

    const parsed = DashboardSpecEnvelopeSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        bytes,
        reason: formatDashboardSpecIssues(parsed.error.issues),
      };
    }

    return { ok: true, bytes, spec: parsed.data };
  } catch (error: unknown) {
    // The last line of the fail-closed guarantee. `findStructuralBreach` bounds
    // the one axis the SCHEMA recurses through, but the byte counter recurses
    // over the WHOLE value: `jsonUtf8Bytes` is `JSON.stringify`, and an input
    // with 200,000 levels of nesting under a key the schema never visits
    // overflows inside step 1, before any budget has been read. Verified, not
    // hypothesised. Whatever the cause, a caller of this function gets a
    // rejection it can render — never an exception it has to know to catch.
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ...(bytes === undefined ? {} : { bytes }),
      ok: false,
      reason:
        `spec could not be validated: ${detail}. This usually means the JSON is ` +
        'nested far more deeply than the contract allows. Send a flat spec.',
    };
  }
}
