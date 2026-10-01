import { PR_URL_MAX_LENGTH, parsePrUrl, type ParsedPrUrl } from './pr-url';

const CANONICAL = 'https://github.com/Hive-Academy/ptah-extension/pull/614';
const GITHUB_PR: ParsedPrUrl = {
  url: CANONICAL,
  repo: 'Hive-Academy/ptah-extension',
  number: 614,
};

describe('parsePrUrl', () => {
  describe('GitHub PR URLs canonicalize to one value', () => {
    it.each<[string, string]>([
      ['canonical', CANONICAL],
      ['trailing slash', `${CANONICAL}/`],
      ['/files sub-path', `${CANONICAL}/files`],
      ['/commits/<sha> sub-path', `${CANONICAL}/commits/abc123`],
      ['query', `${CANONICAL}?diff=split`],
      ['fragment', `${CANONICAL}#discussion_r1`],
      ['query and fragment after a sub-path', `${CANONICAL}/files?w=1#diff-1`],
      [
        'upper-case host',
        'https://GITHUB.COM/Hive-Academy/ptah-extension/pull/614',
      ],
      [
        'www host',
        'https://www.github.com/Hive-Academy/ptah-extension/pull/614',
      ],
      ['surrounding whitespace', `  ${CANONICAL}\n`],
      ['leading zeros in the number', `${CANONICAL.slice(0, -3)}0614`],
    ])('%s', (_label, input) => {
      expect(parsePrUrl(input)).toEqual(GITHUB_PR);
    });

    it('keeps owner and repo case as written', () => {
      expect(parsePrUrl('https://github.com/a-b/c.d_e/pull/7')).toEqual({
        url: 'https://github.com/a-b/c.d_e/pull/7',
        repo: 'a-b/c.d_e',
        number: 7,
      });
    });
  });

  describe('other https URLs are kept trimmed and unchanged', () => {
    it.each<[string, string, string]>([
      [
        'GitLab merge request',
        ' https://gitlab.com/group/proj/-/merge_requests/3?x=1 ',
        'https://gitlab.com/group/proj/-/merge_requests/3?x=1',
      ],
      [
        'GitHub issue (not a PR)',
        'https://github.com/o/r/issues/5',
        'https://github.com/o/r/issues/5',
      ],
      [
        'GitHub PR list',
        'https://github.com/o/r/pulls',
        'https://github.com/o/r/pulls',
      ],
      [
        'GitHub PR number 0',
        'https://github.com/o/r/pull/0',
        'https://github.com/o/r/pull/0',
      ],
      [
        'GitHub host with an explicit port',
        'https://github.com:8443/o/r/pull/1',
        'https://github.com:8443/o/r/pull/1',
      ],
      [
        'GitHub Enterprise host',
        'https://github.example.com/o/r/pull/9',
        'https://github.example.com/o/r/pull/9',
      ],
    ])('%s', (_label, input, url) => {
      expect(parsePrUrl(input)).toEqual({ url, repo: null, number: null });
    });
  });

  describe('non-string input returns null without throwing', () => {
    it.each<[string, unknown]>([
      ['undefined', undefined],
      ['null', null],
      ['a number', 42],
      ['an object', { url: 'https://github.com/o/r/pull/1' }],
    ])('%s', (_label, input) => {
      expect(() => parsePrUrl(input)).not.toThrow();
      expect(parsePrUrl(input)).toBeNull();
    });
  });

  describe('rejected URLs', () => {
    it.each<[string, string]>([
      ['empty', ''],
      ['whitespace only', '   '],
      ['http scheme', 'http://github.com/o/r/pull/1'],
      ['javascript scheme', 'javascript:alert(1)'],
      ['file scheme', 'file:///etc/passwd'],
      ['not a URL', 'github.com/o/r/pull/1'],
      ['credentials', 'https://user:token@github.com/o/r/pull/1'],
      ['user name only', 'https://user@example.com/pr/1'],
      ['too long', `https://example.com/${'a'.repeat(PR_URL_MAX_LENGTH)}`],
    ])('%s', (_label, input) => {
      expect(parsePrUrl(input)).toBeNull();
    });

    it('accepts exactly the maximum length', () => {
      const prefix = 'https://example.com/';
      const url = prefix + 'a'.repeat(PR_URL_MAX_LENGTH - prefix.length);
      expect(url).toHaveLength(PR_URL_MAX_LENGTH);
      expect(parsePrUrl(url)).toEqual({ url, repo: null, number: null });
    });
  });
});
