/**
 * Pins the MCP server identity rules moved from the Marketplace
 * (TASK_2026_533, C14): `normalizeServerKey` from `mcp-connector-rows.ts` and
 * `normalizeMcpServerUrl` from `connectors-surface.component.ts`.
 *
 * The cases carry over what the Marketplace specs relied on — a display name
 * (`Google Calendar`) meets its disk slug (`google-calendar`), and an OAuth
 * record URL that differs from the catalog only by a trailing slash still
 * matches — plus the edges the bodies already handled.
 */
import {
  normalizeMcpServerUrl,
  normalizeServerKey,
} from './mcp-server-identity';

describe('normalizeServerKey', () => {
  it('folds a display name to its slug', () => {
    expect(normalizeServerKey('Google Calendar')).toBe('google-calendar');
  });

  it('gives a display name and its disk slug the same key', () => {
    expect(normalizeServerKey('Google Calendar')).toBe(
      normalizeServerKey('google-calendar'),
    );
  });

  it('trims surrounding whitespace and folds case', () => {
    expect(normalizeServerKey('  Gmail  ')).toBe('gmail');
  });

  it('collapses every run of non-alphanumerics into one dash', () => {
    expect(normalizeServerKey('io.github.user/My__Server')).toBe(
      'io-github-user-my-server',
    );
  });

  it('strips leading and trailing dashes', () => {
    expect(normalizeServerKey('--ptah--')).toBe('ptah');
    expect(normalizeServerKey('(Canva)')).toBe('canva');
  });

  it('maps a name with no alphanumerics to the empty key', () => {
    expect(normalizeServerKey('')).toBe('');
    expect(normalizeServerKey(' -/- ')).toBe('');
  });

  it('keeps distinct servers distinct', () => {
    expect(normalizeServerKey('firecrawl')).not.toBe(
      normalizeServerKey('ptah'),
    );
  });

  // Pins the linear edge-trim that replaced `/^-+|-+$/g` (Sonar S8786).
  it('maps a long run of separators alone to the empty key', () => {
    expect(normalizeServerKey('-'.repeat(50_000))).toBe('');
    expect(normalizeServerKey('/'.repeat(50_000))).toBe('');
  });

  it('keeps one dash for a long inner run and strips long edge runs', () => {
    const run = '-'.repeat(50_000);
    expect(normalizeServerKey(`${run}a${run}b${run}`)).toBe('a-b');
    expect(normalizeServerKey(`a${run}x`)).toBe('a-x');
  });

  it('strips a trailing or leading separator on its own', () => {
    expect(normalizeServerKey('ptah-')).toBe('ptah');
    expect(normalizeServerKey('-ptah')).toBe('ptah');
    expect(normalizeServerKey('ptah.')).toBe('ptah');
    expect(normalizeServerKey('a')).toBe('a');
  });
});

describe('normalizeMcpServerUrl', () => {
  it('matches a URL that differs only by a trailing slash', () => {
    expect(normalizeMcpServerUrl('https://mcp.sentry.dev/mcp/')).toBe(
      normalizeMcpServerUrl('https://mcp.sentry.dev/mcp'),
    );
  });

  it('strips every trailing slash from the path', () => {
    expect(normalizeMcpServerUrl('https://mcp.sentry.dev/mcp///')).toBe(
      'https://mcp.sentry.dev/mcp',
    );
  });

  it('folds host case', () => {
    expect(normalizeMcpServerUrl('https://MCP.Sentry.DEV/mcp')).toBe(
      'https://mcp.sentry.dev/mcp',
    );
  });

  it('keeps path case, which a server may treat as significant', () => {
    expect(normalizeMcpServerUrl('https://example.com/MCP')).toBe(
      'https://example.com/MCP',
    );
  });

  it('keeps the port and the query string', () => {
    expect(normalizeMcpServerUrl('http://localhost:8080/mcp/?key=abc')).toBe(
      'http://localhost:8080/mcp?key=abc',
    );
  });

  it('drops the fragment', () => {
    expect(normalizeMcpServerUrl('https://example.com/mcp#section')).toBe(
      'https://example.com/mcp',
    );
  });

  it('reduces a bare origin to protocol and host', () => {
    expect(normalizeMcpServerUrl('https://example.com/')).toBe(
      'https://example.com',
    );
  });

  it('falls back to trimming for a string that is not a URL', () => {
    expect(normalizeMcpServerUrl('  not a url//  ')).toBe('not a url');
    expect(normalizeMcpServerUrl('')).toBe('');
  });

  // Pins the linear trailing-slash trim that replaced `/\/+$/` (Sonar S8786).
  it('keeps inner and leading slashes and strips only the trailing run', () => {
    expect(normalizeMcpServerUrl('https://example.com//a//b//')).toBe(
      'https://example.com//a//b',
    );
    expect(normalizeMcpServerUrl('//relative/path//')).toBe('//relative/path');
  });

  it('handles a long run of slashes that is not at the end', () => {
    const run = '/'.repeat(50_000);
    expect(normalizeMcpServerUrl(`https://example.com${run}mcp`)).toBe(
      `https://example.com${run}mcp`,
    );
    expect(normalizeMcpServerUrl(`not a url${run}x`)).toBe(`not a url${run}x`);
  });

  it('reduces a string of slashes alone to the empty string', () => {
    expect(normalizeMcpServerUrl('/')).toBe('');
    expect(normalizeMcpServerUrl('  ///  ')).toBe('');
  });

  it('keeps distinct servers on one host distinct', () => {
    expect(normalizeMcpServerUrl('https://example.com/a')).not.toBe(
      normalizeMcpServerUrl('https://example.com/b'),
    );
  });
});
