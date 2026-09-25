import { createHash } from 'node:crypto';
import {
  CAPABILITY_LITERAL_MAX_LENGTH,
  canonicalFilename,
  decodeCapabilityId,
  encodeCapabilityId,
  harnessPolicyFingerprint,
  isHarnessPassAcknowledged,
  parseCapabilityFilename,
  tomlKeySegment,
} from './capability-id-codec';
import {
  summarizeHarnessHealth,
  type HarnessHealth,
  type HarnessTargetHealth,
} from './harness-sync.types';

/** Node's SHA-256 is the oracle here only; the codec itself must not import it. */
function sha40(id: string): string {
  return createHash('sha256').update(id, 'utf8').digest('hex').slice(0, 40);
}

describe('capability filename codec (D2)', () => {
  it('maps the delta-review collision pair to two different files', () => {
    expect(canonicalFilename('mcp', 'x'.repeat(121))).toBe(
      'mcp__h_79072a47bfaa54e6057a9ee21e0dea64b9edbfd1.json',
    );
    expect(
      canonicalFilename('mcp', 'h_79072a47bfaa54e6057a9ee21e0dea64b9edbfd1'),
    ).toBe('mcp__l_h_79072a47bfaa54e6057a9ee21e0dea64b9edbfd1.json');
  });

  it('keeps [a-z0-9_-] and percent-encodes everything else in upper-case hex', () => {
    expect(encodeCapabilityId('github_mcp-2')).toBe('l_github_mcp-2');
    expect(encodeCapabilityId('my.server name%')).toBe(
      'l_my%2Eserver%20name%25',
    );
    expect(encodeCapabilityId('a/b\\c:d*e?f"g<h>i|j')).toBe(
      'l_a%2Fb%5Cc%3Ad%2Ae%3Ff%22g%3Ch%3Ei%7Cj',
    );
    expect(encodeCapabilityId('tab\there\u0000')).toBe('l_tab%09here%00');
    expect(encodeCapabilityId('café')).toBe('l_caf%C3%A9');
    expect(encodeCapabilityId('😀')).toBe('l_%F0%9F%98%80');
  });

  it('keeps a case pair apart on case-insensitive volumes', () => {
    const upper = canonicalFilename('mcp', 'Repo');
    const lower = canonicalFilename('mcp', 'repo');
    expect(upper).toBe('mcp__l_%52epo.json');
    expect(lower).toBe('mcp__l_repo.json');
    expect(upper.toLowerCase()).not.toBe(lower.toLowerCase());
  });

  it('hashes only once the literal form passes the limit', () => {
    const atLimit = 'y'.repeat(CAPABILITY_LITERAL_MAX_LENGTH);
    expect(encodeCapabilityId(atLimit)).toBe(`l_${atLimit}`);

    const over = 'y'.repeat(CAPABILITY_LITERAL_MAX_LENGTH + 1);
    expect(encodeCapabilityId(over)).toBe(`h_${sha40(over)}`);

    // 41 escaped bytes is 123 characters of pct, from a 41-character id.
    const escaped = '.'.repeat(41);
    expect(encodeCapabilityId(escaped)).toBe(`h_${sha40(escaped)}`);
  });

  it('hashes UTF-8 bytes with a digest identical to SHA-256 across block boundaries', () => {
    for (const id of [
      'z'.repeat(121),
      'Ü'.repeat(55),
      'Q'.repeat(64),
      'mixed é 😀 '.repeat(20),
      'k'.repeat(1000),
    ]) {
      expect(encodeCapabilityId(id)).toBe(`h_${sha40(id)}`);
    }
  });

  it('round-trips every literal id and returns null for hashed tokens', () => {
    for (const id of ['ptah', 'Repo', 'my.server', 'café', '😀 x', '', '%41']) {
      expect(decodeCapabilityId(encodeCapabilityId(id))).toBe(id);
    }
    expect(decodeCapabilityId(encodeCapabilityId('x'.repeat(121)))).toBeNull();
  });

  it('rejects tokens that are not the canonical encoding of any id', () => {
    expect(decodeCapabilityId('l_%61')).toBeNull(); // `a` must be literal
    expect(decodeCapabilityId('l_%2e')).toBeNull(); // lower-case hex
    expect(decodeCapabilityId('l_A')).toBeNull(); // raw upper case
    expect(decodeCapabilityId('l_%C3')).toBeNull(); // truncated UTF-8
    expect(decodeCapabilityId('l_%ED%A0%80')).toBeNull(); // encoded surrogate
    expect(decodeCapabilityId('l_%2')).toBeNull();
    expect(decodeCapabilityId(`l_${'y'.repeat(121)}`)).toBeNull(); // would be hashed
    expect(decodeCapabilityId('ptah')).toBeNull();
  });

  it('refuses a lone surrogate instead of sharing a file with U+FFFD', () => {
    expect(() => encodeCapabilityId('bad\ud800')).toThrow(TypeError);
    expect(() => encodeCapabilityId('\udc00')).toThrow(TypeError);
  });

  it('parses only names inside the item pattern', () => {
    expect(parseCapabilityFilename('mcp__l_github.json')).toEqual({
      kind: 'mcp',
      encoded: 'l_github',
    });
    expect(
      parseCapabilityFilename(
        'plugin__h_79072a47bfaa54e6057a9ee21e0dea64b9edbfd1.json',
      ),
    ).toEqual({
      kind: 'plugin',
      encoded: 'h_79072a47bfaa54e6057a9ee21e0dea64b9edbfd1',
    });
    for (const ignored of [
      'mcp__l_github.json.tmp',
      'mcp__l_github (conflicted copy).json',
      'agent__l_x.json',
      'mcp__x_github.json',
      'mcp__h_abc.json',
      'skill__l_a.b.json',
    ]) {
      expect(parseCapabilityFilename(ignored)).toBeNull();
    }
  });
});

