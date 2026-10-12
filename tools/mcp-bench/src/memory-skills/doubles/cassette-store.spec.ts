import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CassetteDuplicateError,
  CassetteEntry,
  CassetteStore,
} from './cassette-store';

function entry(key: string, response: unknown): CassetteEntry {
  return {
    key,
    method: 'extract',
    model: 'test-model',
    promptSha: '0'.repeat(64),
    response,
  };
}

describe('CassetteStore', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'mcp-bench-cassette-'));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function cassette(name: string): string {
    return join(dir, `${name}.jsonl`);
  }

  function recordInto(path: string): CassetteStore {
    return new CassetteStore({ path, mode: 'record' });
  }

  function replayFrom(path: string): CassetteStore {
    return new CassetteStore({ path, mode: 'replay' });
  }

  it('re-recording a key replaces the stale entry, so replay returns B', () => {
    const path = cassette('re-record');
    const key = 'key-k';
    const recorder = recordInto(path);

    recorder.record(entry(key, 'response A'));
    recorder.record(entry('key-other', 'untouched'));
    recorder.record(entry(key, 'response B'));

    const replayer = replayFrom(path);
    expect(replayer.lookup('extract', key).response).toBe('response B');
    expect(replayer.lookup('extract', 'key-other').response).toBe('untouched');
  });

  it('leaves no temp file behind after the atomic rewrite', () => {
    const path = cassette('temp-file');
    const recorder = recordInto(path);
    recorder.record(entry('key-k', 'response A'));
    recorder.record(entry('key-k', 'response B'));

    expect(existsSync(path)).toBe(true);
    expect(readdirSync(dir).filter((name) => name.endsWith('.tmp'))).toEqual(
      [],
    );
  });

  it('refuses to load a cassette with one key and two different responses', () => {
    const path = cassette('duplicate-conflict');
    writeFileSync(
      path,
      `${JSON.stringify(entry('key-k', 'response A'))}\n` +
        `${JSON.stringify(entry('key-k', 'response B'))}\n`,
      'utf8',
    );

    const replayer = replayFrom(path);
    expect(() => replayer.lookup('extract', 'key-k')).toThrow(
      CassetteDuplicateError,
    );
    expect(() => replayer.lookup('extract', 'key-k')).toThrow(
      /two entries with different responses/,
    );
  });

  it('loads a hand-made cassette whose duplicate key has identical responses', () => {
    const path = cassette('duplicate-identical');
    writeFileSync(
      path,
      `${JSON.stringify(entry('key-k', 'response A'))}\n` +
        `${JSON.stringify(entry('key-k', 'response A'))}\n`,
      'utf8',
    );

    expect(replayFrom(path).lookup('extract', 'key-k').response).toBe(
      'response A',
    );
  });
});
