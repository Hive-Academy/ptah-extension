import manifest from './fixture-manifest.json';
import { parseFixtureManifest, requireReadyFixture } from './fixture-manifest.schema';

describe('fixture manifest', () => {
  it('keeps 15 PRs and 108 explicit root slots pending', () => {
    const parsed = parseFixtureManifest(manifest);
    expect(parsed.prs).toHaveLength(15);
    expect(parsed.prs.reduce((total, pr) => total + pr.roots.length, 0)).toBe(108);
    expect(() => requireReadyFixture(parsed)).toThrow('pending evidence');
  });

  it('rejects a missing root slot', () => {
    const changed = structuredClone(manifest);
    changed.prs[0].roots.pop();
    expect(() => parseFixtureManifest(changed)).toThrow();
  });
});
