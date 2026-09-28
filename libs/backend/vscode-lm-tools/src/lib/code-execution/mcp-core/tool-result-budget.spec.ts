import * as fsSync from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { compactCoverage } from '@ptah-extension/platform-core';
import { SURFACE_LIMITS } from '@ptah-extension/shared/mcp-apps-contracts/surface';
import {
  countTokens,
  reduceOutput,
  type TextBudget,
} from '@ptah-extension/tool-output-reducers';
import {
  applyToolResultBudget,
  DEFAULT_TOOL_RESULT_BUDGET_CHARS,
  DEFAULT_TOOL_RESULT_BUDGET_TOKENS,
  getToolResultBudget,
  PRESERVED_RESULT_KEYS,
  TOOL_CONTENT_HINTS,
  TOOL_RESULT_BUDGET_OVERRIDES,
  type ApplyToolResultBudgetInput,
} from './tool-result-budget';

jest.mock('@ptah-extension/tool-output-reducers', () => {
  const actual = jest.requireActual<
    typeof import('@ptah-extension/tool-output-reducers')
  >('@ptah-extension/tool-output-reducers');
  return { ...actual, reduceOutput: jest.fn(actual.reduceOutput) };
});

/**
 * The real builtin modules. The `import * as` bindings above are interop
 * wrappers whose getters read these objects, so a spy has to go here.
 */
const realCrypto: typeof import('node:crypto') =
  jest.requireActual('node:crypto');
const realOs: typeof import('node:os') = jest.requireActual('node:os');

const DEFAULT: TextBudget = {
  tokens: DEFAULT_TOOL_RESULT_BUDGET_TOKENS,
  chars: DEFAULT_TOOL_RESULT_BUDGET_CHARS,
};
const TRAILER =
  /\n\n\[reduced: (\S+)( — partial, cut (?:at a line end|mid-line))? — showing (\d+) of (\d+) tokens — (full output: (.+)|full output could not be saved: (.+))\]$/;

let root: string;

beforeEach(() => {
  root = fsSync.mkdtempSync(path.join(os.tmpdir(), 'tool-result-budget-'));
});

afterEach(() => {
  jest.restoreAllMocks();
  fsSync.rmSync(root, { recursive: true, force: true });
});

function spoolDir(base = root): string {
  return path.join(base, '.ptah', 'tmp', 'mcp-out');
}

function spooledFiles(base = root): string[] {
  const dir = spoolDir(base);
  return fsSync.existsSync(dir) ? fsSync.readdirSync(dir).sort() : [];
}

function call(
  text: string,
  overrides: Partial<ApplyToolResultBudgetInput> = {},
): ReturnType<typeof applyToolResultBudget> {
  return applyToolResultBudget({
    text,
    toolName: 'ptah_some_tool',
    requestId: 7,
    spoolRoot: root,
    ...overrides,
  });
}

/**
 * Independent oracle (review 2e r1): the whole returned string, encoded at
 * once by the tokenizer, and its UTF-16 length — not the helper's own
 * piece-wise measure.
 */
function expectWithin(text: string, budget: TextBudget = DEFAULT): void {
  expect(text.length).toBeLessThanOrEqual(budget.chars);
  expect(countTokens(text)).toBeLessThanOrEqual(budget.tokens);
}

/** Parses the trailer and checks the returned text is within `budget`. */
function trailerOf(
  text: string,
  budget: TextBudget = DEFAULT,
): RegExpExecArray {
  expectWithin(text, budget);
  const match = TRAILER.exec(text);
  if (match === null) {
    throw new Error(`no trailer in ${JSON.stringify(text.slice(-300))}`);
  }
  return match;
}

function jsonRows(count: number): string {
  return JSON.stringify(
    Array.from({ length: count }, (_, i) => ({
      id: i,
      name: `item-${i}`,
      status: i % 7 === 0 ? 'failed' : 'ok',
      note: null,
      tags: [],
    })),
    null,
    2,
  );
}

