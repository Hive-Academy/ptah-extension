import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scanScenarioPrivacy } from './privacy-scan';

const dir = join(__dirname, '../scenarios');

describe('scenario privacy', () => {
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.json'))) {
    it(`${file} contains only public synthetic data`, () => {
      expect(scanScenarioPrivacy(JSON.parse(readFileSync(join(dir, file), 'utf8')))).toEqual([]);
    });
  }

  it.each([
    ['email', 'alice@example.com'],
    ['unapproved invalid-domain email', 'other@example.invalid'],
    ['Linux home', '/home/alice/code'],
    ['macOS home', '/Users/alice/code'],
    ['Windows home', 'C:\\Users\\alice\\code'],
    ['absolute path', '/tmp/private/file'],
    ['URL', 'https://private.example.net/path'],
    ['non-HTTP URL', 'ftp://private.example.net/file'],
    ['hostname', 'private.example.net'],
    ['IPv4', '192.168.1.2'],
    ['IPv6', '2001:db8::1'],
    ['IPv6 loopback', '::1'],
    ['bearer', 'Bearer abcdefghijklmnop'],
    ['JWT', 'eyJhbGciOi.eyJzdWIiOi.sig12345'],
    ['OpenAI key', 'sk-1234567890abcdef'],
    ['GitHub key', 'ghp_1234567890abcdef'],
    ['AWS key', 'AKIA1234567890abcdef'],
    ['Slack key', 'xoxb-1234567890abcdef'],
    ['Stripe live key', 'sk_live_abcdefghijklmnopqr'],
    ['Stripe restricted key', 'rk_live_abcdefgh12345678'],
    ['prefixed password assignment', 'DB_PASSWORD=hunter2hunter2'],
    ['prefixed secret assignment', 'export AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG'],
    ['PEM', '-----BEGIN PRIVATE KEY-----'],
    ['base64', 'A'.repeat(205)],
    ['Claude tool id', 'toolu_01JYMVj5xzSaik91rixgtdk9'],
    ['pull request number', 'PR #868'],
    ['internal worktree', '.claude-worktrees/plugin-session-root'],
    ['internal task code', 'FIX_PLUGIN_SESSION_ROOT'],
  ])('detects %s', (_kind, value) => {
    expect(scanScenarioPrivacy({ value }).length).toBeGreaterThan(0);
  });

  it.each(['apiKey', 'token', 'secret', 'password', 'authorization', 'cookie'])('detects credential field %s', (key) => {
    expect(scanScenarioPrivacy({ [key]: 'redacted' }).some((finding) => finding.kind === 'credential field')).toBe(true);
  });

  it.each([
    'password=hunter2',
    'passwd: hunter2',
    'pwd=hunter2',
    'secret=hunter2',
    'token=hunter2',
    'API_KEY=abc123',
    'api-key: abc123',
    'access_key=abc123',
    'private-key: abc123',
    'client_secret=abc123',
    'auth: abc123',
    '"password":"hunter2"',
    'Authorization: Bearer x',
    'Authorization: Basic YWxhZGRpbjpvcGVuc2VzYW1l',
    'Basic YWxhZGRpbjpvcGVuc2VzYW1l',
  ])('detects credential text %s', (value) => {
    expect(scanScenarioPrivacy({ value }).length).toBeGreaterThan(0);
  });

  it.each([
    'password=***',
    'secret=<redacted>',
    'token=[REDACTED]',
    'API_KEY=${DEMO_KEY}',
    'auth=process.env.DEMO_AUTH',
  ])('allows placeholder credential text %s', (value) => {
    expect(scanScenarioPrivacy({ value })).toEqual([]);
  });

  it.each([
    'github_pat_1234567890abcdef',
    'gho_1234567890abcdef',
    'ghu_1234567890abcdef',
    'ghs_1234567890abcdef',
    'ghr_1234567890abcdef',
    'glpat-1234567890abcdef',
    'xoxa-1234567890abcdef',
    'xoxb-1234567890abcdef',
    'xoxp-1234567890abcdef',
    'xoxs-1234567890abcdef',
    'sk-ant-1234567890abcdef',
    'sk-proj-1234567890abcdef',
    'AIza1234567890abcdef',
    'npm_1234567890abcdef',
    'hf_1234567890abcdef',
    'AKIA1234567890abcdef',
    'ASIA1234567890abcdef',
  ])('detects token prefix %s', (value) => {
    expect(scanScenarioPrivacy({ value }).some((finding) => finding.kind === 'credential shape')).toBe(true);
  });

  it.each([
    { value: 'demo@example.invalid' },
    { AuthorEmail: 'demo@example.invalid' },
    { authorEmail: ['demo@example.invalid'] },
    { 'demo@example.invalid': true },
  ])('does not exempt the synthetic email outside authorEmail: %p', (value) => {
    expect(scanScenarioPrivacy(value).some((finding) => finding.kind === 'email')).toBe(true);
  });

  it.each([
    'C:/Users/alice/code',
    'C:\\Users\\alice\\code',
    '~/private/file',
    '/root/private/file',
    '/var/folders/aa/private',
    'x,/etc/passwd',
    '[/tmp/private]',
    '(/tmp/private)',
    'path=/tmp/private',
    '"/tmp/private"',
  ])('detects path %s', (value) => {
    expect(scanScenarioPrivacy({ value }).length).toBeGreaterThan(0);
  });

  it.each([
    'host.local',
    'corp.internal',
    'https://host.local/path',
    '//corp.internal/path',
    'user@corp.internal',
    'private.example.net',
    'x.me',
    'x.sh',
  ])('detects hostname in allowed context %s', (value) => {
    if (value === 'host.local' || value === 'corp.internal') {
      expect(scanScenarioPrivacy({ value })).toEqual([]);
    } else {
      expect(scanScenarioPrivacy({ value }).length).toBeGreaterThan(0);
    }
  });

  it.each([
    'ctx.co',
    'this.id',
    'foo.ts',
    'foo.js',
    'foo.json',
    'https://ptah.live/',
    'https://docs.ptah.live/help',
    'https://example.invalid/',
    'https://example.com/',
    'example.com',
    'example.invalid',
  ])('allows code identifier or approved host %s', (value) => {
    expect(scanScenarioPrivacy({ value })).toEqual([]);
  });

  it.each([
    [{ version: '1.2.3.4' }, false],
    [{ semver: '1.2.3.4' }, false],
    [{ value: 'v1.2.3.4' }, false],
    [{ value: 'v192.168.1.2' }, true],
    [{ version: '192.168.1.2' }, true],
    [{ host: '1.2.3.4' }, true],
    [{ version: 'https://1.2.3.4/' }, true],
    [{ value: '1.2.3.4' }, true],
  ])('handles IPv4 version and host context %p', (value, expected) => {
    expect(scanScenarioPrivacy(value).some((finding) => finding.kind === 'IP address')).toBe(expected);
  });

  it('scans object keys as well as values', () => {
    expect(scanScenarioPrivacy({ 'alice@example.com': true }).some((finding) => finding.kind === 'email')).toBe(true);
  });

  it('allows the synthetic workspace, approved host and explicit status booleans', () => {
    expect(scanScenarioPrivacy({ file: '/workspace/acme-app/src/main.ts', link: 'https://docs.ptah.live/help', hasApiKey: false, authorEmail: 'demo@example.invalid' })).toEqual([]);
  });
});
