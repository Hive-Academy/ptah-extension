/**
 * mcp-response-formatter — unit specs.
 *
 * The formatter converts raw tool result objects into MCP-facing Markdown
 * strings (via json2md). Tests focus on the contract-level guarantees the
 * rest of the MCP stack relies on:
 *
 *   1. Stringify shape — every exported formatter returns a non-empty string.
 *   2. Nested result serialization — diagnostics, worktrees, and search
 *      results render all key fields into the Markdown surface.
 *   3. Error response envelope — error-bearing results render an "Error"
 *      branch rather than the success branch.
 *   4. Defensive fallback — malformed inputs (null, non-arrays where arrays
 *      are expected) should not throw; they fall back to JSON serialization.
 *
 * Source-under-test:
 *   libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-handlers/mcp-response-formatter.ts
 */

import 'reflect-metadata';

import {
  formatWorkspaceAnalysis,
  formatSearchFiles,
  formatDiagnostics,
  formatLspReferences,
  formatTokenCount,
  formatAgentList,
  formatAgentSpawn,
  formatAgentStatus,
  formatAgentRead,
  formatWorktreeList,
  formatWorktreeAdd,
  formatJsonValidate,
  formatBrowserNavigate,
  formatBrowserClick,
  formatBrowserContent,
  formatBrowserStatus,
} from './mcp-response-formatter';
import type {
  BrowserNavigateResult,
  BrowserClickResult,
  BrowserContentResult,
  BrowserStatusResult,
} from '../types';
import type {
  SpawnAgentResult,
  AgentProcessInfo,
  AgentOutput,
  CliDetectionResult,
} from '@ptah-extension/shared';

// ---------------------------------------------------------------------------
// Workspace / search
// ---------------------------------------------------------------------------

describe('mcp-response-formatter › workspace & search', () => {
  it('formatWorkspaceAnalysis renders project type, root, frameworks and deps', () => {
    const out = formatWorkspaceAnalysis({
      info: {
        projectType: 'nx-monorepo',
        rootPath: '/repo',
        frameworks: [
          { name: 'NestJS', version: '11.0.0', category: 'backend' },
        ],
      },
      structure: { structure: { directories: [], files: [] } },
      projectInfo: {
        version: '1.2.3',
        description: 'Test workspace',
        gitRepository: true,
        totalFiles: 42,
        dependencies: ['nestjs', 'prisma'],
        devDependencies: ['jest'],
      },
    });

    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
    expect(out).toMatch(/Workspace Analysis/);
    expect(out).toMatch(/nx-monorepo/);
    expect(out).toMatch(/\/repo/);
    expect(out).toMatch(/NestJS 11\.0\.0/);
    expect(out).toMatch(/Test workspace/);
    expect(out).toMatch(/nestjs/);
    expect(out).toMatch(/jest/);
  });

  it('formatSearchFiles renders a numbered list with file count', () => {
    const out = formatSearchFiles(['src/a.ts', 'src/b.ts', 'src/c.ts']);
    expect(out).toMatch(/File Search/);
    expect(out).toMatch(/Found: 3 files/);
    expect(out).toMatch(/src\/a\.ts/);
    expect(out).toMatch(/src\/c\.ts/);
  });

  it('formatSearchFiles falls back to JSON when input is not an array', () => {
    const out = formatSearchFiles({ notAnArray: true });
    // Shouldn't throw, must still be a string, and should surface the raw shape.
    expect(typeof out).toBe('string');
    expect(out).toContain('notAnArray');
  });
});

// ---------------------------------------------------------------------------
// Diagnostics / LSP / tokens
// ---------------------------------------------------------------------------

describe('mcp-response-formatter › diagnostics, lsp & tokens', () => {
  it('formatDiagnostics groups errors and warnings with counts', () => {
    const out = formatDiagnostics([
      {
        file: 'a.ts',
        line: 1,
        col: 2,
        message: 'bad thing',
        severity: 'error',
        code: 'E1',
      },
      { file: 'b.ts', line: 5, message: 'maybe bad', severity: 'warning' },
    ]);

    expect(out).toMatch(/\*\*Errors:\*\* 1/);
    expect(out).toMatch(/\*\*Warnings:\*\* 1/);
    expect(out).toMatch(/a\.ts:1:2/);
    expect(out).toMatch(/bad thing/);
    expect(out).toMatch(/b\.ts:5/);
    expect(out).toMatch(/maybe bad/);
  });

  it('formatDiagnostics renders the empty state for zero issues', () => {
    const out = formatDiagnostics([]);
    expect(out).toMatch(/No issues found/);
  });

  it('formatLspReferences shows count and file:line:col entries', () => {
    const out = formatLspReferences([
      { file: 'src/foo.ts', line: 10, col: 4 },
      { file: 'src/bar.ts', line: 3, col: 0 },
    ]);
    expect(out).toMatch(/Found: 2 references/);
    expect(out).toMatch(/src\/foo\.ts:10:4/);
    expect(out).toMatch(/src\/bar\.ts:3/);
  });

  it('formatTokenCount renders file + token count', () => {
    const out = formatTokenCount({ file: 'src/big.ts', tokens: 12345 });
    expect(out).toMatch(/Token Count/);
    expect(out).toMatch(/src\/big\.ts/);
    expect(out).toMatch(/12345/);
  });
});

