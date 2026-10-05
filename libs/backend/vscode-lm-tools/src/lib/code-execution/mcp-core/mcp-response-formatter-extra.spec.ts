import 'reflect-metadata';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  formatLspDefinitions,
  formatDirtyFiles,
  formatAgentStop,
  formatAgentMessage,
  formatAgentReport,
  formatWebSearch,
  formatWorktreeRemove,
  formatBrowserScreenshot,
  formatBrowserEvaluate,
  formatBrowserType,
  formatBrowserNetwork,
  formatBrowserClose,
  formatBrowserRecordStart,
  formatBrowserRecordStop,
  formatSearchFiles,
  type EvaluateValueSpool,
} from './mcp-response-formatter';
import {
  applyToolResultBudget,
  DEFAULT_TOOL_RESULT_BUDGET_CHARS,
  getToolResultBudget,
  spoolToolText,
  type SpoolOutcome,
} from './tool-result-budget';
import {
  countTokens,
  type TextBudget,
} from '@ptah-extension/tool-output-reducers';
import type {
  BrowserScreenshotResult,
  BrowserEvaluateResult,
  BrowserTypeResult,
  BrowserNetworkResult,
  BrowserRecordStartResult,
  BrowserRecordStopResult,
} from '../types';
import type { AgentProcessInfo } from '@ptah-extension/shared';

// TASK_2026_559 Batch 11: a capped search printed "Found: N files" with no sign
// that more files matched.
describe('mcp-response-formatter › formatSearchFiles truncation notice', () => {
  const NOTICE = '(showing first 3; narrow the pattern or raise limit)';

  it('says more matched and how to get them when more files are available', () => {
    const out = formatSearchFiles(['a.ts', 'b.ts', 'c.ts'], true);
    expect(out).toContain(`Found: more than 3 files ${NOTICE}`);
    expect(out).toContain('c.ts');
  });

  it('puts the notice before the list, so a cut tail cannot drop it', () => {
    const files = Array.from({ length: 3 }, (_, i) => `f${i}.ts`);
    const out = formatSearchFiles(files, true);
    expect(out.indexOf(NOTICE)).toBeLessThan(out.indexOf('f0.ts'));
  });

  it('adds no notice when the result count equals the limit and nothing more matched', () => {
    const out = formatSearchFiles(['a.ts', 'b.ts', 'c.ts'], false);
    expect(out).toContain('Found: 3 files');
    expect(out).not.toContain('showing first');
    expect(out).not.toContain('more than');
  });

  it('adds no notice by default (under the limit)', () => {
    const out = formatSearchFiles(['a.ts']);
    expect(out).toContain('Found: 1 file');
    expect(out).not.toContain('showing first');
  });

  it('uses the singular for a single shown file', () => {
    const out = formatSearchFiles(['a.ts'], true);
    expect(out).toContain(
      'Found: more than 1 file (showing first 1; narrow the pattern or raise limit)',
    );
  });
});

describe('mcp-response-formatter › formatLspDefinitions', () => {
  it('falls back to JSON when defs is not an array', () => {
    const out = formatLspDefinitions({ notAnArray: true });
    expect(out).toContain('notAnArray');
  });

  it('renders empty state for zero definitions', () => {
    const out = formatLspDefinitions([]);
    expect(out).toMatch(/LSP Definitions/);
    expect(out).toMatch(/Found: 0 definitions/);
  });

  it('renders single definition (no plural suffix) with file, line and col', () => {
    const out = formatLspDefinitions([{ file: 'a.ts', line: 12, col: 4 }]);
    expect(out).toMatch(/Found: 1 definition\b/);
    expect(out).toMatch(/a\.ts:12:4/);
  });

  it('renders definition without column when col is missing', () => {
    const out = formatLspDefinitions([{ uri: 'b.ts', line: 7 }]);
    expect(out).toMatch(/b\.ts:7/);
    expect(out).not.toMatch(/b\.ts:7:/);
  });

  it('renders definition with only file when line is missing', () => {
    const out = formatLspDefinitions([{ path: 'c.ts' }]);
    expect(out).toMatch(/`c\.ts`/);
  });

  it('renders plural form for multiple definitions', () => {
    const out = formatLspDefinitions([
      { file: 'a.ts', line: 1, col: 1 },
      { file: 'b.ts', line: 2, col: 2 },
    ]);
    expect(out).toMatch(/Found: 2 definitions\b/);
  });
});

