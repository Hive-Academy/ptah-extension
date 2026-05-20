import 'reflect-metadata';

import {
  formatLspDefinitions,
  formatDirtyFiles,
  formatAgentStop,
  formatAgentSteer,
  formatWebSearch,
  formatWorktreeRemove,
  formatBrowserScreenshot,
  formatBrowserEvaluate,
  formatBrowserType,
  formatBrowserNetwork,
  formatBrowserClose,
  formatBrowserRecordStart,
  formatBrowserRecordStop,
} from './mcp-response-formatter';
import type {
  BrowserScreenshotResult,
  BrowserEvaluateResult,
  BrowserTypeResult,
  BrowserNetworkResult,
  BrowserRecordStartResult,
  BrowserRecordStopResult,
} from '../types';
import type { AgentProcessInfo } from '@ptah-extension/shared';

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

describe('mcp-response-formatter › formatAgentSteer', () => {
  it('renders Yes when steered is true', () => {
    const out = formatAgentSteer({ agentId: 'a', steered: true });
    expect(out).toMatch(/Agent Steered/);
    expect(out).toMatch(/Steered:\*\* Yes/);
  });

  it('renders No when steered is false', () => {
    const out = formatAgentSteer({ agentId: 'a', steered: false });
    expect(out).toMatch(/Steered:\*\* No/);
  });
});

describe('mcp-response-formatter › formatWebSearch', () => {
  it('renders query, provider and results table', () => {
    const out = formatWebSearch({
      query: 'how to mock',
      summary: 'short answer',
      provider: 'tavily',
      durationMs: 1230,
      resultCount: 2,
      results: [
        { title: 'A', url: 'https://a', snippet: 's1' },
        { title: 'B', url: 'https://b', snippet: 's2' },
      ],
    });
    expect(out).toMatch(/Web Search Results/);
    expect(out).toMatch(/tavily/);
    expect(out).toMatch(/short answer/);
    expect(out).toMatch(/\[A\]\(https:\/\/a\)/);
    expect(out).toMatch(/1\.2s/);
  });

  it('omits summary and results sections when missing', () => {
    const out = formatWebSearch({
      query: 'q',
      summary: '',
      provider: 'serper',
      durationMs: 500,
      resultCount: 0,
      results: [],
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
  it('renders error branch', () => {
    const out = formatBrowserEvaluate({
      value: undefined,
      type: 'undefined',
      error: 'eval blew up',
    } as BrowserEvaluateResult);
    expect(out).toMatch(/JavaScript Evaluation Failed/);
    expect(out).toMatch(/eval blew up/);
  });

  it('renders object value as JSON code block', () => {
    const out = formatBrowserEvaluate({
      value: { a: 1 },
      type: 'object',
    } as BrowserEvaluateResult);
    expect(out).toMatch(/JavaScript Evaluation Result/);
    expect(out).toMatch(/"a": 1/);
  });

  it('renders short primitive value as inline paragraph', () => {
    const out = formatBrowserEvaluate({
      value: 42,
      type: 'number',
    } as BrowserEvaluateResult);
    expect(out).toMatch(/Value:\*\* 42/);
  });

  it('renders long primitive as code block', () => {
    const longStr = 'x'.repeat(150);
    const out = formatBrowserEvaluate({
      value: longStr,
      type: 'string',
    } as BrowserEvaluateResult);
    expect(out).toContain(longStr);
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
