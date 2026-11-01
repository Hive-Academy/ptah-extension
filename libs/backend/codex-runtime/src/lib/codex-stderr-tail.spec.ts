import { CodexStderrTail } from './codex-stderr-tail';

describe('CodexStderrTail', () => {
  it('redacts credentials across chunks before shortening the tail', () => {
    const tail = new CodexStderrTail();
    tail.append(Buffer.from('Authorization: Bear'));
    tail.append('er private-auth\nBearer private-bearer\nsk-private-key\n');
    tail.append(
      'api_key=private-api api-key="private quoted" token=private-token\n',
    );
    expect(tail.tail()).not.toMatch(/private/);
    expect(tail.tail()).toContain('[REDACTED]');
    expect(tail.tail(12)).not.toContain('private');
    expect(tail.tail(0)).toBe('');
  });

  it('redacts an unfinished quoted credential across reads', () => {
    const tail = new CodexStderrTail();
    tail.append('api_key="private value');
    expect(tail.tail()).not.toContain('private');
    expect(tail.tail()).not.toContain('value');
    tail.append(' continued"\nready');
    expect(tail.tail()).not.toContain('continued');
    expect(tail.tail()).toContain('ready');
  });

  it('drops oldest lines and bounds retained UTF-8 bytes', () => {
    const tail = new CodexStderrTail();
    tail.append('oldest\n');
    for (let i = 0; i < 75; i++) tail.append(`line-${i}\n`);
    expect(tail.tail()).not.toContain('oldest');
    expect(tail.tail()).not.toContain('line-0\n');
    expect(tail.tail()).toContain('line-74');
    expect(tail.tail().split('\n').length).toBeLessThanOrEqual(50);
    for (let i = 0; i < 50; i++) tail.append(`${'é'.repeat(150)}\n`);
    expect(Buffer.byteLength(tail.tail())).toBeLessThanOrEqual(8192);
    expect(Buffer.byteLength(tail.tail(31))).toBeLessThanOrEqual(31);
    expect(tail.tail()).not.toContain('\uFFFD');
  });

  it('discards an oversized line until newline without exposing a credential suffix', () => {
    const tail = new CodexStderrTail();
    tail.append('Authorization: ');
    tail.append('private'.repeat(2000));
    tail.append('private-suffix');
    expect(tail.tail()).not.toContain('private');
    tail.append('\nrecovered');
    expect(tail.tail()).toContain('recovered');
    expect(Buffer.byteLength(tail.tail())).toBeLessThanOrEqual(8192);
  });

  it('decodes fragmented UTF-8 Buffer chunks', () => {
    const tail = new CodexStderrTail();
    const bytes = Buffer.from('é');
    tail.append(bytes.subarray(0, 1));
    tail.append(bytes.subarray(1));
    expect(tail.tail()).toBe('é');
  });
});
