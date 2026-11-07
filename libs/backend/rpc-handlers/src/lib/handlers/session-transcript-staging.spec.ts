import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  finalizeTranscripts,
  recoverStagedTranscripts,
  restoreTranscripts,
  STAGED_TRANSCRIPT_SUFFIX,
  stageTranscripts,
} from './session-transcript-staging';

describe('session transcript staging', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ptah-transcript-staging-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function transcript(name: string): string {
    const file = join(root, name);
    writeFileSync(file, `content of ${name}`);
    return file;
  }

  it('stages files and restores them unchanged', async () => {
    const a = transcript('agent-1.jsonl');
    const main = transcript('session.jsonl');

    const staged = await stageTranscripts([a, main]);

    expect(existsSync(a)).toBe(false);
    expect(existsSync(`${main}${STAGED_TRANSCRIPT_SUFFIX}`)).toBe(true);

    await restoreTranscripts(staged);

    expect(readFileSync(a, 'utf-8')).toBe('content of agent-1.jsonl');
    expect(readFileSync(main, 'utf-8')).toBe('content of session.jsonl');
  });

  it('skips a file that is already gone', async () => {
    const main = transcript('session.jsonl');

    const staged = await stageTranscripts([join(root, 'missing.jsonl'), main]);

    expect(staged).toEqual([{ original: main, staged: `${main}${STAGED_TRANSCRIPT_SUFFIX}` }]);
  });

  it('puts back the files already staged when a later rename fails', async () => {
    const a = transcript('agent-1.jsonl');
    const blocked = transcript('session.jsonl');
    // A directory at the staged path makes the rename of the second file fail.
    mkdirSync(`${blocked}${STAGED_TRANSCRIPT_SUFFIX}`);
    writeFileSync(join(`${blocked}${STAGED_TRANSCRIPT_SUFFIX}`, 'keep'), 'x');

    await expect(stageTranscripts([a, blocked])).rejects.toThrow();

    expect(readFileSync(a, 'utf-8')).toBe('content of agent-1.jsonl');
    expect(readFileSync(blocked, 'utf-8')).toBe('content of session.jsonl');
  });

  describe('recoverStagedTranscripts', () => {
    const ID = 'sess-1';
    const owns = (owner: string) => async (staged: string) =>
      readFileSync(staged, 'utf-8') === owner;

    it('puts back a half-undone delete: main, nested and owned flat files', async () => {
      // Finding 2 shape: the main file was never staged, a sub-agent file was.
      const main = transcript(`${ID}.jsonl`);
      const nestedDir = join(root, ID, 'subagents');
      mkdirSync(nestedDir, { recursive: true });
      const nested = join(nestedDir, 'agent-a.jsonl');
      writeFileSync(`${nested}${STAGED_TRANSCRIPT_SUFFIX}`, 'nested');
      const flat = join(root, 'agent-b.jsonl');
      writeFileSync(`${flat}${STAGED_TRANSCRIPT_SUFFIX}`, ID);
      const foreign = join(root, 'agent-c.jsonl');
      writeFileSync(`${foreign}${STAGED_TRANSCRIPT_SUFFIX}`, 'other-session');

      const restored = await recoverStagedTranscripts(root, ID, owns(ID));

      expect(restored.sort()).toEqual([flat, nested].sort());
      expect(readFileSync(main, 'utf-8')).toBe(`content of ${ID}.jsonl`);
      expect(readFileSync(nested, 'utf-8')).toBe('nested');
      expect(readFileSync(flat, 'utf-8')).toBe(ID);
      expect(existsSync(`${foreign}${STAGED_TRANSCRIPT_SUFFIX}`)).toBe(true);
      expect(existsSync(foreign)).toBe(false);
    });

    it('restores a staged main transcript after a failed restore or a crash', async () => {
      const main = join(root, `${ID}.jsonl`);
      writeFileSync(`${main}${STAGED_TRANSCRIPT_SUFFIX}`, 'main');

      expect(await recoverStagedTranscripts(root, ID, owns(ID))).toEqual([main]);
      expect(readFileSync(main, 'utf-8')).toBe('main');
    });

    it('never overwrites an original that exists again', async () => {
      const main = transcript(`${ID}.jsonl`);
      writeFileSync(`${main}${STAGED_TRANSCRIPT_SUFFIX}`, 'older');

      expect(await recoverStagedTranscripts(root, ID, owns(ID))).toEqual([]);
      expect(readFileSync(main, 'utf-8')).toBe(`content of ${ID}.jsonl`);
      expect(readFileSync(`${main}${STAGED_TRANSCRIPT_SUFFIX}`, 'utf-8')).toBe('older');
    });

    it('does nothing when the directory holds no staged files', async () => {
      transcript(`${ID}.jsonl`);

      expect(await recoverStagedTranscripts(root, ID, owns(ID))).toEqual([]);
    });
  });

  it('removes staged files and reports the ones it could not remove', async () => {
    const a = transcript('agent-1.jsonl');
    const staged = await stageTranscripts([a]);
    const notAFile = { original: join(root, 'dir'), staged: join(root, 'dir.staged') };
    mkdirSync(notAFile.staged);

    const leftovers = await finalizeTranscripts([...staged, notAFile]);

    expect(existsSync(`${a}${STAGED_TRANSCRIPT_SUFFIX}`)).toBe(false);
    expect(leftovers).toEqual([notAFile.staged]);
  });
});