describe('mcp-response-formatter › formatDirtyFiles', () => {
  it('falls back when not an array', () => {
    const out = formatDirtyFiles({ stuff: 1 });
    expect(out).toContain('stuff');
  });

  it('renders empty state for zero files', () => {
    const out = formatDirtyFiles([]);
    expect(out).toMatch(/Dirty Files/);
    expect(out).toMatch(/Found: 0 unsaved files/);
  });

  it('accepts string entries and renders singular form', () => {
    const out = formatDirtyFiles(['a.ts']);
    expect(out).toMatch(/Found: 1 unsaved file\b/);
    expect(out).toMatch(/a\.ts/);
  });

  it('accepts object entries with path field and renders plural form', () => {
    const out = formatDirtyFiles([{ path: 'a.ts' }, { path: 'b.ts' }]);
    expect(out).toMatch(/Found: 2 unsaved files/);
    expect(out).toMatch(/a\.ts/);
    expect(out).toMatch(/b\.ts/);
  });
});

describe('mcp-response-formatter › formatAgentStop', () => {
  it('renders ptah-cli label when ptahCliName is present', () => {
    const result: AgentProcessInfo = {
      agentId: 'ag-1',
      cli: 'ptah-cli',
      ptahCliName: 'my-agent',
      status: 'stopped',
      task: 'do',
      startedAt: 'now',
      cliSessionId: 'sess-1',
      exitCode: 0,
    } as unknown as AgentProcessInfo;
    const out = formatAgentStop(result);
    expect(out).toMatch(/Agent Stopped/);
    expect(out).toMatch(/ptah-cli \(my-agent\)/);
    expect(out).toMatch(/sess-1/);
    expect(out).toMatch(/Exit Code:\*\* 0/);
  });

  it('renders raw cli label and N/A exit code when fields are absent', () => {
    const result = {
      agentId: 'ag-2',
      cli: 'codex',
      status: 'stopped',
      task: 't',
      startedAt: 'then',
    } as unknown as AgentProcessInfo;
    const out = formatAgentStop(result);
    expect(out).toMatch(/CLI:\*\* codex/);
    expect(out).toMatch(/Exit Code:\*\* N\/A/);
    expect(out).not.toMatch(/CLI Session ID/);
  });
});

describe('mcp-response-formatter › formatAgentMessage', () => {
  it('names the mode and the agent', () => {
    const out = formatAgentMessage({ agentId: 'a', mode: 'steer' });
    expect(out).toMatch(/Agent Message/);
    expect(out).toMatch(/Agent ID:\*\* a/);
    expect(out).toMatch(/Mode:\*\* steer/);
  });

  it('states that interrupt-resume discarded the interrupted turn (R-11)', () => {
    const out = formatAgentMessage({ agentId: 'a', mode: 'interrupt-resume' });
    expect(out).toMatch(/DISCARDED/);
  });

  it('renders unsupported as "nothing was delivered", with the detail', () => {
    const out = formatAgentMessage({
      agentId: 'a',
      mode: 'unsupported',
      detail: 'this agent offers no messaging mechanism',
    });
    expect(out).toMatch(/NOTHING was delivered/);
    expect(out).toMatch(/Detail:\*\* this agent offers no messaging mechanism/);
  });

  it('omits the detail line when there is no detail', () => {
    const out = formatAgentMessage({ agentId: 'a', mode: 'queue-next-turn' });
    expect(out).not.toMatch(/Detail:/);
  });
});

describe('mcp-response-formatter › formatAgentReport', () => {
  it('renders a delivery with its parent session', () => {
    const out = formatAgentReport({
      delivered: true,
      parentSessionId: 'sess-1',
    });
    expect(out).toMatch(/Report Delivered/);
    expect(out).toMatch(/Delivered:\*\* Yes/);
    expect(out).toMatch(/Parent Session:\*\* sess-1/);
  });

  it('renders a refusal as a refusal, with its reason', () => {
    const out = formatAgentReport({
      delivered: false,
      reason: 'unattributed-caller',
    });
    expect(out).toMatch(/Report NOT Delivered/);
    expect(out).toMatch(/Delivered:\*\* No/);
    expect(out).toMatch(/Reason:\*\* unattributed-caller/);
  });
});