describe('budget tables', () => {
  it('declares the defaults', () => {
    expect(DEFAULT_TOOL_RESULT_BUDGET_TOKENS).toBe(2000);
    expect(DEFAULT_TOOL_RESULT_BUDGET_CHARS).toBe(8000);
    expect(getToolResultBudget('ptah_workspace_analyze')).toEqual(DEFAULT);
  });

  it('overrides only the tools whose description documents a bound', () => {
    expect(Object.keys(TOOL_RESULT_BUDGET_OVERRIDES).sort()).toEqual([
      'ptah_browser_content',
      'ptah_surface_get_state',
    ]);
    expect(getToolResultBudget('ptah_browser_content')).toEqual({
      chars: 33 * 1024,
      tokens: (33 * 1024) / 4,
    });
    expect(getToolResultBudget('ptah_surface_get_state')).toEqual({
      chars: SURFACE_LIMITS.maxStateReadBytes,
      tokens: SURFACE_LIMITS.maxStateReadBytes / 4,
    });
  });

  it('never resolves an inherited property name as an override', () => {
    for (const name of [
      'constructor',
      '__proto__',
      'toString',
      'hasOwnProperty',
    ]) {
      expect(getToolResultBudget(name)).toEqual(DEFAULT);
    }
  });

  it('hints the formatter-owned tools preformatted', () => {
    expect(TOOL_CONTENT_HINTS).toEqual({
      ptah_get_diagnostics: 'preformatted',
      ptah_get_symbol_index: 'preformatted',
      ptah_agent_spawn: 'preformatted',
      ptah_agent_status: 'preformatted',
      ptah_agent_read: 'preformatted',
      ptah_agent_message: 'preformatted',
      ptah_agent_report: 'preformatted',
      ptah_agent_stop: 'preformatted',
      ptah_agent_list: 'preformatted',
      ptah_task_list: 'preformatted',
    });
  });

  it('cuts an agent reply to a prefix instead of outlining away its body (review r3: R3-01)', async () => {
    // The shape `formatAgentMessage` returns: a short Markdown header, then
    // the agent's own reply. Both surfaces budget it under this name.
    const text =
      '## Agent Message\n\n**Agent ID:** a1  \n**Mode:** steer  \n' +
      `**Detail:** MARK-small-${'e'.repeat(20_000)}\n`;
    const outcome = await call(text, { toolName: 'ptah_agent_message' });
    const match = trailerOf(outcome.text);
    expect(match[1]).toBe('none');
    expect(outcome.reducer).toBe('none');
    expect(outcome.text).toContain(`MARK-small-${'e'.repeat(1000)}`);
    expect(fsSync.readFileSync(outcome.spoolPath as string, 'utf8')).toBe(text);
  });
});

