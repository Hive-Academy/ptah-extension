import 'reflect-metadata';
import { join, resolve } from 'path';
import { jest } from '@jest/globals';
import { createMockFileSystemProvider } from '@ptah-extension/platform-core/testing';
import { PHASE_CONFIGS } from '../types/multi-phase.types';
import { AnalysisStorageService } from './analysis-storage.service';
import { AnalysisClaudeMdLinker } from './analysis-claude-md-linker';
import { sha256Hex } from './analysis-fingerprint';

const ROOT = resolve('/ws/demo');
const ANALYSIS = join(ROOT, '.ptah', 'analysis');
const FILES = PHASE_CONFIGS.map(({ file }) => file);
const BEGIN = '<!-- ptah:analysis:begin -->';
const END = '<!-- ptah:analysis:end -->';

describe('AnalysisClaudeMdLinker', () => {
  const logger = { warn: jest.fn() };

  async function fixture() {
    const fs = createMockFileSystemProvider();
    const run = join(ANALYSIS, 'demo');
    await fs.createDirectory(run);
    for (const file of FILES) await fs.writeFile(join(run, file), '# phase\n');
    const manifest = {
      version: 4,
      lifecycle: 'completed',
      analyzedAt: '2026-11-01T00:00:00Z',
      phases: Object.fromEntries(PHASE_CONFIGS.map(({ id, file }) => [id, {
        file,
        status: 'completed',
        verification: { status: 'verified', outputSha256: sha256Hex('# phase\n') },
      }])),
    };
    const manifests = new Map([[run, manifest]]);
    const storage = {
      getAnalysisDir: () => ANALYSIS,
      loadManifest: async (dir: string) => manifests.get(dir) ?? null,
    } as unknown as AnalysisStorageService;
    return { fs, manifests, linker: new AnalysisClaudeMdLinker(storage, fs, logger as never) };
  }

  it('creates CLAUDE.md when absent', async () => {
    const { fs, linker } = await fixture();
    expect(await linker.link(ROOT)).toEqual({ written: true });
    const content = await fs.readFile(join(ROOT, 'CLAUDE.md'));
    expect(content).toContain(BEGIN);
    expect(content).toContain('@.ptah/analysis/demo/01-project-profile.md');
    expect(content).toContain(END);
  });

  it('appends to an unmarked file and preserves existing text', async () => {
    const { fs, linker } = await fixture();
    await fs.writeFile(join(ROOT, 'CLAUDE.md'), '# User notes\n');
    await linker.link(ROOT);
    expect(await fs.readFile(join(ROOT, 'CLAUDE.md'))).toMatch(
      /^# User notes\n\n<!-- ptah:analysis:begin -->/,
    );
  });

  it('links the latest completed valid slug when several runs exist', async () => {
    const { fs, manifests, linker } = await fixture();
    const newer = join(ANALYSIS, 'newer');
    await fs.createDirectory(newer);
    for (const file of FILES) await fs.writeFile(join(newer, file), '# phase\n');
    manifests.set(newer, {
      ...manifests.get(join(ANALYSIS, 'demo'))!,
      analyzedAt: '2026-11-02T00:00:00Z',
    });
    const reads = jest.spyOn(fs, 'readFileBytes');
    await linker.link(ROOT);
    const content = await fs.readFile(join(ROOT, 'CLAUDE.md'));
    expect(content).toContain('@.ptah/analysis/newer/01-project-profile.md');
    expect(content).not.toContain('@.ptah/analysis/demo/');
    expect(reads).toHaveBeenCalledTimes(FILES.length);
  });

  it('refuses a completed run whose slug cannot form a safe import', async () => {
    const { fs, manifests, linker } = await fixture();
    const old = manifests.get(join(ANALYSIS, 'demo'))!;
    manifests.delete(join(ANALYSIS, 'demo'));
    const unsafe = join(ANALYSIS, 'bad slug');
    await fs.createDirectory(unsafe);
    manifests.set(unsafe, old);
    expect(await linker.link(ROOT)).toMatchObject({ written: false, error: expect.stringContaining('slug') });
    expect(await fs.exists(join(ROOT, 'CLAUDE.md'))).toBe(false);
  });

  it('serializes simultaneous calls and writes the block once', async () => {
    const { fs, linker } = await fixture();
    const originalWrite = fs.writeFile.getMockImplementation()!;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let entered!: () => void;
    const firstWrite = new Promise<void>((resolve) => { entered = resolve; });
    let writes = 0;
    jest.spyOn(fs, 'writeFile').mockImplementation(async (path, content) => {
      if (path.endsWith('CLAUDE.md')) { writes++; entered(); await gate; }
      return originalWrite(path, content);
    });
    const first = linker.link(ROOT);
    const second = linker.link(ROOT);
    await firstWrite;
    release();
    expect(await Promise.all([first, second])).toEqual([{ written: true }, { written: false }]);
    expect(writes).toBe(1);
  });

  it('uses dominant LF when one stray CRLF exists', async () => {
    const { fs, linker } = await fixture();
    await fs.writeFile(join(ROOT, 'CLAUDE.md'), `one\r\ntwo\nthree\nfour\n`);
    await linker.link(ROOT);
    const content = await fs.readFile(join(ROOT, 'CLAUDE.md'));
    expect(content).toContain(`${BEGIN}\n@.ptah/analysis/demo/01-project-profile.md\n`);
  });

  it('reports an editor change during the read-modify-write cycle', async () => {
    const { fs, linker } = await fixture();
    const path = join(ROOT, 'CLAUDE.md');
    await fs.writeFile(path, '# original\n');
    const originalRead = fs.readFile.getMockImplementation()!;
    const originalWrite = fs.writeFile.getMockImplementation()!;
    let reads = 0;
    jest.spyOn(fs, 'readFile').mockImplementation(async (file) => {
      if (file === path && ++reads === 2) await originalWrite(path, '# editor save\n');
      return originalRead(file);
    });
    expect(await linker.link(ROOT)).toMatchObject({ written: false, error: expect.stringContaining('changed') });
    expect(await originalRead(path)).toBe('# editor save\n');
  });

  it('replaces only marker contents and retains CRLF outside bytes', async () => {
    const { fs, linker } = await fixture();
    const original = `before\r\n${BEGIN}\r\nold\r\n${END}\r\nafter\r\n`;
    await fs.writeFile(join(ROOT, 'CLAUDE.md'), original);
    await linker.link(ROOT);
    const content = await fs.readFile(join(ROOT, 'CLAUDE.md'));
    expect(content.slice(0, content.indexOf(BEGIN))).toBe('before\r\n');
    expect(content.slice(content.indexOf(END) + END.length)).toBe(
      '\r\nafter\r\n',
    );
    expect(content).toContain(`${BEGIN}\r\n@.ptah/analysis/demo/01-project-profile.md\r\n`);
    expect(content).not.toContain('old');
  });

  it.each([`${BEGIN}\n`, `${END}\n`, `${END}\n${BEGIN}\n`])('leaves malformed markers untouched', async (original) => {
    const { fs, linker } = await fixture();
    await fs.writeFile(join(ROOT, 'CLAUDE.md'), original);
    expect(await linker.link(ROOT)).toMatchObject({ written: false, error: expect.any(String) });
    expect(await fs.readFile(join(ROOT, 'CLAUDE.md'))).toBe(original);
  });

  it('reports a write error without throwing', async () => {
    const { fs, linker } = await fixture();
    jest.spyOn(fs, 'writeFile').mockRejectedValueOnce(new Error('read-only'));
    expect(await linker.link(ROOT)).toMatchObject({ written: false, error: 'read-only' });
    expect(logger.warn).toHaveBeenCalled();
  });
});
