import { redactLogRecord, redactText } from './redact';

describe('log redaction', () => {
  it('masks token secrets, pairing codes and admin keys', () => {
    expect(redactText('ptw1.0123456789AB.secretvalue')).toBe(
      'ptw1.0123456789AB.***',
    );
    expect(redactText('code ABCD-EFGH')).toBe('code [REDACTED]');
    expect(
      redactLogRecord({
        pairingCode: 'ABCD-EFGH',
        adminKey: 'private',
        nested: { token: 'secret' },
      }),
    ).toEqual({
      pairingCode: '[REDACTED]',
      adminKey: '[REDACTED]',
      nested: { token: '[REDACTED]' },
    });
  });
});
