import {
  PR_URL_MAX_LENGTH,
  extractGhPrCreateUrl,
  parsePrUrl,
  type GhPrCreateToolUse,
  type ParsedPrUrl,
} from './pr-url';

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

describe('extractGhPrCreateUrl', () => {
  const CREATE = 'gh pr create --title "Fix" --body "Body"';
  const OUTPUT = `Creating pull request for feat/x into main\n\n${CANONICAL}\n`;

  function toolUse(
    overrides: Partial<GhPrCreateToolUse> = {},
  ): GhPrCreateToolUse {
    return {
      toolName: 'Bash',
      toolInput: { command: CREATE },
      toolOutput: OUTPUT,
      success: true,
      ...overrides,
    };
  }

  describe('captures the created PR', () => {
    it.each<[string, Partial<GhPrCreateToolUse>, string, 'open' | 'draft']>([
      ['string output', {}, CANONICAL, 'open'],
      [
        'object output (stringified)',
        { toolOutput: { stdout: OUTPUT, stderr: '', exit_code: 0 } },
        CANONICAL,
        'open',
      ],
      [
        '--draft',
        { toolInput: { command: `${CREATE} --draft` } },
        CANONICAL,
        'draft',
      ],
      [
        '--draft=true',
        { toolInput: { command: 'gh pr create --draft=true -f' } },
        CANONICAL,
        'draft',
      ],
      [
        '--draft=false',
        { toolInput: { command: 'gh pr create --draft=false -f' } },
        CANONICAL,
        'open',
      ],
      [
        '--draft=0',
        { toolInput: { command: 'gh pr create --fill --draft=0' } },
        CANONICAL,
        'open',
      ],
      [
        '-d (short flag) is not read as draft',
        { toolInput: { command: 'gh pr create -d --fill' } },
        CANONICAL,
        'open',
      ],
      [
        'multiple URLs: the first PR URL wins',
        {
          toolOutput: `${CANONICAL}\nhttps://github.com/o/r/pull/2\n`,
        },
        CANONICAL,
        'open',
      ],
      [
        'a non-PR GitHub URL before the PR URL is skipped',
        {
          toolOutput: `see https://github.com/o/r/issues/5\n${CANONICAL}`,
        },
        CANONICAL,
        'open',
      ],
      [
        'the command is part of a chain',
        { toolInput: { command: `git push -u origin feat/x && ${CREATE}` } },
        CANONICAL,
        'open',
      ],
      [
        'a non-canonical URL is canonicalized by parsePrUrl',
        {
          toolOutput:
            'https://www.GitHub.com/Hive-Academy/ptah-extension/pull/614',
        },
        CANONICAL,
        'open',
      ],
    ])('%s', (_label, overrides, url, state) => {
      expect(extractGhPrCreateUrl(toolUse(overrides))).toEqual({ url, state });
    });
  });

  describe('captures nothing', () => {
    it.each<[string, Partial<GhPrCreateToolUse>]>([
      ['failed exit', { success: false }],
      ['non-Bash tool', { toolName: 'Edit' }],
      [
        'gh pr view output',
        { toolInput: { command: 'gh pr view 614 --json url' } },
      ],
      [
        'a command that only mentions the words',
        { toolInput: { command: 'echo "run ghx pr create later"' } },
      ],
      ['no PR URL in the output', { toolOutput: 'pull request create failed' }],
      [
        'a GitHub issue URL only',
        { toolOutput: 'https://github.com/o/r/issues/5' },
      ],
      ['an http URL only', { toolOutput: 'http://github.com/o/r/pull/1' }],
      ['undefined output', { toolOutput: undefined }],
      ['null output', { toolOutput: null }],
      ['tool input without a command', { toolInput: { cmd: CREATE } }],
      ['tool input that is not an object', { toolInput: CREATE }],
      ['tool input null', { toolInput: null }],
    ])('%s', (_label, overrides) => {
      expect(extractGhPrCreateUrl(toolUse(overrides))).toBeNull();
    });

    it.each<[string, unknown]>([
      ['null', null],
      ['undefined', undefined],
      ['a string', 'gh pr create'],
      ['a number', 42],
    ])('returns null without throwing for a %s payload', (_label, payload) => {
      const call = () =>
        extractGhPrCreateUrl(payload as GhPrCreateToolUse | null | undefined);

      expect(call).not.toThrow();
      expect(call()).toBeNull();
    });

    it('does not throw on an output JSON cannot serialize', () => {
      const cyclic: Record<string, unknown> = { stdout: CANONICAL };
      cyclic['self'] = cyclic;

      expect(() =>
        extractGhPrCreateUrl(toolUse({ toolOutput: cyclic })),
      ).not.toThrow();
      expect(extractGhPrCreateUrl(toolUse({ toolOutput: cyclic }))).toBeNull();
    });
  });
});