describe('Markdown outline plus a labelled prefix (Batch 21r, reviews r3 R3-01 and r4 R4-03)', () => {
  const SENTENCE =
    'The retry used the same connection pool, so it failed again. ';
  const PREFIX_LABEL = '[the full output from its start, cut to fit:]';

  /** The outline part and the prefix part of a composed body. */
  function partsOf(text: string): { outline: string; prefix: string } {
    const body = text.slice(0, TRAILER.exec(text)?.index ?? text.length);
    const at = body.indexOf(PREFIX_LABEL);
    expect(at).toBeGreaterThan(0);
    return {
      outline: body.slice(0, at),
      prefix: body.slice(at + PREFIX_LABEL.length + 2),
    };
  }

  it('keeps a short header over one long paragraph, then a prefix of the paragraph', async () => {
    // Any tool (no hint): a short Markdown header, then one ~20 KB block.
    const text =
      '## Browser Click\n\n**Error:** MARK-paragraph ' +
      SENTENCE.repeat(330) +
      '\n';
    expect(text.length).toBeGreaterThan(DEFAULT.chars);
    const outcome = await call(text);
    const match = trailerOf(outcome.text);
    expect(match[1]).toBe('markdown-outline+prefix');
    expect(outcome).toMatchObject({
      reduced: true,
      reducer: 'markdown-outline+prefix',
    });
    const { outline, prefix } = partsOf(outcome.text);
    expect(outline).toContain('## Browser Click');
    expect(text.startsWith(prefix)).toBe(true);
    expect(prefix).toContain('MARK-paragraph');
    expect(prefix.length).toBeGreaterThan(DEFAULT.chars * 0.5);
    expect(fsSync.readFileSync(outcome.spoolPath as string, 'utf8')).toBe(text);
  });

  it('review r4 R4-03 A: a late heading and answer after one long paragraph survive with the start of the paragraph (was a 7,939-char prefix without the heading)', async () => {
    const text =
      '## Summary\n\nMARK-FRONT ' +
      SENTENCE.repeat(330).trimEnd() +
      '\n\n## CRITICAL-LATE-HEADING\n\nCRITICAL-ANSWER: pool size 4.\n';
    expect(text.length).toBeGreaterThan(DEFAULT.chars);
    const outcome = await call(text);
    expect(trailerOf(outcome.text)[1]).toBe('markdown-outline+prefix');
    const { outline, prefix } = partsOf(outcome.text);
    expect(outline).toContain('## CRITICAL-LATE-HEADING');
    expect(outline).toContain('CRITICAL-ANSWER: pool size 4.');
    expect(prefix).toContain('MARK-FRONT');
    expect(text.startsWith(prefix)).toBe(true);
    expect(fsSync.readFileSync(outcome.spoolPath as string, 'utf8')).toBe(text);
  });

  it('review r4 R4-03 B: a first long paragraph before 60 short sections keeps its front marker and every heading (was markdown-outline, 6,130 chars, marker gone)', async () => {
    const text =
      'MARK-BODY-DROPPED ' +
      SENTENCE.repeat(40).trimEnd() +
      '\n\n' +
      Array.from(
        { length: 60 },
        (_, i) => `## Section ${i}\n\n${SENTENCE.repeat(2).trimEnd()}\n`,
      ).join('\n');
    expect(text.length).toBeGreaterThan(DEFAULT.chars);
    const outcome = await call(text);
    expect(trailerOf(outcome.text)[1]).toBe('markdown-outline+prefix');
    expect(outcome.text).toContain('MARK-BODY-DROPPED');
    const { outline } = partsOf(outcome.text);
    for (let i = 0; i < 60; i++) {
      expect(outline).toContain(`## Section ${i}\n`);
    }
    expect(fsSync.readFileSync(outcome.spoolPath as string, 'utf8')).toBe(text);
  });

  it('keeps a header over one long table or list, then a prefix with the first rows', async () => {
    const table =
      '## Git Worktrees\n\n| Path | Branch |\n|---|---|\n' +
      Array.from(
        { length: 300 },
        (_, i) =>
          `| /work/${i === 0 ? 'MARK-table' : `repo-${i}`} | feature/${i}-long-branch-name |`,
      ).join('\n') +
      '\n';
    const list =
      '## JSON Validation\n\n### Repairs\n\n' +
      Array.from(
        { length: 300 },
        (_, i) =>
          `- ${i === 0 ? 'MARK-list' : 'Removed'} a trailing comma at line ${i + 1}`,
      ).join('\n') +
      '\n\n### Errors\n\n- Unexpected token } in JSON at position 4211\n';
    for (const [text, marker] of [
      [table, 'MARK-table'],
      [list, 'MARK-list'],
    ]) {
      expect(text.length).toBeGreaterThan(DEFAULT.chars);
      const outcome = await call(text);
      expect(trailerOf(outcome.text)[1]).toBe('markdown-outline+prefix');
      expect(outcome.reducer).toBe('markdown-outline+prefix');
      expect(partsOf(outcome.text).prefix).toContain(marker);
    }
  });

  it('outlines a document with many sections, every heading kept, and still leaves room for the prefix', async () => {
    const text = Array.from(
      { length: 60 },
      (_, i) =>
        `## Section ${i}\n\n${SENTENCE.repeat(3)}\n\n${SENTENCE.repeat(3)}\n`,
    ).join('\n');
    expect(text.length).toBeGreaterThan(DEFAULT.chars);
    const outcome = await call(text);
    expect(trailerOf(outcome.text)[1]).toBe('markdown-outline+prefix');
    expect(outcome.reducer).toBe('markdown-outline+prefix');
    const { outline, prefix } = partsOf(outcome.text);
    for (let i = 0; i < 60; i++) {
      expect(outline).toContain(`## Section ${i}\n`);
    }
    expect(text.startsWith(prefix)).toBe(true);
    expect(prefix).toContain('## Section 0\n');
  });

  it('leaves the non-outline reducers alone however little they return', async () => {
    // JSON compaction drops empty fields; a small result is not an omission.
    const raw = JSON.stringify(
      Array.from({ length: 400 }, (_, i) => ({
        id: i,
        note: null,
        tags: [],
        meta: {},
      })),
      null,
      2,
    );
    const outcome = await call(raw);
    expect(outcome.reducer).toBe('json-compact');
    expect(outcome.text.length).toBeLessThan(DEFAULT.chars * 0.5);
  });
});

