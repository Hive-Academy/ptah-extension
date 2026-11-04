import { parseFixtureManifest } from './fixture-manifest.schema';
import { runReplay } from './replay-runner';

describe('replay readiness', () => {
  it('refuses pending evidence before touching any replay port', async () => {
    const manifest = parseFixtureManifest(require('./fixture-manifest.json'));
    await expect(runReplay(manifest, {}, '/reference.json', {} as never)).rejects.toThrow('pending evidence');
  });
});
