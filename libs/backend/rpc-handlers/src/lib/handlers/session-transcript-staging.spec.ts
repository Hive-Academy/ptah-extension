import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  finalizeTranscripts,
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
