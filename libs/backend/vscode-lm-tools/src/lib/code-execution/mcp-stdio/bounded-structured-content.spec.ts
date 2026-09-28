/**
 * boundStructuredContent — the final serialized-size invariant
 * (TASK_2026_559, review r4 R4-02).
 *
 * The bounded object must satisfy BOTH limits of the budget after its last
 * mutation, including the disclosure metadata (`omittedFields`, `cutFields`)
 * and on the recovery-only branch, and must stay valid JSON.
 */
import * as os from 'os';
import * as path from 'path';
import {
  countTokensPiecewise,
  type TextBudget,
} from '@ptah-extension/tool-output-reducers';
import {
  STRUCTURED_TRUNCATION_KEY,
  boundStructuredContent,
  type StructuredRecovery,
} from './bounded-structured-content';

const BUDGET: TextBudget = { tokens: 2000, chars: 8000 };

function expectWithinBudget(
  value: Record<string, unknown>,
  budget: TextBudget = BUDGET,
): Record<string, unknown> {
  const json = JSON.stringify(value);
  expect(json.length).toBeLessThanOrEqual(budget.chars);
  expect(countTokensPiecewise(json)).toBeLessThanOrEqual(budget.tokens);
  // Valid JSON that round-trips to the same object.
  expect(JSON.parse(json)).toEqual(value);
  return value;
}

function noteOf(value: Record<string, unknown>): Record<string, unknown> {
  const note = value[STRUCTURED_TRUNCATION_KEY];
  expect(note).toBeDefined();
  return note as Record<string, unknown>;
}

/** A spool file path laid out as `spoolToolText` writes it under `root`. */
function spoolPathUnder(root: string, name: string): string {
  return path.join(root, '.ptah', 'tmp', 'mcp-out', name);
}

describe('boundStructuredContent — final size invariant (review r4 R4-02)', () => {
  const root = path.join(os.tmpdir(), 'ptah-bounded-structured');
  const recovery: StructuredRecovery = {
    structured: { path: spoolPathUnder(root, '1-1700000000000-abcd.txt') },
    textSpoolPath: spoolPathUnder(root, '1-1700000000001-beef.txt'),
    spoolRoot: root,
  };

  it('two long fields: the omitted second field is reserved before filling, so the result stays within both limits (reviewer probe: 2,002 tokens)', () => {
    const value = {
      agentId: 'a1',
      cli: 'ptah-cli',
      status: 'running',
      startedAt: '2026-01-01T00:00:00.000Z',
      ptahCliName: 'n'.repeat(20_000),
      role: 'r'.repeat(200),
    };

    const out = expectWithinBudget(
      boundStructuredContent(value, BUDGET, recovery),
    );

    expect(out).toMatchObject({ agentId: 'a1', status: 'running' });
    const note = noteOf(out);
    const omitted = note['omittedFields'] as string[];
    const cut = note['cutFields'] as Record<string, unknown>;
    // Every long field is either shown as a prefix (and named in cutFields)
    // or named in omittedFields: nothing disappears silently.
    for (const key of ['ptahCliName', 'role']) {
      expect(key in cut || omitted.includes(key)).toBe(true);
      expect(key in cut).toBe(key in out);
    }
  });

  it.each([33, 40, 64, 129, 200, 500, 2_000, 20_000])(
    'two long fields, second of %i chars: always within both limits',
    (secondLength) => {
      const value = {
        agentId: 'a1',
        detail: 'x'.repeat(20_000),
        role: 'r'.repeat(secondLength),
        extra: 'y'.repeat(secondLength),
      };

      expectWithinBudget(boundStructuredContent(value, BUDGET, recovery));
    },
  );

  it('a 1,200-segment spool root: locators are shown relative to the spool root, bounded, still naming the file (reviewer probe: 9,739 chars / 2,441 tokens)', () => {
    const deepRoot = path.join(
      os.tmpdir(),
      ...Array.from({ length: 1200 }, () => 'segment'),
    );
    const structuredName = '7-1700000000000-abcd.txt';
    const textName = '7-1700000000001-beef.txt';
    const deep: StructuredRecovery = {
      structured: { path: spoolPathUnder(deepRoot, structuredName) },
      textSpoolPath: spoolPathUnder(deepRoot, textName),
      spoolRoot: deepRoot,
    };
    const value = {
      agentId: 'a1',
      mode: 'steer',
      detail: 'MARK-deep-' + 'e'.repeat(20_000),
    };

    const out = expectWithinBudget(boundStructuredContent(value, BUDGET, deep));

    const note = noteOf(out);
    expect(note).toMatchObject({ truncated: true, limitChars: BUDGET.chars });
    const relative = path.join('.ptah', 'tmp', 'mcp-out');
    expect(note['fullStructuredContent']).toBe(
      `${path.join(relative, structuredName)} under the workspace root`,
    );
    expect(note['fullText']).toBe(
      `${path.join(relative, textName)} under the workspace root`,
    );
    // The relative locator leaves room for the value itself.
    expect(out).toMatchObject({ agentId: 'a1', mode: 'steer' });
    expect(String(out['detail']).startsWith('MARK-deep-')).toBe(true);
  });

  it('a skeleton that cannot fit: the recovery-only note is itself held to the budget', () => {
    const deepRoot = path.join(
      os.tmpdir(),
      ...Array.from({ length: 1200 }, () => 'segment'),
    );
    const deep: StructuredRecovery = {
      structured: {
        path: spoolPathUnder(deepRoot, '8-1700000000000-abcd.txt'),
      },
      spoolRoot: deepRoot,
    };
    const tight: TextBudget = { tokens: 60, chars: 240 };
    const value = Object.fromEntries(
      Array.from({ length: 40 }, (_, i) => [`field${i}`, `v${i}`]),
    );

    const out = expectWithinBudget(
      boundStructuredContent(value, tight, deep),
      tight,
    );

    const note = noteOf(out);
    expect(note['truncated']).toBe(true);
    expect(String(note['fullStructuredContent'])).toContain(
      '8-1700000000000-abcd.txt',
    );
  });
});