describe('applyToolResultBudget', () => {
  it('returns an under-budget result byte-for-byte and spools nothing', async () => {
    const text = '## Result\n\n  keep  \r\n  exact spacing\t\n';
    const outcome = await call(text);
    expect(outcome).toEqual({
      text,
      reduced: false,
      truncated: false,
      reducer: 'none',
      rawTokens: outcome.rawTokens,
      returnedTokens: outcome.rawTokens,
      totalChars: text.length,
    });
    expect(outcome.rawTokens).toBeGreaterThan(0);
    expect(fsSync.existsSync(spoolDir())).toBe(false);
  });

  it('uses the per-tool override: 20k chars of browser content stay whole', async () => {
    const text = `## Page Content\n\n${'Readable page text line.\n'.repeat(800)}`;
    expect(text.length).toBeGreaterThan(DEFAULT.chars);
    const outcome = await call(text, { toolName: 'ptah_browser_content' });
    expect(outcome.text).toBe(text);
    expect(outcome.spoolPath).toBeUndefined();
  });

  it('reduces over-budget JSON, spools the raw byte-equal and names it in the trailer', async () => {
    const raw = jsonRows(150);
    expect(raw.length).toBeGreaterThan(DEFAULT.chars);
    const outcome = await call(raw);
    expect(outcome).toMatchObject({
      reduced: true,
      truncated: false,
      reducer: 'json-compact',
      totalChars: raw.length,
    });
    const trailer = trailerOf(outcome.text);
    expect(trailer[1]).toBe('json-compact');
    expect(trailer[2]).toBeUndefined();
    expect(Number(trailer[4])).toBe(outcome.rawTokens);
    expect(Number(trailer[3])).toBeLessThan(outcome.rawTokens);
    expect(trailer[6]).toBe(outcome.spoolPath);
    expect(path.dirname(outcome.spoolPath ?? '')).toBe(spoolDir());
    expect(path.basename(outcome.spoolPath ?? '')).toMatch(
      /^7-\d+-[0-9a-f]{4}\.txt$/,
    );
    expect(fsSync.readFileSync(outcome.spoolPath ?? '', 'utf8')).toBe(raw);
    expect(outcome.returnedTokens).toBeLessThanOrEqual(DEFAULT.tokens);
  });

  it('cuts reduced JSON that is still over budget mid-line and marks it partial', async () => {
    const raw = JSON.stringify({
      rows: Array.from(
        { length: 900 },
        (_, i) => `distinct value number ${i} ${'z'.repeat(i % 13)}`,
      ),
    });
    expect(raw).not.toContain('\n');
    const outcome = await call(raw);
    expect(outcome.truncated).toBe(true);
    const trailer = trailerOf(outcome.text);
    expect(trailer[2]).toBe(' — partial, cut mid-line');
    expect(fsSync.readFileSync(outcome.spoolPath ?? '', 'utf8')).toBe(raw);
  });

  it('cuts over-budget single-line text at the limit and spools it', async () => {
    const raw = 'word '.repeat(4000).trim();
    const outcome = await call(raw);
    expect(outcome).toMatchObject({
      reduced: false,
      truncated: true,
      reducer: 'none',
    });
    const trailer = trailerOf(outcome.text);
    expect(trailer[1]).toBe('none');
    expect(trailer[2]).toBe(' — partial, cut mid-line');
    const body = outcome.text.slice(0, trailer.index);
    expect(raw.startsWith(body)).toBe(true);
    expect(body.length).toBeGreaterThan(DEFAULT.chars * 0.8);
    expect(fsSync.readFileSync(outcome.spoolPath ?? '', 'utf8')).toBe(raw);
  });

  it('cuts multi-line text at the last line break inside the window', async () => {
    const lines = Array.from(
      { length: 400 },
      (_, i) => `Line ${i}: an ordinary sentence of prose.`,
    );
    const raw = lines.join('\r\n');
    const outcome = await call(raw);
    const trailer = trailerOf(outcome.text);
    expect(trailer[2]).toBe(' — partial, cut at a line end');
    const body = outcome.text.slice(0, trailer.index);
    expect(raw.startsWith(`${body}\r\n`)).toBe(true);
    expect(body.split('\r\n').every((line, i) => line === lines[i])).toBe(true);
  });

  it('counts tokens as well as chars: dense CJK is cut to the token limit', async () => {
    const raw = '漢字仮名交じり文。'.repeat(700); // 6,300 chars, under the char ceiling
    expect(raw.length).toBeLessThan(DEFAULT.chars);
    const outcome = await call(raw);
    expect(outcome.truncated).toBe(true);
    trailerOf(outcome.text);
    expect(outcome.returnedTokens).toBeLessThanOrEqual(DEFAULT.tokens);
  });

  it('cuts preformatted diagnostics and never runs a reducer on them', async () => {
    const raw = jsonRows(150);
    const outcome = await call(raw, { toolName: 'ptah_get_diagnostics' });
    expect(outcome).toMatchObject({
      reduced: false,
      truncated: true,
      reducer: 'none',
    });
    const trailer = trailerOf(outcome.text);
    expect(raw.startsWith(outcome.text.slice(0, trailer.index))).toBe(true);
  });

  it('keeps the error lines of an over-budget log through the reducer', async () => {
    const lines: string[] = [];
    for (let i = 0; i < 3000; i++) {
      lines.push(
        `[2026-09-26T10:00:${String(i % 60).padStart(2, '0')}] INFO step ${i}`,
      );
      if (i === 1500) {
        lines.push(
          'ERROR: expected 3 to be 4',
          '    at Object.<anonymous> (src/a.spec.ts:12:5)',
        );
      }
    }
    const outcome = await call(lines.join('\n'));
    expect(outcome.reducer).toBe('log-reduced');
    trailerOf(outcome.text);
    expect(outcome.text).toContain('ERROR: expected 3 to be 4');
  });

  it('reports a spool write failure in the trailer and still returns the capped text', async () => {
    const denied = Object.assign(
      new Error(`EACCES: permission denied, open '${root}'`),
      {
        code: 'EACCES',
      },
    );
    jest.spyOn(fsSync.promises, 'writeFile').mockRejectedValue(denied);
    const outcome = await call('word '.repeat(4000));
    expect(outcome.spoolPath).toBeUndefined();
    expect(outcome.truncated).toBe(true);
    const trailer = trailerOf(outcome.text);
    expect(trailer[7]).toBe('EACCES');
    expect(outcome.text).not.toContain(root);
  });

  it('reports a spool directory failure the same way', async () => {
    jest
      .spyOn(fsSync.promises, 'mkdir')
      .mockRejectedValue(
        Object.assign(new Error('read-only'), { code: 'EROFS' }),
      );
    const outcome = await call(jsonRows(150));
    expect(outcome.reducer).toBe('json-compact');
    expect(trailerOf(outcome.text)[7]).toBe('EROFS');
  });

  it('writes two files for two calls with the same request id', async () => {
    const first = await call(`first ${'word '.repeat(4000)}`, { requestId: 1 });
    const second = await call(`second ${'word '.repeat(4000)}`, {
      requestId: 1,
    });
    expect(first.spoolPath).not.toBe(second.spoolPath);
    expect(spooledFiles()).toHaveLength(2);
    expect(
      fsSync.readFileSync(first.spoolPath ?? '', 'utf8').startsWith('first'),
    ).toBe(true);
    expect(
      fsSync.readFileSync(second.spoolPath ?? '', 'utf8').startsWith('second'),
    ).toBe(true);
  });

  it('never overwrites an existing spool file with the same name', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_790_000_000_000);
    const fixed = Buffer.from([0xab, 0xcd]);
    const random = jest.spyOn(
      realCrypto,
      'randomBytes',
    ) as unknown as jest.Mock;
    // The first call's name, then the second call's first attempt: the same name.
    random.mockReturnValueOnce(fixed).mockReturnValueOnce(fixed);
    const first = await call(`first ${'word '.repeat(4000)}`, {
      requestId: 'a',
    });
    const second = await call(`second ${'word '.repeat(4000)}`, {
      requestId: 'a',
    });
    expect(path.basename(first.spoolPath ?? '')).toBe(
      'a-1790000000000-abcd.txt',
    );
    expect(second.spoolPath).toBeDefined();
    expect(second.spoolPath).not.toBe(first.spoolPath);
    expect(
      fsSync.readFileSync(first.spoolPath ?? '', 'utf8').startsWith('first'),
    ).toBe(true);
    expect(
      fsSync.readFileSync(second.spoolPath ?? '', 'utf8').startsWith('second'),
    ).toBe(true);
  });

  it('sanitises the request id so the spool file stays in the spool directory', async () => {
    const outcome = await call('word '.repeat(4000), {
      requestId: '../../evil/..\\x',
    });
    expect(path.dirname(outcome.spoolPath ?? '')).toBe(spoolDir());
    expect(path.basename(outcome.spoolPath ?? '')).toMatch(
      /^[A-Za-z0-9_-]+-\d+-[0-9a-f]{4}\.txt$/,
    );
  });

  it('falls back to os.tmpdir() for a relative or empty spool root', async () => {
    const tmp = path.join(root, 'tmp');
    jest.spyOn(realOs, 'tmpdir').mockReturnValue(tmp);
    for (const spoolRoot of ['', 'relative/dir']) {
      const outcome = await call('word '.repeat(4000), { spoolRoot });
      expect(path.dirname(outcome.spoolPath ?? '')).toBe(spoolDir(tmp));
    }
  });

  it('deletes only its own spool files older than 24 hours when it writes', async () => {
    const dir = spoolDir();
    fsSync.mkdirSync(dir, { recursive: true });
    const old = (Date.now() - 25 * 60 * 60 * 1000) / 1000;
    const stale = path.join(dir, '3-1700000000000-0a0b.txt');
    const fresh = path.join(dir, '4-1790000000000-0c0d.txt');
    const foreign = path.join(dir, 'notes.txt');
    for (const file of [stale, fresh, foreign]) {
      fsSync.writeFileSync(file, 'x');
    }
    fsSync.utimesSync(stale, old, old);
    fsSync.utimesSync(foreign, old, old);
    const outcome = await call('word '.repeat(4000));
    expect(fsSync.existsSync(stale)).toBe(false);
    expect(fsSync.existsSync(fresh)).toBe(true);
    expect(fsSync.existsSync(foreign)).toBe(true);
    expect(fsSync.existsSync(outcome.spoolPath ?? '')).toBe(true);
  });

  it('never throws: an unexpected failure falls back to a plain cut within budget', async () => {
    const lines: string[] = [];
    const output = {
      name: 'test',
      appendLine: (line: string) => lines.push(line),
      append: () => undefined,
      clear: () => undefined,
      show: () => undefined,
      dispose: () => undefined,
    };
    jest
      .mocked(reduceOutput)
      .mockRejectedValueOnce(new TypeError('boom from /private/path'));
    const raw = 'word '.repeat(4000);
    const outcome = await call(raw, { output });
    expect(outcome.truncated).toBe(true);
    expectWithin(outcome.text);
    expect(outcome.text).toMatch(
      /full output could not be saved: TypeError\]$/,
    );
    expect(raw.startsWith(outcome.text.split('\n\n[reduced:')[0])).toBe(true);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('TypeError');
    expect(lines[0]).not.toContain('/private/path');
    expect(fsSync.existsSync(spoolDir())).toBe(false);
  });
});