describe('mcp-response-formatter › formatWebSearch', () => {
  it('renders query, providers, per-result sources and the results list', () => {
    const out = formatWebSearch({
      query: 'how to mock',
      summary: 'short answer',
      providers: ['tavily', 'serper'],
      status: 'ok',
      durationMs: 1230,
      resultCount: 2,
      results: [
        {
          title: 'A',
          url: 'https://a',
          snippet: 's1',
          sources: ['tavily', 'serper'],
        },
        { title: 'B', url: 'https://b', snippet: 's2', sources: ['serper'] },
      ],
      outcomes: [
        {
          provider: 'tavily',
          status: 'ok',
          durationMs: 900,
          resultCount: 1,
        },
        {
          provider: 'serper',
          status: 'ok',
          durationMs: 1100,
          resultCount: 2,
        },
      ],
    });
    expect(out).toMatch(/Web Search Results/);
    expect(out).toMatch(/\*\*Providers:\*\* tavily, serper/);
    expect(out).toMatch(/short answer/);
    expect(out).toMatch(/\[A\]\(https:\/\/a\)/);
    expect(out).toMatch(/sources: tavily, serper/);
    expect(out).toMatch(/1\.2s/);
  });

  it('renders the Provider status section even when every provider succeeded', () => {
    const out = formatWebSearch({
      query: 'q',
      summary: 'a',
      providers: ['tavily'],
      status: 'ok',
      durationMs: 500,
      resultCount: 0,
      results: [],
      outcomes: [
        { provider: 'tavily', status: 'ok', durationMs: 500, resultCount: 0 },
      ],
    });
    expect(out).toMatch(/Provider status/);
    expect(out).toMatch(/\*\*tavily\*\* — ok \(0 results, 0\.5s\)/);
  });

  it('names the reason and message of every failed provider', () => {
    const out = formatWebSearch({
      query: 'q',
      summary: 'a',
      providers: ['tavily', 'serper'],
      status: 'partial',
      durationMs: 500,
      resultCount: 1,
      results: [
        { title: 'A', url: 'https://a', snippet: 's1', sources: ['tavily'] },
      ],
      outcomes: [
        { provider: 'tavily', status: 'ok', durationMs: 400, resultCount: 1 },
        {
          provider: 'serper',
          status: 'failed',
          durationMs: 10,
          resultCount: 0,
          reason: 'missing-api-key',
          message: 'No API key configured for serper.',
        },
      ],
    });
    expect(out).toMatch(/\*\*Status:\*\* partial/);
    expect(out).toMatch(
      /\*\*serper\*\* — failed \(0 results, 0\.0s\) — missing-api-key: No API key configured for serper\./,
    );
  });

  // STYLE 5 regression — a failed outcome carries its timing and its result
  // count, not only the reason. The duration separates a slow timeout from an
  // instant refusal, which is what decides whether a retry is worth making.
  it('renders the duration and result count of a failed provider', () => {
    const out = formatWebSearch({
      query: 'q',
      summary: 'a',
      providers: ['tavily', 'serper'],
      status: 'partial',
      durationMs: 30500,
      resultCount: 0,
      results: [],
      outcomes: [
        {
          provider: 'tavily',
          status: 'failed',
          durationMs: 30000,
          resultCount: 0,
          reason: 'timeout',
          message: 'Search timed out after 30s',
        },
        {
          provider: 'serper',
          status: 'failed',
          durationMs: 20,
          resultCount: 0,
          reason: 'missing-api-key',
          message: 'No API key configured for serper.',
        },
      ],
    });
    expect(out).toMatch(/\*\*tavily\*\* — failed \(0 results, 30\.0s\)/);
    expect(out).toMatch(/\*\*serper\*\* — failed \(0 results, 0\.0s\)/);
    expect(out).toMatch(/timeout: Search timed out after 30s/);
  });

  it('falls back to provider-error and Unknown error when a failure omits them', () => {
    const out = formatWebSearch({
      query: 'q',
      summary: 'a',
      providers: ['exa'],
      status: 'partial',
      durationMs: 100,
      resultCount: 0,
      results: [],
      outcomes: [
        { provider: 'exa', status: 'failed', durationMs: 100, resultCount: 0 },
      ],
    });
    expect(out).toMatch(
      /\*\*exa\*\* — failed \(0 results, 0\.1s\) — provider-error: Unknown error/,
    );
  });

  it('omits summary and results sections when missing', () => {
    const out = formatWebSearch({
      query: 'q',
      summary: '',
      providers: ['serper'],
      status: 'ok',
      durationMs: 500,
      resultCount: 0,
      results: [],
      outcomes: [
        { provider: 'serper', status: 'ok', durationMs: 500, resultCount: 0 },
      ],
    });
    expect(out).toMatch(/Web Search Results/);
    expect(out).not.toMatch(/Summary/);
    expect(out).not.toMatch(/### Results/);
  });
});

describe('mcp-response-formatter › formatWorktreeRemove', () => {
  it('renders success branch', () => {
    const out = formatWorktreeRemove({ success: true });
    expect(out).toMatch(/Worktree Removed/);
    expect(out).toMatch(/Successfully removed/);
  });

  it('renders failure branch with error', () => {
    const out = formatWorktreeRemove({ success: false, error: 'locked' });
    expect(out).toMatch(/Worktree Removal Failed/);
    expect(out).toMatch(/locked/);
  });

  it('uses fallback error message when error is missing', () => {
    const out = formatWorktreeRemove({ success: false });
    expect(out).toMatch(/Unknown error/);
  });
});

describe('mcp-response-formatter › formatBrowserScreenshot', () => {
  it('renders error branch', () => {
    const out = formatBrowserScreenshot({
      data: '',
      format: 'png',
      error: 'no browser',
    } as BrowserScreenshotResult);
    expect(out).toMatch(/Screenshot Failed/);
    expect(out).toMatch(/no browser/);
  });

  it('renders success with file path', () => {
    const out = formatBrowserScreenshot({
      data: 'AAAA',
      format: 'png',
      filePath: '/tmp/s.png',
    } as BrowserScreenshotResult);
    expect(out).toMatch(/Screenshot Captured/);
    expect(out).toMatch(/\/tmp\/s\.png/);
    expect(out).toMatch(/Format:\*\* png/);
  });

  it('renders success without file path', () => {
    const out = formatBrowserScreenshot({
      data: 'AAAA',
      format: 'jpeg',
    } as BrowserScreenshotResult);
    expect(out).toMatch(/Screenshot Captured/);
    expect(out).not.toMatch(/Saved to/);
  });
});

describe('mcp-response-formatter › formatBrowserEvaluate', () => {
  const noSpool: EvaluateValueSpool = () => {
    throw new Error('spool must not be called for a result within the budget');
  };

  function evaluate(result: Partial<BrowserEvaluateResult>): Promise<string> {
    return formatBrowserEvaluate(
      result as BrowserEvaluateResult,
      getToolResultBudget('ptah_browser_evaluate'),
      noSpool,
    );
  }

  it('renders error branch', async () => {
    const out = await evaluate({
      value: undefined,
      type: 'undefined',
      error: 'eval blew up',
    });
    expect(out).toMatch(/JavaScript Evaluation Failed/);
    expect(out).toMatch(/eval blew up/);
  });

  it('renders object value as JSON code block', async () => {
    const out = await evaluate({ value: { a: 1 }, type: 'object' });
    expect(out).toMatch(/JavaScript Evaluation Result/);
    expect(out).toMatch(/"a": 1/);
  });

  it('renders short primitive value as inline paragraph', async () => {
    const out = await evaluate({ value: 42, type: 'number' });
    expect(out).toMatch(/Value:\*\* 42/);
  });

  it('renders long primitive as code block, whole, within the budget', async () => {
    const longStr = 'x'.repeat(150);
    const out = await evaluate({ value: longStr, type: 'string' });
    expect(out).toContain('```json\n' + longStr + '\n```');
    expect(out).not.toContain('[...truncated');
  });
});

// TASK_2026_559 Batch 18: the stringified value was unbounded, so `evaluate`
// bypassed the 32 KB cap of ptah_browser_content. Over the tool's result
// budget, the full value is now spooled (User Decision 7) and the value is
// cut so the whole answer, trailer included, fits the budget; the budget
// step then returns it unchanged, so the trailer stays visible.
describe('mcp-response-formatter › formatBrowserEvaluate budget cut', () => {
  const BUDGET = getToolResultBudget('ptah_browser_evaluate');
  const HINT = 'for page content use ptah_browser_content with a selector]';
  const SPOOL_PATH = '/spool/.ptah/tmp/mcp-out/18-1-abcd.txt';
  const LONE_HIGH_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/;

  /** A spool that records what it was given and reports `outcome`. */
  function fakeSpool(outcome: SpoolOutcome = { path: SPOOL_PATH }): {
    spool: EvaluateValueSpool;
    saved: string[];
  } {
    const saved: string[] = [];
    return {
      saved,
      spool: async (text) => {
        saved.push(text);
        return outcome;
      },
    };
  }

  function evaluate(
    value: unknown,
    type: string,
    spool: EvaluateValueSpool,
    budget: TextBudget = BUDGET,
  ): Promise<string> {
    return formatBrowserEvaluate(
      { value, type } as BrowserEvaluateResult,
      budget,
      spool,
    );
  }

  /** Independent oracle: the whole string, tokenized at once, and its length. */
  function expectWithin(text: string, budget: TextBudget = BUDGET): void {
    expect(text.length).toBeLessThanOrEqual(budget.chars);
    expect(countTokens(text)).toBeLessThanOrEqual(budget.tokens);
  }

  it('uses the default 8,000-char / 2,000-token budget', () => {
    expect(BUDGET).toEqual({
      chars: DEFAULT_TOOL_RESULT_BUDGET_CHARS,
      tokens: 2000,
    });
  });

  describe('at the budget boundary (a chars-bound budget)', () => {
    const WIDE: TextBudget = { chars: 400, tokens: 100_000 };

    async function overhead(): Promise<number> {
      const probe = 'x'.repeat(101);
      const { spool } = fakeSpool();
      return (await evaluate(probe, 'string', spool, WIDE)).length - 101;
    }

    it('keeps a value whose answer is exactly at the budget whole, unspooled', async () => {
      const value = 'x'.repeat(WIDE.chars - (await overhead()));
      const { spool, saved } = fakeSpool();
      const out = await evaluate(value, 'string', spool, WIDE);
      expect(out.length).toBe(WIDE.chars);
      expect(out).toContain('```json\n' + value + '\n```');
      expect(out).not.toContain('[...truncated');
      expect(saved).toEqual([]);
    });

    it('cuts a value one char over, spools it whole and stays within the budget', async () => {
      const value = 'x'.repeat(WIDE.chars - (await overhead())) + 'Z';
      const { spool, saved } = fakeSpool();
      const out = await evaluate(value, 'string', spool, WIDE);
      expect(saved).toEqual([value]);
      expect(out).not.toContain('Z');
      expectWithin(out, WIDE);
      const match =
        /\n\n\[\.\.\.truncated: (\d+) more chars; full value: (.+) — for page content use ptah_browser_content with a selector\]\n```\n$/.exec(
          out,
        );
      expect(match).not.toBeNull();
      expect(match?.[2]).toBe(SPOOL_PATH);
      // The dropped count is exact: the kept prefix plus the dropped chars.
      const kept =
        out.indexOf('\n\n[...truncated') - out.indexOf('```json\n') - 8;
      expect(kept + Number(match?.[1])).toBe(value.length);
      // Maximal cut: one more kept char would push the answer over.
      expect(out.length).toBeGreaterThan(WIDE.chars - 3);
    });

    it('never splits a surrogate pair, wherever the cut lands', async () => {
      const value = '\u{1F600}'.repeat(500);
      for (let chars = 300; chars < 312; chars++) {
        const budget: TextBudget = { chars, tokens: 100_000 };
        const { spool } = fakeSpool();
        const out = await evaluate(value, 'string', spool, budget);
        expectWithin(out, budget);
        expect(out).toContain(' more chars; full value: ');
        expect(out).not.toMatch(LONE_HIGH_SURROGATE);
        const dropped = Number(/truncated: (\d+) more/.exec(out)?.[1]);
        expect(dropped % 2).toBe(0);
      }
    });
  });

  it('cuts a 100 KB value: trailer and spool path present, raw tail absent', async () => {
    const value = 'a'.repeat(4000) + 'TAIL-MARKER' + 'b'.repeat(100 * 1024);
    const { spool, saved } = fakeSpool();
    const out = await evaluate(value, 'string', spool);
    expectWithin(out);
    expect(saved).toEqual([value]);
    expect(out).toContain(`; full value: ${SPOOL_PATH} — ${HINT}`);
    expect(out).not.toContain('TAIL-MARKER');
    // ('b' alone occurs in the trailer's "ptah_browser_content".)
    expect(out).not.toContain('bb');
  });

  it('says so in the trailer when the full value could not be saved', async () => {
    const { spool } = fakeSpool({ failure: 'EACCES' });
    const out = await evaluate('q'.repeat(50_000), 'string', spool);
    expectWithin(out);
    expect(out).toContain(`; full value could not be saved: EACCES — ${HINT}`);
  });

  it('cuts a JSON-looking string as text and spools the string itself', async () => {
    const value = JSON.stringify({ html: 'h'.repeat(20_000) });
    const { spool, saved } = fakeSpool();
    const out = await evaluate(value, 'string', spool);
    expectWithin(out);
    expect(out).toMatch(/\*\*Type:\*\* string/);
    expect(out).toContain('```json\n{"html":"hhh');
    expect(saved).toEqual([value]);
  });

  it('cuts a large object after pretty-printing it and spools the pretty JSON', async () => {
    const value = { rows: Array.from({ length: 2000 }, (_, i) => `row-${i}`) };
    const pretty = JSON.stringify(value, null, 2);
    const { spool, saved } = fakeSpool();
    const out = await evaluate(value, 'object', spool);
    expectWithin(out);
    expect(out).toMatch(/\*\*Type:\*\* object/);
    expect(out).toContain('```json\n{\n  "rows": [\n    "row-0",');
    expect(out).not.toContain('row-1999');
    expect(saved).toEqual([pretty]);
  });

  it('renders a small object, null, undefined and a circular value as before, unspooled', async () => {
    const { spool, saved } = fakeSpool();
    expect(await evaluate({ a: 1 }, 'object', spool)).toContain(
      '```json\n{\n  "a": 1\n}\n```',
    );
    expect(await evaluate(null, 'object', spool)).toContain(
      '```json\nnull\n```',
    );
    expect(await evaluate(undefined, 'undefined', spool)).toMatch(
      /\*\*Value:\*\* undefined/,
    );
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    expect(await evaluate(circular, 'object', spool)).toBe(
      '[Unable to serialize result]',
    );
    expect(saved).toEqual([]);
  });

  describe('with the real spool and the tool-result budget step', () => {
    let root: string;

    beforeEach(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-evaluate-cut-'));
    });

    afterEach(() => {
      fs.rmSync(root, { recursive: true, force: true });
    });

    it('spools the full value byte-for-byte and the budget step keeps the trailer visible', async () => {
      const value =
        'a'.repeat(3000) + 'TAIL-MARKER' + 'é\u{1F600}'.repeat(40_000);
      const formatted = await evaluate(value, 'string', (text) =>
        spoolToolText(text, root, 18),
      );
      const outcome = await applyToolResultBudget({
        text: formatted,
        toolName: 'ptah_browser_evaluate',
        requestId: 18,
        spoolRoot: root,
      });

      // The budget step returns the answer unchanged: no second cut, no
      // second spool, and the evaluate trailer is inline.
      expect(outcome.text).toBe(formatted);
      expect(outcome.truncated).toBe(false);
      expectWithin(outcome.text);
      expect(outcome.text).not.toContain('TAIL-MARKER');

      const dir = path.join(root, '.ptah', 'tmp', 'mcp-out');
      const files = fs.readdirSync(dir).filter((n) => n !== '.gitignore');
      expect(files).toHaveLength(1);
      const spoolFile = path.join(dir, files[0]);
      expect(
        fs.readFileSync(spoolFile).equals(Buffer.from(value, 'utf8')),
      ).toBe(true);
      expect(outcome.text).toContain(
        `[...truncated: ${value.length - (outcome.text.indexOf('\n\n[...truncated') - outcome.text.indexOf('```json\n') - 8)} more chars; full value: ${spoolFile} — ${HINT}`,
      );
    });
  });
});

