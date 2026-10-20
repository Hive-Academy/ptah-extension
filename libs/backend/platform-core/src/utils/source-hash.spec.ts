import { createHash } from 'node:crypto';
import { formatSourceHash } from './source-hash';

describe('formatSourceHash', () => {
  it('hashes the exact clone body text', () => {
    const body = 'line one\r\nline two\n';
    expect(formatSourceHash(body)).toBe(
      `sha256:${createHash('sha256').update(body, 'utf8').digest('hex')}`,
    );
  });
});
