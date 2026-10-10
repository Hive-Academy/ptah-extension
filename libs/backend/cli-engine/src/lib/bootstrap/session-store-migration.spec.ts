import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { collectCliSessionSources } from './session-store-migration';

describe('collectCliSessionSources', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-cli-workspaces-'));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('reads every workspace-state.json read-only and skips folders without one', async () => {
    for (const [hash, sessions] of [
      ['aaa', [{ sessionId: 's1' }]],
      ['bbb', [{ sessionId: 's2' }]],
    ] as const) {
      fs.mkdirSync(path.join(root, hash));
      fs.writeFileSync(
        path.join(root, hash, 'workspace-state.json'),
        JSON.stringify({ 'ptah.sessionMetadata': sessions }),
      );
    }
    fs.mkdirSync(path.join(root, 'empty'));

    const sources = await collectCliSessionSources(root);

    expect(sources.map((s) => path.basename(s.sourcePath))).toEqual([
      'aaa',
      'bbb',
    ]);
    expect(sources[1].storage.get('ptah.sessionMetadata')).toEqual([
      { sessionId: 's2' },
    ]);
    await expect(sources[0].storage.update('x', 1)).rejects.toThrow(
      /read-only/,
    );
  });

  it('skips a corrupt file instead of failing the run', async () => {
    fs.mkdirSync(path.join(root, 'bad'));
    fs.writeFileSync(
      path.join(root, 'bad', 'workspace-state.json'),
      '{not json',
    );

    await expect(collectCliSessionSources(root)).resolves.toEqual([]);
  });

  it('returns nothing when the folder does not exist', async () => {
    await expect(
      collectCliSessionSources(path.join(root, 'missing')),
    ).resolves.toEqual([]);
  });
});
