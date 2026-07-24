import { createHash } from 'crypto';
import { generatePkceChallenge } from './pkce';

describe('generatePkceChallenge', () => {
  it('produces a valid S256 challenge for the verifier', () => {
    const { codeVerifier, codeChallenge } = generatePkceChallenge();
    const expected = createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');
    expect(codeChallenge).toBe(expected);
  });

  it('produces base64url values with no padding or unsafe chars', () => {
    const { codeVerifier, codeChallenge, state } = generatePkceChallenge();
    expect(codeVerifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(codeChallenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(state).toMatch(/^[a-f0-9]+$/);
  });

  it('generates a fresh verifier and state on each call', () => {
    const a = generatePkceChallenge();
    const b = generatePkceChallenge();
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
    expect(a.state).not.toBe(b.state);
  });
});