describe('review 2e r1 regressions', () => {
  /** The review's S1 reproduction: 2,734 chars that encode to exactly 2,001 tokens. */
  function reviewerS1Text(): string {
    let seed = 42;
    const alphabet = 'abcefGWiX012345679_!-??';
    let raw = '';
    for (let i = 0; i <= 222; i++) {
      let s = '';
      for (let j = 0; j < 3500; j++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        s += alphabet[seed % alphabet.length];
      }
      if (i === 222) raw = s.slice(0, 2734);
    }
    return raw;
  }

  function sinkDown(): ApplyToolResultBudgetInput['output'] {
    return {
      name: 'test',
      appendLine: () => {
        throw new Error('sink down');
      },
      append: () => undefined,
      clear: () => undefined,
      show: () => undefined,
      dispose: () => undefined,
    };
  }

  it('S1: a 2,001-token text is never returned whole under a 2,000-token budget', async () => {
    const raw = reviewerS1Text();
    expect(countTokens(raw)).toBe(2001);
    const outcome = await call(raw, { toolName: 'ptah_get_diagnostics' });
    expect(outcome.text).not.toBe(raw);
    expect(outcome.truncated).toBe(true);
    expect(outcome.rawTokens).toBe(2001);
    expect(outcome.returnedTokens).toBe(countTokens(outcome.text));
    trailerOf(outcome.text);
  });

  it('S1: the identity path reports the exact count at the budget edge', async () => {
    const raw = reviewerS1Text().slice(0, 2700);
    const exact = countTokens(raw);
    expect(exact).toBeLessThanOrEqual(DEFAULT.tokens);
    const outcome = await call(raw);
    expect(outcome.text).toBe(raw);
    expect(outcome.returnedTokens).toBe(exact);
  });

  it('S2: a verbose head never pushes the failure and the summary out of a log', async () => {
    const lines = Array.from(
      { length: 1000 },
      (_, i) =>
        `[2026-09-26T10:00:00] INFO step ${i} ${'normal detail '.repeat(40)}`,
    );
    lines.splice(700, 0, 'ERROR: UNIQUE_FAILURE', '    at fail (x.ts:1:2)');
    lines.push('Tests: 1 failed, 999 passed');
    const raw = lines.join('\n');
    const outcome = await call(raw);
    expect(outcome.reducer).toBe('log-reduced');
    trailerOf(outcome.text);
    const out = outcome.text.split('\n');
    expect(out).toContain('ERROR: UNIQUE_FAILURE');
    expect(out).toContain('    at fail (x.ts:1:2)');
    expect(out).toContain('Tests: 1 failed, 999 passed');
    expect(fsSync.readFileSync(outcome.spoolPath ?? '', 'utf8')).toBe(raw);
  });

  it('M1: a spool path too long for the budget is shown relative, and the text still fits', async () => {
    const longRoot = path.join(
      path.parse(root).root,
      ...Array.from({ length: 35 }, () => 'qz'.repeat(100)),
    );
    jest.spyOn(fsSync.promises, 'mkdir').mockResolvedValue(undefined);
    jest.spyOn(fsSync.promises, 'writeFile').mockResolvedValue(undefined);
    jest.spyOn(fsSync.promises, 'readdir').mockResolvedValue([]);
    const outcome = await call('word '.repeat(4000), { spoolRoot: longRoot });
    expect(outcome.spoolPath?.startsWith(longRoot)).toBe(true);
    expectWithin(outcome.text);
    expect(outcome.text).not.toContain('qzqz');
    expect(outcome.text).toMatch(
      /full output: \.ptah[\\/]tmp[\\/]mcp-out[\\/]7-\d+-[0-9a-f]{4}\.txt under the workspace root\]$/,
    );
    expect(outcome.text.length).toBeGreaterThan(DEFAULT.chars * 0.7);
  });

  it('M1: a temp-directory spool root is named as such in a relative locator', async () => {
    const longTmp = path.join(
      root,
      ...Array.from({ length: 30 }, () => 'tq'.repeat(100)),
    );
    jest.spyOn(realOs, 'tmpdir').mockReturnValue(longTmp);
    jest.spyOn(fsSync.promises, 'mkdir').mockResolvedValue(undefined);
    jest.spyOn(fsSync.promises, 'writeFile').mockResolvedValue(undefined);
    jest.spyOn(fsSync.promises, 'readdir').mockResolvedValue([]);
    const outcome = await call('word '.repeat(4000), { spoolRoot: '' });
    expectWithin(outcome.text);
    expect(outcome.text).toMatch(/ under the system temp directory\]$/);
  });

  it('M2: a throwing output channel does not escape the never-throws wrapper', async () => {
    jest.mocked(reduceOutput).mockRejectedValueOnce(new TypeError('boom'));
    const raw = 'word '.repeat(4000);
    const outcome = await call(raw, { output: sinkDown() });
    expect(outcome.truncated).toBe(true);
    expectWithin(outcome.text);
    expect(outcome.text).toMatch(
      /full output could not be saved: TypeError\]$/,
    );
  });

  it('M3: a custom Error name never reaches the trailer or the log', async () => {
    const lines: string[] = [];
    const output = {
      ...sinkDown(),
      appendLine: (line: string) => lines.push(line),
    } as ApplyToolResultBudgetInput['output'];
    jest
      .mocked(reduceOutput)
      .mockRejectedValueOnce(
        Object.assign(new Error('message'), { name: '/private/SECRET' }),
      );
    const outcome = await call('word '.repeat(4000), { output });
    expect(outcome.text).toMatch(/full output could not be saved: Error\]$/);
    expect(outcome.text).not.toContain('SECRET');
    expect(lines.join('\n')).not.toContain('SECRET');
  });

  it('M3: a spool failure with a custom name and no errno code reports only Error', async () => {
    jest
      .spyOn(fsSync.promises, 'writeFile')
      .mockRejectedValue(
        Object.assign(new Error('x'), { name: '/private/SECRET' }),
      );
    const outcome = await call('word '.repeat(4000));
    expect(outcome.text).toMatch(/full output could not be saved: Error\]$/);
    expect(outcome.text).not.toContain('SECRET');
  });
});