describe('mcp-response-formatter › formatBrowserType', () => {
  it('renders error branch', () => {
    const out = formatBrowserType({
      success: false,
      error: 'no field',
    } as BrowserTypeResult);
    expect(out).toMatch(/Type Failed/);
    expect(out).toMatch(/no field/);
  });

  it('renders success branch', () => {
    const out = formatBrowserType({ success: true } as BrowserTypeResult);
    expect(out).toMatch(/Type Successful/);
  });
});

describe('mcp-response-formatter › formatBrowserNetwork', () => {
  it('renders error branch', () => {
    const out = formatBrowserNetwork({
      requests: [],
      error: 'cdp gone',
    } as BrowserNetworkResult);
    expect(out).toMatch(/Network Requests/);
    expect(out).toMatch(/cdp gone/);
  });

  it('renders empty state when no requests', () => {
    const out = formatBrowserNetwork({
      requests: [],
    } as BrowserNetworkResult);
    expect(out).toMatch(/No network requests captured/);
  });

  it('renders requests with size, truncating long URLs', () => {
    const longUrl = 'https://example.com/' + 'a'.repeat(200);
    const out = formatBrowserNetwork({
      requests: [
        {
          url: longUrl,
          method: 'GET',
          status: 200,
          type: 'XHR',
          size: 2048,
        },
        {
          url: 'https://short.example/x',
          method: 'POST',
          status: 500,
          type: 'Fetch',
        },
      ],
    } as BrowserNetworkResult);
    expect(out).toMatch(/Total:\*\* 2/);
    expect(out).toMatch(/2KB/);
    expect(out).toMatch(/\.\.\./);
  });
});

