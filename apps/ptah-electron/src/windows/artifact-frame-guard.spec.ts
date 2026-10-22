import { isAllowedArtifactFrameUrl } from './artifact-frame-guard';

describe('isAllowedArtifactFrameUrl', () => {
  const artifact = 'ptah-artifact://123e4567-e89b-12d3-a456-426614174000/index.html';

  it('allows the exact artifact document', () => {
    expect(isAllowedArtifactFrameUrl(artifact)).toBe(true);
  });

  it.each([
    'https://unauthorized-attacker.example.com/x?leak=1',
    'file:///tmp/secrets',
    'about:blank',
    `${artifact}?leak=1`,
    'ptah-artifact://short/index.html',
    'ptah-artifact://123e4567-e89b-12d3-a456-426614174000/other.html',
  ])('blocks subframe navigation to %s', (target) => {
    expect(isAllowedArtifactFrameUrl(target)).toBe(false);
  });
});