// ---------------------------------------------------------------------------
// Agent namespace
// ---------------------------------------------------------------------------

describe('mcp-response-formatter › agent namespace', () => {
  it('formatAgentList renders a table of detected agents', () => {
    const agents = [
      {
        cli: 'gemini',
        installed: true,
        supportsSteer: true,
      },
      {
        cli: 'codex',
        installed: false,
        supportsSteer: false,
      },
    ] as unknown as CliDetectionResult[];

    const out = formatAgentList(agents);
    expect(out).toMatch(/Available Agents/);
    expect(out).toMatch(/\*\*Total:\*\* 2/);
    expect(out).toMatch(/gemini/);
    expect(out).toMatch(/installed/);
    expect(out).toMatch(/not installed/);
  });

  it('formatAgentList renders helpful empty-state message for zero agents', () => {
    const out = formatAgentList([]);
    expect(out).toMatch(/No agents found/);
  });

  it('formatAgentSpawn includes model tier when provided', () => {
    const result = {
      agentId: 'agent-42',
      cli: 'gemini',
      status: 'running',
      startedAt: '2026-04-24T00:00:00Z',
      cliSessionId: 'sess-xyz',
    } as unknown as SpawnAgentResult;

    const out = formatAgentSpawn(result, { modelTier: 'opus' });
    expect(out).toMatch(/Agent Spawned/);
    expect(out).toMatch(/agent-42/);
    expect(out).toMatch(/gemini/);
    expect(out).toMatch(/Model Tier.*opus/);
    expect(out).toMatch(/sess-xyz/);
  });

  it('formatAgentStatus normalizes single-result input to an array', () => {
    const single = {
      agentId: 'agent-1',
      cli: 'codex',
      task: 'hello world',
      status: 'running',
      startedAt: '2026-04-24T01:02:03Z',
    } as unknown as AgentProcessInfo;

    const out = formatAgentStatus(single);
    expect(out).toMatch(/Agent Status/);
    expect(out).toMatch(/\*\*Total:\*\* 1/);
    expect(out).toMatch(/agent-1/);
    expect(out).toMatch(/codex/);
    expect(out).toMatch(/hello world/);
  });

  it('formatAgentRead emits stdout/stderr blocks or the no-output marker', () => {
    const withOutput: AgentOutput = {
      agentId: 'a1' as AgentOutput['agentId'],
      stdout: 'line1\nline2',
      stderr: 'oops',
      lineCount: 3,
      truncated: false,
    };
    const withoutOutput: AgentOutput = {
      agentId: 'a2' as AgentOutput['agentId'],
      stdout: '',
      stderr: '',
      lineCount: 0,
      truncated: false,
    };

    const outA = formatAgentRead(withOutput);
    expect(outA).toMatch(/Agent Output: a1/);
    expect(outA).toMatch(/stdout/);
    expect(outA).toMatch(/line1/);
    expect(outA).toMatch(/stderr/);
    expect(outA).toMatch(/oops/);

    const outB = formatAgentRead(withoutOutput);
    expect(outB).toMatch(/No output yet/);
  });
});

// ---------------------------------------------------------------------------
// Git worktree — nested result serialization + error envelope
// ---------------------------------------------------------------------------

describe('mcp-response-formatter › git worktree', () => {
  it('formatWorktreeList renders a table with branch + HEAD columns', () => {
    const out = formatWorktreeList({
      worktrees: [
        {
          path: '/repo',
          branch: 'main',
          head: 'abc1234',
          isMain: true,
          isBare: false,
        },
        {
          path: '/repo-feat',
          branch: 'feature/foo',
          head: 'def5678',
          isMain: false,
          isBare: false,
        },
      ],
    });

    expect(out).toMatch(/\*\*Total:\*\* 2/);
    expect(out).toMatch(/\/repo-feat/);
    expect(out).toMatch(/feature\/foo/);
    expect(out).toMatch(/abc1234/);
    expect(out).toMatch(/def5678/);
  });

  it('formatWorktreeList surfaces git errors as a dedicated error section', () => {
    const out = formatWorktreeList({
      worktrees: [],
      error: 'git is not installed',
    });
    expect(out).toMatch(/\*\*Error:\*\* git is not installed/);
    expect(out).toMatch(/Could not list worktrees/);
  });

  it('formatWorktreeAdd branches on success vs failure envelopes', () => {
    const ok = formatWorktreeAdd({
      success: true,
      worktreePath: '/repo-wt',
    });
    expect(ok).toMatch(/Worktree Created/);
    expect(ok).toMatch(/\/repo-wt/);

    const bad = formatWorktreeAdd({ success: false, error: 'ref exists' });
    expect(bad).toMatch(/Worktree Creation Failed/);
    expect(bad).toMatch(/ref exists/);
  });
});

