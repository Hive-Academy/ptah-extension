/**
 * The strict approval fingerprint (TASK_2026_701 P1 review findings A3, A4).
 *
 * Source-under-test: `lib/health/approval-fingerprint.ts`, over real temp
 * directories. The only double is a switch on `fs/promises` that makes a
 * chosen path unreadable or unlistable, because no portable permission trick
 * does that on Windows. Nothing reaches the real home directory.
 */

import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let unreadable: ((path: string) => boolean) | null = null;

jest.mock('fs/promises', () => {
  const actual = jest.requireActual('fs/promises');
  const refuse = (path: unknown): boolean =>
    typeof path === 'string' && unreadable?.(path) === true;
  const eacces = (path: string) =>
    Object.assign(new Error(`EACCES: permission denied, open '${path}'`), {
      code: 'EACCES',
    });
  return {
    ...actual,
    readFile: async (path: string, ...rest: unknown[]) => {
      if (refuse(path)) throw eacces(path);
      return actual.readFile(path, ...rest);
    },
    readdir: async (path: string, ...rest: unknown[]) => {
      if (refuse(path)) throw eacces(path);
      return actual.readdir(path, ...rest);
    },
  };
});

import { hashDir, hashFile } from '../hash/content-hash';
import { approvalFingerprint } from './approval-fingerprint';

describe('approvalFingerprint', () => {
  let root: string;
  let skill: string;

  beforeEach(() => {
    unreadable = null;
    root = mkdtempSync(join(tmpdir(), 'harness-approval-fp-'));
    skill = join(root, 'skill');
    mkdirSync(join(skill, 'refs'), { recursive: true });
    writeFileSync(join(skill, 'SKILL.md'), 'the body\n', 'utf-8');
    writeFileSync(join(skill, 'refs', 'notes.md'), 'notes\n', 'utf-8');
  });

  afterEach(() => {
    unreadable = null;
    rmSync(root, { recursive: true, force: true });
  });

  it('is stable for an untouched path', async () => {
    const first = await approvalFingerprint(skill);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(await approvalFingerprint(skill)).toBe(first);
  });

  it('is null for an absent path', async () => {
    expect(await approvalFingerprint(join(root, 'nope'))).toBeNull();
  });

  it('is null when an empty descendant directory cannot be listed (A3)', async () => {
    const empty = join(skill, 'empty');
    mkdirSync(empty);
    const syncBefore = await hashDir(skill);
    unreadable = (path) => path === empty;

    // The sync hash cannot see the difference; the consent proof must.
    expect(await hashDir(skill)).toBe(syncBefore);
    expect(await approvalFingerprint(skill)).toBeNull();
  });

  it('is null when a descendant file cannot be read, rather than a sentinel digest (A3)', async () => {
    const notes = join(skill, 'refs', 'notes.md');
    unreadable = (path) => path === notes;
    expect(await approvalFingerprint(skill)).toBeNull();
  });

  it('covers entries the sync hash ignores, because the move takes them too (A3)', async () => {
    const before = await approvalFingerprint(skill);
    const syncBefore = await hashDir(skill);
    mkdirSync(join(skill, '.history'));
    writeFileSync(join(skill, '.history', 'old.md'), 'only copy\n', 'utf-8');

    expect(await hashDir(skill)).toBe(syncBefore);
    expect(await approvalFingerprint(skill)).not.toBe(before);
  });

  it('changes when a file is deleted and recreated with identical bytes (A4)', async () => {
    const file = join(skill, 'SKILL.md');
    const before = await approvalFingerprint(skill);
    const contentBefore = await hashFile(file);
    unlinkSync(file);
    writeFileSync(file, 'the body\n', 'utf-8');

    expect(await hashFile(file)).toBe(contentBefore);
    expect(await approvalFingerprint(skill)).not.toBe(before);
  });

  it('changes when a single-file path is deleted and recreated with identical bytes (A4)', async () => {
    const command = join(root, 'run-it.md');
    writeFileSync(command, 'the command\n', 'utf-8');
    const before = await approvalFingerprint(command);
    unlinkSync(command);
    writeFileSync(command, 'the command\n', 'utf-8');

    expect(before).not.toBeNull();
    expect(await approvalFingerprint(command)).not.toBe(before);
  });
});
