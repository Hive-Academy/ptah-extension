/**
 * ToolOutputCapper (TASK_2026_597 A3): shape-preserving caps at
 * `compaction.toolOutputBudgetTokens`, Ptah MCP skipped, whole-file Read
 * outlined with a path trailer, fail-open.
 */

import 'reflect-metadata';

import { existsSync, promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  countTokensPiecewise,
  type CodeOutliner,
} from '@ptah-extension/tool-output-reducers';
import type { CompactionConfigProvider } from '../compaction-config-provider';
import { ToolOutputCapper } from './tool-output-capper';

const BUDGET_TOKENS = 120;
const BUDGET_CHARS = BUDGET_TOKENS * 4;

function bigLog(lines = 400): string {
  return Array.from(
    { length: lines },
    (_, i) =>
      `2026-10-04T10:00:${String(i % 60).padStart(2, '0')} INFO step ${i} finished ok`,
  ).join('\n');
}

function bigSource(functions = 60): string {
  const out: string[] = [];
  for (let i = 0; i < functions; i++) {
    out.push(`export function handler${i}(input: number): number {`);
    out.push(`  const doubled = input * 2 + ${i};`);
    out.push(`  const tripled = doubled * 3 - ${i};`);
    out.push(`  return tripled + doubled;`);
    out.push('}');
  }
  return out.join('\n');
}

function makeCapper(
  options: {
    outliner?: CodeOutliner;
    getConfig?: () => unknown;
  } = {},
): { capper: ToolOutputCapper; warn: jest.Mock; getConfig: jest.Mock } {
  const warn = jest.fn();
  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn,
    error: jest.fn(),
  } as unknown as Logger;
  const getConfig = jest.fn(
    options.getConfig ?? (() => ({ toolOutputBudgetTokens: BUDGET_TOKENS })),
  );
  const config = { getConfig } as unknown as CompactionConfigProvider;
  return {
    capper: new ToolOutputCapper(logger, config, options.outliner),
    warn,
    getConfig,
  };
}

function withinBudget(text: string): boolean {
  return (
    text.length <= BUDGET_CHARS && countTokensPiecewise(text) <= BUDGET_TOKENS
  );
}

let cwd: string;

beforeEach(async () => {
  cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'tool-output-capper-'));
});

afterEach(async () => {
  await fs.rm(cwd, { recursive: true, force: true });
});

async function spoolFiles(): Promise<string[]> {
  const dir = path.join(cwd, '.ptah', 'tmp', 'mcp-out');
  return existsSync(dir)
    ? (await fs.readdir(dir)).filter((name) => name !== '.gitignore')
    : [];
}