// ---------------------------------------------------------------------------
// JSON validate — success vs errors envelope
// ---------------------------------------------------------------------------

describe('mcp-response-formatter › json validate', () => {
  it('formatJsonValidate renders success branch with repairs list', () => {
    const out = formatJsonValidate({
      success: true,
      file: 'config.json',
      repairs: ['stripped markdown fences', 'fixed trailing commas'],
      errors: [],
      fileOverwritten: true,
    });
    expect(out).toMatch(/JSON Validation Passed/);
    expect(out).toMatch(/config\.json/);
    expect(out).toMatch(/stripped markdown fences/);
    expect(out).toMatch(/File overwritten/);
  });

  it('formatJsonValidate renders failure branch with errors and recovery hint', () => {
    const out = formatJsonValidate({
      success: false,
      file: 'broken.json',
      repairs: [],
      errors: ['missing comma at line 3', 'unquoted key foo'],
      fileOverwritten: false,
    });
    expect(out).toMatch(/JSON Validation Failed/);
    expect(out).toMatch(/missing comma at line 3/);
    expect(out).toMatch(/unquoted key foo/);
    expect(out).toMatch(/Please fix these issues/);
  });
});

// ---------------------------------------------------------------------------
// Browser formatters — error envelope fidelity
// ---------------------------------------------------------------------------

describe('mcp-response-formatter › browser tools', () => {
  it('formatBrowserNavigate surfaces URL + title on success', () => {
    const result: BrowserNavigateResult = {
      success: true,
      url: 'https://example.com/',
      title: 'Example',
    };
    const out = formatBrowserNavigate(result);
    expect(out).toMatch(/Navigation Complete/);
    expect(out).toMatch(/https:\/\/example\.com/);
    expect(out).toMatch(/Example/);
  });

  it('formatBrowserNavigate emits a "Navigation Failed" block when an error is present', () => {
    const result: BrowserNavigateResult = {
      success: false,
      url: 'https://blocked.invalid/',
      title: '',
      error: 'URL is on security blocklist',
    };
    const out = formatBrowserNavigate(result);
    expect(out).toMatch(/Navigation Failed/);
    expect(out).toMatch(/URL is on security blocklist/);
  });

  it('formatBrowserClick branches on error vs success', () => {
    const ok: BrowserClickResult = { success: true };
    expect(formatBrowserClick(ok)).toMatch(/Click Successful/);

    const bad: BrowserClickResult = {
      success: false,
      error: 'selector not found',
    };
    const out = formatBrowserClick(bad);
    expect(out).toMatch(/Click Failed/);
    expect(out).toMatch(/selector not found/);
  });

  it('formatBrowserContent truncates text longer than 32KB with a marker', () => {
    const longText = 'a'.repeat(40 * 1024);
    const result: BrowserContentResult = {
      html: '<p>short</p>',
      text: longText,
    };
    const out = formatBrowserContent(result);
    expect(out).toMatch(/Page Content/);
    expect(out).toMatch(/\[\.\.\.truncated\]/);
    // HTML is short, shouldn't be truncated.
    expect(out).toMatch(/<p>short<\/p>/);
  });

  it('formatBrowserStatus reports disconnected state cleanly', () => {
    const result: BrowserStatusResult = { connected: false };
    const out = formatBrowserStatus(result);
    expect(out).toMatch(/Browser Status/);
    expect(out).toMatch(/\*\*Connected:\*\* No/);
    expect(out).toMatch(/No active browser session/);
  });

  it('formatBrowserStatus includes optional headless / viewport / recording fields when provided', () => {
    const result: BrowserStatusResult = {
      connected: true,
      url: 'https://x.test/',
      title: 'x',
      uptimeMs: 30000,
      autoCloseInMs: 120000,
      headless: true,
      viewport: { width: 1024, height: 768 },
      recording: false,
    };
    const out = formatBrowserStatus(result);
    expect(out).toMatch(/Headless/);
    expect(out).toMatch(/1024x768/);
    expect(out).toMatch(/Recording.*Inactive/);
  });
});
