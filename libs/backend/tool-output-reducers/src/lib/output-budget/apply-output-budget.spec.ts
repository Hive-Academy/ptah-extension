import * as fsSync from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { IOutputChannel } from '@ptah-extension/platform-core';
import { reduceOutput, type ReduceOutputOptions } from '../reduce-output';
import { countTokens, fitsBudget, type TextBudget } from '../token-measure';
import {
  applyOutputBudget,
  type ApplyOutputBudgetInput,
  type OutputReduction,
} from './apply-output-budget';

const BUDGET: TextBudget = { tokens: 500, chars: 2000 };
const TRAILER =
  /\n\n\[reduced: (\S+)( — partial, cut (?:at a line end|mid-line))? — showing (\d+) of (\d+) tokens — (full output: (.+)|full output could not be saved: (.+))\]$/;

let root: string;

beforeEach(() => {
  root = fsSync.mkdtempSync(path.join(os.tmpdir(), 'output-budget-'));
});

afterEach(() => {
  jest.restoreAllMocks();
  fsSync.rmSync(root, { recursive: true, force: true });
});

function reduceWith(
  raw: string,
  extra: Partial<ReduceOutputOptions> = {},
): ApplyOutputBudgetInput['reduce'] {
  return (limit) =>
    reduceOutput(raw, {
      budgetTokens: limit.tokens,
      budgetChars: limit.chars,
      ...extra,
    });
}

function call(
  raw: string,
  overrides: Partial<ApplyOutputBudgetInput> = {},
): ReturnType<typeof applyOutputBudget> {
  return applyOutputBudget({
    text: raw,
    budget: BUDGET,
    requestId: 'req-1',
    spoolRoot: root,
    reduce: reduceWith(raw),
    logLabel: '[test] tool',
    ...overrides,
  });
}

function channel(lines: string[]): IOutputChannel {
  return {
    name: 'test',
    appendLine: (line: string) => lines.push(line),
    append: () => undefined,
    clear: () => undefined,
    show: () => undefined,
    dispose: () => undefined,
  };
}

describe('applyOutputBudget', () => {
  it('returns the raw text byte-for-byte under the budget, without reducing or spooling', async () => {
    const reduce = jest.fn<Promise<OutputReduction>, [TextBudget]>();
    const raw = 'short answer\n';
    const outcome = await call(raw, { reduce });
    expect(outcome).toEqual({
      text: raw,
      reduced: false,
      truncated: false,
      reducer: 'none',
      rawTokens: countTokens(raw),
      returnedTokens: countTokens(raw),
      totalChars: raw.length,
    });
    expect(reduce).not.toHaveBeenCalled();
    expect(fsSync.existsSync(path.join(root, '.ptah'))).toBe(false);
  });

  it('reduces over the budget, spools the raw text and stays within both limits', async () => {
    const lines = Array.from(
      { length: 400 },
      (_, i) => `[2026-09-26T10:00:00] INFO step ${i} normal detail`,
    );
    lines.splice(300, 0, 'ERROR: UNIQUE_FAILURE');
    const raw = lines.join('\n');
    const outcome = await call(raw);
    expect(outcome.reducer).toBe('log-reduced');
    expect(outcome.reduced).toBe(true);
    expect(fitsBudget(outcome.text, BUDGET)).toBe(true);
    expect(outcome.returnedTokens).toBe(countTokens(outcome.text));
    expect(outcome.text).toContain('ERROR: UNIQUE_FAILURE');
    const match = TRAILER.exec(outcome.text);
    expect(match?.[6]).toBe(outcome.spoolPath);
    expect(fsSync.readFileSync(outcome.spoolPath ?? '', 'utf8')).toBe(raw);
  });

  it('cuts text no reducer can shorten and says it was cut', async () => {
    const raw = 'word '.repeat(4000);
    const outcome = await call(raw, {
      reduce: reduceWith(raw, { hint: 'preformatted' }),
    });
    expect(outcome.reducer).toBe('none');
    expect(outcome.truncated).toBe(true);
    expect(fitsBudget(outcome.text, BUDGET)).toBe(true);
    expect(TRAILER.exec(outcome.text)?.[2]).toMatch(/partial/);
    expect(raw.startsWith(outcome.text.split('\n\n[reduced:')[0])).toBe(true);
  });

  it('follows a Markdown outline with a labelled prefix of the raw text', async () => {
    const raw = Array.from(
      { length: 60 },
      (_, i) => `## Section ${i}\n\n${'Body text of the section. '.repeat(12)}`,
    ).join('\n\n');
    const outcome = await call(raw);
    expect(outcome.reducer).toBe('markdown-outline+prefix');
    expect(outcome.text).toContain(
      '[the full output from its start, cut to fit:]',
    );
    expect(fitsBudget(outcome.text, BUDGET)).toBe(true);
  });

  it('reports a spool failure in the trailer by errno code only', async () => {
    jest
      .spyOn(fsSync.promises, 'writeFile')
      .mockRejectedValue(
        Object.assign(new Error('EROFS /private/path'), { code: 'EROFS' }),
      );
    const outcome = await call('word '.repeat(4000));
    expect(outcome.spoolPath).toBeUndefined();
    expect(outcome.text).toMatch(/full output could not be saved: EROFS\]$/);
    expect(outcome.text).not.toContain('/private/path');
  });

  it('never throws: a failing reduce step falls back to a plain cut and one log line with the label', async () => {
    const lines: string[] = [];
    const raw = 'word '.repeat(4000);
    const outcome = await call(raw, {
      reduce: () => Promise.reject(new TypeError('boom from /private/path')),
      output: channel(lines),
    });
    expect(outcome.truncated).toBe(true);
    expect(fitsBudget(outcome.text, BUDGET)).toBe(true);
    expect(outcome.text).toMatch(
      /full output could not be saved: TypeError\]$/,
    );
    expect(lines).toEqual([
      '[test] tool budget step failed with TypeError; returning a plain cut',
    ]);
    expect(fsSync.existsSync(path.join(root, '.ptah'))).toBe(false);
  });

  it('a throwing output channel does not escape', async () => {
    const outcome = await call('word '.repeat(4000), {
      reduce: () => Promise.reject(new Error('x')),
      output: {
        ...channel([]),
        appendLine: () => {
          throw new Error('sink down');
        },
      },
    });
    expect(outcome.text).toMatch(/full output could not be saved: Error\]$/);
  });
});