describe('mcp-response-formatter › formatBrowserClose', () => {
  it('renders error branch', () => {
    const out = formatBrowserClose({ success: false, error: 'stuck' });
    expect(out).toMatch(/Browser Close Failed/);
    expect(out).toMatch(/stuck/);
  });

  it('renders success branch', () => {
    const out = formatBrowserClose({ success: true });
    expect(out).toMatch(/Browser Session Closed/);
  });
});

describe('mcp-response-formatter › formatBrowserRecordStart', () => {
  it('renders error branch', () => {
    const out = formatBrowserRecordStart({
      success: false,
      error: 'cannot start',
    } as BrowserRecordStartResult);
    expect(out).toMatch(/Recording Start Failed/);
    expect(out).toMatch(/cannot start/);
  });

  it('renders success branch', () => {
    const out = formatBrowserRecordStart({
      success: true,
    } as BrowserRecordStartResult);
    expect(out).toMatch(/Recording Started/);
  });
});

describe('mcp-response-formatter › formatBrowserRecordStop', () => {
  it('renders error branch', () => {
    const out = formatBrowserRecordStop({
      filePath: '',
      frameCount: 0,
      durationMs: 0,
      fileSizeBytes: 0,
      truncated: false,
      error: 'no recording active',
    } as BrowserRecordStopResult);
    expect(out).toMatch(/Recording Stop Failed/);
    expect(out).toMatch(/no recording active/);
  });

  it('renders success without truncated warning', () => {
    const out = formatBrowserRecordStop({
      filePath: '/tmp/r.gif',
      frameCount: 12,
      durationMs: 3000,
      fileSizeBytes: 4096,
      truncated: false,
    } as BrowserRecordStopResult);
    expect(out).toMatch(/Recording Saved/);
    expect(out).toMatch(/\/tmp\/r\.gif/);
    expect(out).toMatch(/Frames:\*\* 12/);
    expect(out).toMatch(/Duration:\*\* 3s/);
    expect(out).toMatch(/Size:\*\* 4KB/);
    expect(out).not.toMatch(/Warning:/);
  });

  it('renders success with truncated warning', () => {
    const out = formatBrowserRecordStop({
      filePath: '/tmp/r.gif',
      frameCount: 12,
      durationMs: 3000,
      fileSizeBytes: 4096,
      truncated: true,
    } as BrowserRecordStopResult);
    expect(out).toMatch(/Recording Saved/);
    expect(out).toMatch(/Warning:/);
    expect(out).toMatch(/frame buffer/);
  });
});
