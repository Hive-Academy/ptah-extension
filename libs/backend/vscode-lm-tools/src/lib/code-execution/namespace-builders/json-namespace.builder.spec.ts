/**
 * Specs for buildJsonNamespace (TASK_2026_100 P1.B5).
 *
 * Covers the end-to-end validate() pipeline plus every exported pure repair
 * helper. Validate() integrates path resolution, IO, repair, parse, optional
 * schema validation and writeback — tests exercise each branch.
 */

import type {
  IFileSystemProvider,
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import {
  buildJsonNamespace,
  stripMarkdownFences,
  stripJsonComments,
  fixTrailingCommas,
  fixSingleQuotes,
  fixUnquotedKeys,
  balanceBrackets,
  extractJsonBody,
  type JsonNamespaceDependencies,
} from './json-namespace.builder';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface FsMock {
  exists: jest.Mock;
  readFile: jest.Mock;
  writeFile: jest.Mock;
}

interface WsMock {
  getWorkspaceRoot: jest.Mock;
}

function makeDeps(): {
  deps: JsonNamespaceDependencies;
  fs: FsMock;
  ws: WsMock;
} {
  const fs: FsMock = {
    exists: jest.fn().mockResolvedValue(true),
    readFile: jest.fn(),
    writeFile: jest.fn().mockResolvedValue(undefined),
  };
  const ws: WsMock = { getWorkspaceRoot: jest.fn().mockReturnValue('D:/ws') };
  const deps: JsonNamespaceDependencies = {
    fileSystemProvider: fs as unknown as IFileSystemProvider,
    workspaceProvider: ws as unknown as IWorkspaceProvider,
  };
  return { deps, fs, ws };
}

// ---------------------------------------------------------------------------
// validate — guard rails
// ---------------------------------------------------------------------------

describe('buildJsonNamespace — validate (guards)', () => {
  it('rejects empty file parameter', async () => {
    const { deps } = makeDeps();
    const r = await buildJsonNamespace(deps).validate({ file: '' });
    expect(r.success).toBe(false);
    expect(r.errors[0]).toMatch(/"file" parameter/);
  });

  it('rejects absolute paths', async () => {
    const { deps } = makeDeps();
    const r = await buildJsonNamespace(deps).validate({
      file: 'D:/outside/file.json',
    });
    expect(r.success).toBe(false);
    expect(r.errors[0]).toMatch(/Absolute paths are not allowed/);
  });

  it('reports File not found when exists() is false', async () => {
    const { deps, fs } = makeDeps();
    fs.exists.mockResolvedValueOnce(false);

    const r = await buildJsonNamespace(deps).validate({ file: 'a.json' });
    expect(r.success).toBe(false);
    expect(r.errors[0]).toMatch(/File not found/);
  });

  it('reports empty file error when content is whitespace', async () => {
    const { deps, fs } = makeDeps();
    fs.readFile.mockResolvedValueOnce('   \n  ');
    const r = await buildJsonNamespace(deps).validate({ file: 'a.json' });
    expect(r.success).toBe(false);
    expect(r.errors[0]).toMatch(/empty or contains only whitespace/);
  });

  it('returns error when workspace root is not resolved', async () => {
    const { deps, ws } = makeDeps();
    ws.getWorkspaceRoot.mockReturnValueOnce(undefined);
    const r = await buildJsonNamespace(deps).validate({ file: 'a.json' });
    expect(r.success).toBe(false);
    expect(r.errors[0]).toMatch(/No workspace folder/);
  });
});

// ---------------------------------------------------------------------------
// validate — successful repair + writeback
// ---------------------------------------------------------------------------

describe('buildJsonNamespace — validate (happy path)', () => {
  it('repairs trailing comma + unquoted key, writes cleaned JSON, lists repairs', async () => {
    const { deps, fs } = makeDeps();
    fs.readFile.mockResolvedValue('{ name: "x", }');

    const r = await buildJsonNamespace(deps).validate({ file: 'a.json' });

    expect(r.success).toBe(true);
    expect(r.fileOverwritten).toBe(true);
    expect(r.repairs.length).toBeGreaterThanOrEqual(2);

    const [, written] = fs.writeFile.mock.calls[0];
    expect(JSON.parse(written)).toEqual({ name: 'x' });
  });

  it('returns errors and does NOT write when JSON.parse still fails after repair', async () => {
    const { deps, fs } = makeDeps();
    fs.readFile.mockResolvedValue('not json at all { ');
    const r = await buildJsonNamespace(deps).validate({ file: 'a.json' });
    expect(r.success).toBe(false);
    expect(r.errors[0]).toMatch(/JSON parse failed/);
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it('applies optional schema validation and reports missing required keys', async () => {
    const { deps, fs } = makeDeps();
    fs.readFile.mockResolvedValue('{ "title": "hi" }');

    const r = await buildJsonNamespace(deps).validate({
      file: 'a.json',
      schema: { required: ['name'] },
    });
    expect(r.success).toBe(false);
    expect(r.errors[0]).toMatch(/Missing required key: 'name'/);
    expect(fs.writeFile).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('stripMarkdownFences', () => {
  it('strips fenced json blocks', () => {
    const out = stripMarkdownFences('```json\n{"a":1}\n```', []);
    expect(out).toBe('{"a":1}');
  });

  it('is a no-op when no fences are present', () => {
    expect(stripMarkdownFences('{"a":1}', [])).toBe('{"a":1}');
  });
});

describe('extractJsonBody', () => {
  it('extracts object body when surrounded by prose', () => {
    const repairs: string[] = [];
    expect(extractJsonBody('pre {"a":1} post', repairs)).toBe('{"a":1}');
    expect(repairs.length).toBeGreaterThan(0);
  });
});

describe('stripJsonComments', () => {
  it('removes // and /* */ comments but leaves strings intact', () => {
    const out = stripJsonComments('{"url":"https://x"} // end', []);
    expect(out).toContain('"url":"https://x"');
    expect(out).not.toContain('// end');
  });
});

describe('fixTrailingCommas', () => {
  it('removes comma before } and ]', () => {
    expect(fixTrailingCommas('{"a":1,}', [])).toBe('{"a":1}');
    expect(fixTrailingCommas('[1,2,]', [])).toBe('[1,2]');
  });
});

describe('fixSingleQuotes', () => {
  it('converts single-quoted values to double-quoted', () => {
    const out = fixSingleQuotes("{'a':'b'}", []);
    expect(out).toBe('{"a":"b"}');
  });
});

describe('fixUnquotedKeys', () => {
  it('quotes bare identifier keys', () => {
    expect(fixUnquotedKeys('{a:1}', [])).toBe('{"a":1}');
  });
});

describe('balanceBrackets', () => {
  it('appends missing closers in reverse order', () => {
    expect(balanceBrackets('{"a":[1,2', [])).toBe('{"a":[1,2]}');
  });

  it('is a no-op when already balanced', () => {
    expect(balanceBrackets('{"a":1}', [])).toBe('{"a":1}');
  });
});