describe('tomlKeySegment', () => {
  it('leaves bare keys bare', () => {
    expect(tomlKeySegment('github_mcp-2')).toBe('github_mcp-2');
  });

  it('quotes and escapes everything else', () => {
    expect(tomlKeySegment('my.server')).toBe('"my.server"');
    expect(tomlKeySegment('with space')).toBe('"with space"');
    expect(tomlKeySegment('')).toBe('""');
    expect(tomlKeySegment('a"b\\c')).toBe('"a\\"b\\\\c"');
    expect(tomlKeySegment('l\n\t\u0001\u007f')).toBe('"l\\n\\t\\u0001\\u007F"');
    expect(tomlKeySegment('café')).toBe('"café"');
  });
});

describe('harnessPolicyFingerprint (N4)', () => {
  const base = {
    entries: [
      { name: 'skill__l_a.json', content: '{"v":1,"value":"off"}' },
      { name: 'plugin__l_p.json', content: '{"v":1,"value":"on"}' },
    ],
    pluginConfig: {
      enabledPluginIds: ['ptah-core', 'ptah-angular'],
      disabledSkillIds: ['orchestration'],
      disabledPluginIds: [],
      lastUpdated: '2026-01-01T00:00:00.000Z',
    },
  };

  it('is stable under key, entry and list reordering, and ignores lastUpdated', () => {
    const reordered = {
      pluginConfig: {
        lastUpdated: '2026-09-25T00:00:00.000Z',
        disabledPluginIds: [],
        disabledSkillIds: ['orchestration', 'orchestration'],
        enabledPluginIds: ['ptah-angular', 'ptah-core'],
      },
      entries: [...base.entries].reverse(),
    };
    expect(harnessPolicyFingerprint(reordered)).toBe(
      harnessPolicyFingerprint(base),
    );
    expect(harnessPolicyFingerprint(base)).toMatch(/^[0-9a-f]{16}$/);
  });

  it('treats a missing list and an empty one alike', () => {
    expect(
      harnessPolicyFingerprint({
        entries: [],
        pluginConfig: { enabledPluginIds: [], disabledSkillIds: [] },
      }),
    ).toBe(harnessPolicyFingerprint({ entries: [], pluginConfig: null }));
  });

  it('changes when any policy value changes (a legacy CLI save included)', () => {
    const original = harnessPolicyFingerprint(base);
    expect(
      harnessPolicyFingerprint({
        ...base,
        pluginConfig: { ...base.pluginConfig, disabledSkillIds: [] },
      }),
    ).not.toBe(original);
    expect(
      harnessPolicyFingerprint({
        ...base,
        pluginConfig: { ...base.pluginConfig, enabledSkillIds: ['x'] },
      }),
    ).not.toBe(original);
    expect(
      harnessPolicyFingerprint({
        ...base,
        entries: [
          { name: 'skill__l_a.json', content: '{"v":1,"value":"on"}' },
          base.entries[1],
        ],
      }),
    ).not.toBe(original);
  });
});

describe('isHarnessPassAcknowledged', () => {
  const target = (
    overrides: Partial<HarnessTargetHealth> = {},
  ): HarnessTargetHealth => ({
    target: 'claude',
    detected: true,
    facets: {
      skills: 'supported',
      commands: 'supported',
      agents: 'supported',
      mcp: 'supported',
    },
    expected: 1,
    found: 1,
    missing: [],
    foreign: [],
    writeFailed: [],
    overwrittenLocalEdit: [],
    removed: [],
    durationMs: 1,
    ...overrides,
  });
  const health = (overrides: Partial<HarnessHealth> = {}): HarnessHealth => ({
    workspaceRoot: '/repo',
    generatedAt: '2026-09-25T00:00:00.000Z',
    mode: 'preflight',
    reason: 'test',
    sources: 'ok',
    targets: [target()],
    collisions: [],
    policyFingerprint: 'abc',
    ...overrides,
  });

  it('acknowledges a clean pass that stamped the same fingerprint', () => {
    expect(isHarnessPassAcknowledged(health(), 'abc')).toBe(true);
  });

  it('does not acknowledge a mismatch, a failed write, a non-ok source or no pass', () => {
    expect(isHarnessPassAcknowledged(health(), 'other')).toBe(false);
    expect(
      isHarnessPassAcknowledged(
        health({ policyFingerprint: undefined }),
        'abc',
      ),
    ).toBe(false);
    expect(
      isHarnessPassAcknowledged(
        health({
          targets: [
            target(),
            target({
              target: 'codex',
              writeFailed: [{ relPath: '.codex/x', reason: 'EBUSY' }],
            }),
          ],
        }),
        'abc',
      ),
    ).toBe(false);
    for (const sources of [
      'policy-unknown',
      'sources-missing',
      'pending-download',
    ] as const) {
      expect(isHarnessPassAcknowledged(health({ sources }), 'abc')).toBe(false);
    }
    expect(isHarnessPassAcknowledged(null, 'abc')).toBe(false);
    expect(isHarnessPassAcknowledged(undefined, 'abc')).toBe(false);
  });

  it('reduces a frozen (policy-unknown) pass to degraded', () => {
    const summary = summarizeHarnessHealth(
      health({ sources: 'policy-unknown' }),
    );
    expect(summary.level).toBe('degraded');
    expect(summary.label).toBe('Skill and plugin sync paused');
  });
});