describe('review 2e r2 regressions', () => {
  it('B1: an over-cap HTML document is cut and spooled raw, never extracted from stitched pieces', async () => {
    const raw =
      '<main>\n<p>VISIBLE</p>\n' +
      'x'.repeat(1100000) +
      '\n<script>\n' +
      'y'.repeat(1100000) +
      '\n<p>HIDDEN_SCRIPT_SENTINEL</p>\n</script>\n</main>';
    const outcome = await call(raw, { toolName: 'test' });
    expect(outcome.reducer).toBe('none');
    expect(outcome.reducer).not.toBe('html-extract');
    expect(outcome.truncated).toBe(true);
    expect(outcome.text).not.toContain('HIDDEN_SCRIPT_SENTINEL');
    trailerOf(outcome.text);
    expect(fsSync.readFileSync(outcome.spoolPath ?? '', 'utf8')).toBe(raw);
  });
});

/**
 * Batch 24r (r1 B1 of Batch 24b): the JSON reducer used to drop `null`
 * fields, so a reduced search answer lost `coverage.unrecognised: null` — the
 * only qualifier of an otherwise complete, current index.
 */
describe('applyToolResultBudget — status blocks survive reduction', () => {
  // Batch 22c: the block is written compact (`compactCoverage`), as the
  // dispatcher now writes it; the reducer keeps that form verbatim.
  it('a reduced search result still shows coverage.clean:false and every null field', async () => {
    const coverage = compactCoverage({
      supportedLanguages: ['typescript', 'javascript'],
      census: 'complete',
      state: 'current',
      analyzed: 2,
      unchecked: 0,
      failed: 0,
      unsupported: 0,
      unrecognised: null,
      nonSource: null,
      excluded: null,
      omittedByCap: 0,
    });
    const result = {
      index: {
        symbolCount: 300,
        indexAgeMs: null,
        reindexStarted: false,
        reindexInFlight: false,
      },
      coverage,
      bm25Only: false,
      hits: Array.from({ length: 300 }, (_, i) => ({
        subject: null,
        filePath: `/ws/src/deep/directory/module${i}/handlers.ts`,
        symbolName: `handleRequest${i}`,
        kind: 'function',
        text: `function handleRequest${i}(request: Request): Response {}`,
        score: 0.01,
      })),
    };

    const outcome = await call(JSON.stringify(result), {
      toolName: 'ptah_code_search_symbols',
    });

    expect(outcome.reduced || outcome.truncated).toBe(true);
    expectWithin(outcome.text);
    const body = JSON.parse(outcome.text.split('\n')[0]) as {
      coverage: Record<string, unknown>;
      index: Record<string, unknown>;
    };
    expect(Object.keys(body).slice(0, 2)).toEqual(['coverage', 'index']);
    expect(body.coverage).toEqual(coverage);
    expect(JSON.stringify(body.coverage)).toBe(
      '{"clean":false,"reasons":["unrecognised?"],"analyzed":2,"unrecognised":null,"nonSource":null,"excluded":null}',
    );
    expect(body.coverage['clean']).toBe(false);
    expect(body.coverage['reasons']).toEqual(['unrecognised?']);
    for (const key of ['unrecognised', 'nonSource', 'excluded']) {
      expect(body.coverage).toHaveProperty(key, null);
    }
    expect(body.index).toHaveProperty('indexAgeMs', null);
  });

  it('declares the preserved keys it hands to the reducer', () => {
    expect(PRESERVED_RESULT_KEYS).toEqual([
      'coverage',
      'status',
      'index',
      'parseStatus',
    ]);
  });
});
