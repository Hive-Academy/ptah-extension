import { extractHttpsUrl, httpsUrlCandidates, parseHttpsUrl, LineSplitter, stripAnsi } from './cli-login-output';

describe('CLI login output', () => {
  it('keeps Kimi on the first URL, including when it is invalid or too long', () => {
    const long = `https://example.test/${'a'.repeat(2028)}`;
    expect(long).toHaveLength(2049);
    expect(extractHttpsUrl(`${long} https://valid.test/`)).toBeUndefined();
    expect(extractHttpsUrl('https://%/ https://valid.test/')).toBeUndefined();
    expect(extractHttpsUrl('https://first.test/ https://second.test/')).toBe('https://first.test/');
    expect(extractHttpsUrl('nothing here')).toBeUndefined();
  });

  it('returns all trimmed candidates in order for provider-specific validation', () => {
    expect(httpsUrlCandidates('see https://one.test/a). and https://two.test/b!'))
      .toEqual(['https://one.test/a', 'https://two.test/b']);
    expect(httpsUrlCandidates('nothing here')).toEqual([]);
    expect(parseHttpsUrl('https://two.test/b', 2048)).toBe('https://two.test/b');
    expect(parseHttpsUrl('https://two.test/b', 5)).toBeUndefined();
  });

  it('preserves ANSI stripping and bounded line splitting', () => {
    expect(stripAnsi('\u001b[31mhello\u001b[0m')).toBe('hello');
    const lines: string[] = [];
    const splitter = new LineSplitter(line => lines.push(line));
    splitter.push(Buffer.from('one'));
    splitter.push('\r\ntwo\n');
    expect(lines).toEqual(['one', 'two']);
  });
});