describe('ToolOutputCapper', () => {
  it('caps Bash stdout, keeps a small stderr and every other field', async () => {
    const { capper } = makeCapper();
    const response = {
      stdout: bigLog(),
      stderr: 'warning: one',
      interrupted: false,
      isImage: false,
    };
    const result = (await capper.cap(
      'Bash',
      { command: 'npm test' },
      response,
      cwd,
    )) as typeof response;

    expect(result).not.toBe(response);
    expect(result.stderr).toBe('warning: one');
    expect(result.interrupted).toBe(false);
    expect(result.isImage).toBe(false);
    expect(result.stdout).not.toBe(response.stdout);
    expect(result.stdout).toContain('full output:');
    expect(withinBudget(result.stdout + result.stderr)).toBe(true);
    const files = await spoolFiles();
    expect(files).toHaveLength(1);
    const spooled = await fs.readFile(
      path.join(cwd, '.ptah', 'tmp', 'mcp-out', files[0]),
      'utf8',
    );
    expect(spooled).toBe(response.stdout);
  });

  it('splits the budget between two oversized shell fields (PowerShell)', async () => {
    const { capper } = makeCapper();
    const response = { stdout: bigLog(), stderr: bigLog(300) };
    const result = (await capper.cap(
      'PowerShell',
      {},
      response,
      cwd,
    )) as typeof response;

    expect(result.stdout).toContain('full output:');
    expect(result.stderr).toContain('full output:');
    expect(withinBudget(result.stdout + result.stderr)).toBe(true);
  });

  it('caps Grep content and leaves other Grep fields', async () => {
    const { capper } = makeCapper();
    const response = {
      mode: 'content',
      numFiles: 3,
      filenames: ['a.ts'],
      content: Array.from(
        { length: 400 },
        (_, i) => `src/file${i % 7}.ts:${i}:const value${i} = compute(${i});`,
      ).join('\n'),
      numLines: 400,
    };
    const result = (await capper.cap(
      'Grep',
      { pattern: 'value' },
      response,
      cwd,
    )) as typeof response;

    expect(result.mode).toBe('content');
    expect(result.numFiles).toBe(3);
    expect(result.filenames).toEqual(['a.ts']);
    expect(result.numLines).toBe(400);
    expect(result.content).toContain('full output:');
    expect(withinBudget(result.content)).toBe(true);
  });

  it('outlines a whole-file Read with a path trailer and no spool when no outliner is bound', async () => {
    const { capper } = makeCapper();
    const filePath = path.join(cwd, 'src', 'big.ts');
    const content = bigSource();
    const response = {
      type: 'text',
      file: { filePath, content, numLines: 300, startLine: 1, totalLines: 300 },
    };
    const result = (await capper.cap(
      'Read',
      { file_path: filePath },
      response,
      cwd,
    )) as typeof response;

    expect(result.type).toBe('text');
    expect(result.file.filePath).toBe(filePath);
    // Outline lines only: the "\n\n[outline: ...]" trailer is not counted.
    const outlineBody = result.file.content.slice(
      0,
      result.file.content.lastIndexOf('\n\n[outline: '),
    );
    expect(result.file.numLines).toBe(outlineBody.split('\n').length);
    expect(result.file.numLines).toBe(
      result.file.content.split('\n').length - 2,
    );
    expect(result.file.numLines).toBeLessThan(300);
    expect(result.file.startLine).toBe(1);
    expect(result.file.totalLines).toBe(300);
    expect(result.file.content).toContain(filePath);
    expect(result.file.content).toContain('read with offset/limit');
    expect(result.file.content).toContain('not file line numbers');
    expect(result.file.content).toContain('[outline: ');
    expect(withinBudget(result.file.content)).toBe(true);
    expect(await spoolFiles()).toHaveLength(0);
  });

  it('does not count an outline terminal newline as a file line', async () => {
    type CapperInternals = {
      outlineWholeFile(
        content: string,
        filePath: string,
        budget: unknown,
      ): Promise<string>;
    };
    const { capper } = makeCapper();
    jest
      .spyOn(capper as unknown as CapperInternals, 'outlineWholeFile')
      .mockResolvedValue('first\nsecond\n\n\n[outline: /big.ts; read with offset/limit]');
    const filePath = path.join(cwd, 'big.ts');
    const response = {
      type: 'text',
      file: { filePath, content: bigSource(), numLines: 300 },
    };

    const result = (await capper.cap(
      'Read',
      { file_path: filePath },
      response,
      cwd,
    )) as typeof response;

    expect(result.file.numLines).toBe(2);
  });

  it('does not invent line metadata a whole-file Read response lacked', async () => {
    const { capper } = makeCapper();
    const filePath = path.join(cwd, 'src', 'big.ts');
    const response = { type: 'text', file: { filePath, content: bigSource() } };
    const result = (await capper.cap(
      'Read',
      { file_path: filePath },
      response,
      cwd,
    )) as { file: Record<string, unknown> };

    expect(result.file['content']).toContain('[outline: ');
    expect(Object.keys(result.file).sort()).toEqual(['content', 'filePath']);
  });

  it('passes a bound outliner the file extension for a whole-file Read', async () => {
    const outline = jest.fn(async (source: string, _language: string) => {
      const lines = source.split('\n');
      const omittable = [];
      for (let start = 0; start + 4 < lines.length; start += 5) {
        omittable.push({ startLine: start + 1, endLine: start + 3 });
      }
      return { omittable, focus: [] };
    });
    const { capper } = makeCapper({ outliner: { outline } });
    const filePath = path.join(cwd, 'big.ts');
    const response = { type: 'text', file: { filePath, content: bigSource() } };
    const result = (await capper.cap(
      'Read',
      { file_path: filePath },
      response,
      cwd,
    )) as typeof response;

    expect(outline).toHaveBeenCalled();
    expect(outline.mock.calls[0][1]).toBe('.ts');
    expect(result.file.content).toContain('read with offset/limit');
    expect(result.file.content).toContain('export function handler0');
    expect(withinBudget(result.file.content)).toBe(true);
  });

  it('gives a ranged Read the reduced form plus the spool path', async () => {
    const { capper } = makeCapper();
    const filePath = path.join(cwd, 'app.log');
    const response = { type: 'text', file: { filePath, content: bigLog() } };
    const result = (await capper.cap(
      'Read',
      { file_path: filePath, offset: 10, limit: 400 },
      response,
      cwd,
    )) as typeof response;

    expect(result.file.content).toContain('full output:');
    expect(result.file.content).not.toContain('read with offset/limit');
    expect(await spoolFiles()).toHaveLength(1);
  });

  it('caps the text blocks of a third-party MCP result and keeps other blocks', async () => {
    const { capper } = makeCapper();
    const image = { type: 'image', data: 'AAAA', mimeType: 'image/png' };
    const response = {
      content: [{ type: 'text', text: bigLog() }, image],
      isError: false,
    };
    const result = (await capper.cap(
      'mcp__github__search_code',
      {},
      response,
      cwd,
    )) as typeof response;

    expect(result.isError).toBe(false);
    expect(result.content).toHaveLength(2);
    expect(result.content[1]).toBe(image);
    const text = (result.content[0] as { type: string; text: string }).text;
    expect(result.content[0].type).toBe('text');
    expect(text).toContain('full output:');
    expect(withinBudget(text)).toBe(true);
  });

  it('caps a bare MCP content-block array', async () => {
    const { capper } = makeCapper();
    const response = [{ type: 'text', text: bigLog() }];
    const result = (await capper.cap(
      'mcp__other__tool',
      {},
      response,
      cwd,
    )) as typeof response;

    expect(Array.isArray(result)).toBe(true);
    expect(result[0].text).toContain('full output:');
  });

  it('skips Ptah MCP tools without reading the config', async () => {
    const { capper, getConfig } = makeCapper();
    const response = { content: [{ type: 'text', text: bigLog() }] };

    await expect(
      capper.cap('mcp__ptah__ptah_search_files', {}, response, cwd),
    ).resolves.toBe(response);
    expect(getConfig).not.toHaveBeenCalled();
  });

  it('leaves tools outside its scope untouched', async () => {
    const { capper } = makeCapper();
    const response = { stdout: bigLog() };

    await expect(capper.cap('Write', {}, response, cwd)).resolves.toBe(
      response,
    );
  });

  it('returns the same response when every field is under the budget', async () => {
    const { capper } = makeCapper();
    const bash = { stdout: 'ok', stderr: '' };
    const read = { type: 'text', file: { filePath: '/a.ts', content: 'x' } };

    await expect(capper.cap('Bash', {}, bash, cwd)).resolves.toBe(bash);
    await expect(
      capper.cap('Read', { file_path: '/a.ts' }, read, cwd),
    ).resolves.toBe(read);
    expect(await spoolFiles()).toHaveLength(0);
  });

  it('returns an unknown shape unchanged', async () => {
    const { capper } = makeCapper();
    const big = bigLog();
    const filesMode = { mode: 'files_with_matches', filenames: ['a', 'b'] };
    const noFile = { type: 'image', image: { base64: big } };
    const mcpObject = { result: big };

    await expect(capper.cap('Bash', {}, big, cwd)).resolves.toBe(big);
    await expect(capper.cap('Grep', {}, filesMode, cwd)).resolves.toBe(
      filesMode,
    );
    await expect(capper.cap('Read', {}, noFile, cwd)).resolves.toBe(noFile);
    await expect(capper.cap('mcp__x__y', {}, mcpObject, cwd)).resolves.toBe(
      mcpObject,
    );
  });

  it('fails open with one log line when capping throws', async () => {
    const { capper, warn } = makeCapper({
      getConfig: () => {
        throw new TypeError('secret /path/in/message');
      },
    });
    const response = { stdout: bigLog() };

    await expect(capper.cap('Bash', {}, response, cwd)).resolves.toBe(response);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0][0]);
    expect(line).toContain('Bash');
    expect(line).toContain('TypeError');
    expect(line).not.toContain('secret');
  });
});
