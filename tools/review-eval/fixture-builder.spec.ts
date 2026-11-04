import manifest from './fixture-manifest.json';
import { assertReferenceOutsideLane, buildFixture } from './fixture-builder';

it('validates and writes the fixture through injected IO', async () => {
  const writes: unknown[] = [];
  const result = await buildFixture({ readJson: async () => manifest, writeJson: async (_path, value) => { writes.push(value); } }, 'input', 'output');
  expect(result.expectedRoots).toBe(108);
  expect(writes).toHaveLength(1);
});

it('keeps reference data outside mounted lane roots', () => {
  expect(() => assertReferenceOutsideLane('/private/reference.json', ['/lane/src', '/lane/out'])).not.toThrow();
  expect(() => assertReferenceOutsideLane('/lane/out/reference.json', ['/lane/src', '/lane/out'])).toThrow();
});
