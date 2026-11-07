import { REDACTED, redactSecrets } from './log-redaction';

const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ';

describe('redactSecrets /auth path', () => {
  it('masks a 43-character /auth token and leaves a shorter segment', () => {
    const text = `listening http://localhost:51820/auth/${TOKEN}/workspace/%2Fws Bearer ${TOKEN}`;
    const redacted = redactSecrets(text);
    expect(redacted).not.toContain(TOKEN);
    expect(redacted).toContain(`/auth/${REDACTED}/workspace/%2Fws`);
    expect(redacted).toContain(`Bearer ${REDACTED}`);
  });

  it('does not mask an /auth segment that is not 43 characters', () => {
    const text = 'http://localhost:51820/auth/short/workspace/x';
    expect(redactSecrets(text)).toBe(text);
  });
});
