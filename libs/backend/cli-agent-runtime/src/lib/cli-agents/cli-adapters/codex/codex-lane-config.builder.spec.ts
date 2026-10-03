/**
 * Pins every `--config` entry a Codex lane turn receives: the keys, their
 * order, the TOML quoting of values and user server names, both variants,
 * numeric validation and the version warnings (TASK_2026_597, component 1).
 *
 * The user-server form (`mcp_servers={...}` before `mcp_servers.ptah.*`) is
 * load-bearing: codex-cli 0.155.1 splits an override KEY on every dot without
 * quoting, and a later `mcp_servers={...}` replaces earlier ptah overrides.
 * See the builder's header.
 */

import {
  buildCodexLaneConfig,
  CODEX_PTAH_TOOL_TIMEOUT_SEC,
  CODEX_RESUME_RESENDS_ROLE,
  CODEX_VERIFIED_VERSIONS,
  type CodexLaneConfigInput,
} from './codex-lane-config.builder';

function input(
  overrides: Partial<CodexLaneConfigInput> = {},
): CodexLaneConfigInput {
  return {
    variant: 'first-turn',
    autoCompactTokens: 120000,
    toolOutputTokenLimit: 2500,
    webSearch: true,
    reasoningEffort: 'medium',
    mcpPort: 51820,
    workingDirectory: 'D:\\projects\\app',
    agentId: 'agent-1',
    userMcpServerNames: ['github', 'my server'],
    developerInstructions: 'You are the backend developer.\nBe "precise".',
    codexVersion: '0.155.1',
    ...overrides,
  };
}

describe('constants', () => {
  it('ships the S1a values', () => {
    expect(CODEX_RESUME_RESENDS_ROLE).toBe(true);
    expect(CODEX_VERIFIED_VERSIONS).toEqual(['0.155', '0.160']);
    expect(CODEX_PTAH_TOOL_TIMEOUT_SEC).toBe(960);
  });
});

describe('buildCodexLaneConfig', () => {
  it('emits every key, in the documented order, with TOML-quoted values', () => {
    const { entries, warnings } = buildCodexLaneConfig(input());

    expect(entries).toEqual([
      'agents.enabled=false',
      'features.plugins=false',
      'features.apps=false',
      'skills.include_instructions=false',
      'model_auto_compact_token_limit=120000',
      'tool_output_token_limit=2500',
      'web_search="live"',
      'approval_policy="never"',
      'model_reasoning_effort="medium"',
      'mcp_servers={"github"={enabled=false},"my server"={enabled=false}}',
      'mcp_servers.ptah.url="http://localhost:51820/agent/agent-1/workspace/D%3A%5Cprojects%5Capp"',
      'mcp_servers.ptah.tool_timeout_sec=960',
      'developer_instructions="You are the backend developer.\\nBe \\"precise\\"."',
    ]);
    expect(warnings).toEqual([]);
  });

  it('never emits the dead defer flag, enabled_tools or agents.max_depth', () => {
    const joined = buildCodexLaneConfig(input()).entries.join('\n');
    expect(joined).not.toContain('tool_search_always_defer_mcp_tools');
    expect(joined).not.toContain('enabled_tools');
    expect(joined).not.toContain('max_depth');
  });

  it('writes web_search="disabled" when web search is off', () => {
    const { entries } = buildCodexLaneConfig(input({ webSearch: false }));
    expect(entries).toContain('web_search="disabled"');
    expect(entries).not.toContain('web_search="live"');
  });

  it('omits model_reasoning_effort when no effort is resolved', () => {
    for (const reasoningEffort of [undefined, '', '   ']) {
      const { entries } = buildCodexLaneConfig(input({ reasoningEffort }));
      expect(entries.some((e) => e.startsWith('model_reasoning_effort='))).toBe(
        false,
      );
    }
  });

  it('omits every mcp_servers.ptah key without a port, and for port 0', () => {
    for (const mcpPort of [undefined, 0]) {
      const { entries, warnings } = buildCodexLaneConfig(input({ mcpPort }));
      expect(entries.some((e) => e.startsWith('mcp_servers.ptah.'))).toBe(
        false,
      );
      expect(warnings).toEqual([]);
    }
  });

  it('keeps the prefix keys unconditional, port or not', () => {
    const { entries } = buildCodexLaneConfig(input({ mcpPort: undefined }));
    expect(entries.slice(0, 4)).toEqual([
      'agents.enabled=false',
      'features.plugins=false',
      'features.apps=false',
      'skills.include_instructions=false',
    ]);
  });

  it('rejects an invalid port with a warning instead of a bad URL', () => {
    const { entries, warnings } = buildCodexLaneConfig(
      input({ mcpPort: 70000 }),
    );
    expect(entries.some((e) => e.startsWith('mcp_servers.ptah.'))).toBe(false);
    expect(warnings).toEqual([expect.stringContaining('70000')]);
  });

  describe('user MCP servers', () => {
    it('emits one inline table before the ptah keys, names quoted, sorted and distinct', () => {
      const { entries } = buildCodexLaneConfig(
        input({ userMcpServerNames: ['zeta', 'a.b', 'zeta', '', 'quo"te'] }),
      );
      const servers = entries.indexOf(
        'mcp_servers={"a.b"={enabled=false},"quo\\"te"={enabled=false},"zeta"={enabled=false}}',
      );
      const ptahUrl = entries.findIndex((e) =>
        e.startsWith('mcp_servers.ptah.url='),
      );
      expect(servers).toBeGreaterThan(-1);
      expect(ptahUrl).toBe(servers + 1);
    });

    it('never disables ptah itself', () => {
      const { entries } = buildCodexLaneConfig(
        input({ userMcpServerNames: ['ptah', 'github'] }),
      );
      expect(entries).toContain('mcp_servers={"github"={enabled=false}}');
    });

    it('emits no user-server entry when there are none', () => {
      const { entries } = buildCodexLaneConfig(
        input({ userMcpServerNames: ['ptah'] }),
      );
      expect(entries.some((e) => e.startsWith('mcp_servers={'))).toBe(false);
    });

    it('never uses a quoted dotted key, which Codex would read literally', () => {
      const joined = buildCodexLaneConfig(input()).entries.join('\n');
      expect(joined).not.toMatch(/^mcp_servers\."/m);
    });
  });

  describe('variants', () => {
    it('resume carries developer_instructions while the constant is true', () => {
      const role =
        'developer_instructions="You are the backend developer.\\nBe \\"precise\\"."';
      const first = buildCodexLaneConfig(input());
      const resume = buildCodexLaneConfig(input({ variant: 'resume' }));
      expect(first.entries).toContain(role);
      expect(resume.entries).toContain(role);
      expect(resume.entries).toEqual(first.entries);
    });

    it('resume omits developer_instructions when resending is off', () => {
      const { entries } = buildCodexLaneConfig(
        input({ variant: 'resume', resendRoleOnResume: false }),
      );
      expect(entries.some((e) => e.startsWith('developer_instructions='))).toBe(
        false,
      );
      // The compaction limit is a per-thread budget and stays on resume.
      expect(entries).toContain('model_auto_compact_token_limit=120000');
    });

    it('first turn still carries the role when resending is off', () => {
      const { entries } = buildCodexLaneConfig(
        input({ resendRoleOnResume: false }),
      );
      expect(entries.some((e) => e.startsWith('developer_instructions='))).toBe(
        true,
      );
    });

    it('omits developer_instructions when there is no role', () => {
      for (const developerInstructions of [undefined, '']) {
        const { entries } = buildCodexLaneConfig(
          input({ developerInstructions }),
        );
        expect(
          entries.some((e) => e.startsWith('developer_instructions=')),
        ).toBe(false);
      }
    });
  });

  describe('numeric validation', () => {
    it('omits a key set to 0 without a warning', () => {
      const { entries, warnings } = buildCodexLaneConfig(
        input({ autoCompactTokens: 0, toolOutputTokenLimit: 0 }),
      );
      expect(
        entries.some((e) => e.startsWith('model_auto_compact_token_limit=')),
      ).toBe(false);
      expect(
        entries.some((e) => e.startsWith('tool_output_token_limit=')),
      ).toBe(false);
      expect(warnings).toEqual([]);
    });

    it('omits -0 like 0, without a warning', () => {
      const { entries, warnings } = buildCodexLaneConfig(
        input({ autoCompactTokens: -0 }),
      );
      expect(
        entries.some((e) => e.startsWith('model_auto_compact_token_limit=')),
      ).toBe(false);
      expect(warnings).toEqual([]);
    });

    it('emits the largest safe integer as plain digits', () => {
      const { entries, warnings } = buildCodexLaneConfig(
        input({ autoCompactTokens: Number.MAX_SAFE_INTEGER }),
      );
      expect(entries).toContain(
        'model_auto_compact_token_limit=9007199254740991',
      );
      expect(warnings).toEqual([]);
    });

    it.each([
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      // Integers to JS that are not safe: `1e21` renders `1e+21`, a float to
      // Codex, which rejects the whole config.
      1e21,
      Number.MAX_SAFE_INTEGER + 1,
    ])('omits %p with a warning naming the key', (bad) => {
      const { entries, warnings } = buildCodexLaneConfig(
        input({ autoCompactTokens: bad, toolOutputTokenLimit: bad }),
      );
      expect(
        entries.some((e) => e.startsWith('model_auto_compact_token_limit=')),
      ).toBe(false);
      expect(
        entries.some((e) => e.startsWith('tool_output_token_limit=')),
      ).toBe(false);
      expect(warnings).toEqual([
        expect.stringContaining('model_auto_compact_token_limit'),
        expect.stringContaining('tool_output_token_limit'),
      ]);
    });
  });

  describe('version warnings', () => {
    it.each(['0.155.1', '0.160.0', 'codex-cli 0.160.3'])(
      'is silent for verified %p',
      (codexVersion) => {
        expect(buildCodexLaneConfig(input({ codexVersion })).warnings).toEqual(
          [],
        );
      },
    );

    it('warns for a version outside the verified list, keys still emitted', () => {
      const { entries, warnings } = buildCodexLaneConfig(
        input({ codexVersion: '0.170.2' }),
      );
      expect(warnings).toEqual([
        expect.stringContaining('outside the verified versions'),
      ]);
      expect(entries).toEqual(buildCodexLaneConfig(input()).entries);
    });

    it('does not treat 0.15 as a prefix match for 0.155', () => {
      expect(
        buildCodexLaneConfig(input({ codexVersion: '0.15.9' })).warnings,
      ).toEqual([expect.stringContaining('outside the verified versions')]);
    });

    it.each([undefined, '', 'unknown'])(
      'warns when the version is unknown (%p)',
      (codexVersion) => {
        expect(buildCodexLaneConfig(input({ codexVersion })).warnings).toEqual([
          expect.stringContaining('Codex version unknown'),
        ]);
      },
    );
  });

  describe('TOML basic-string quoting', () => {
    function instructions(text: string): string | undefined {
      return buildCodexLaneConfig(
        input({ developerInstructions: text }),
      ).entries.find((e) => e.startsWith('developer_instructions='));
    }

    it('escapes quote, backslash and the short escapes', () => {
      expect(instructions('a"b\\c\td\re\bf\fg')).toBe(
        'developer_instructions="a\\"b\\\\c\\td\\re\\bf\\fg"',
      );
    });

    it('escapes DEL, C0/C1 controls and line separators as \\u', () => {
      expect(instructions('\u0001\u007f\u0085\u2028\u2029')).toBe(
        'developer_instructions="\\u0001\\u007F\\u0085\\u2028\\u2029"',
      );
    });

    it('keeps other Unicode raw and replaces a lone surrogate', () => {
      expect(instructions('é😀\ud800x')).toBe(
        'developer_instructions="é😀\\uFFFDx"',
      );
    });
  });

  describe('purity (R9.7)', () => {
    it('gives byte-equal output for repeated and interleaved calls', () => {
      const a = input();
      const b = input({
        variant: 'resume',
        webSearch: false,
        userMcpServerNames: ['other'],
        reasoningEffort: 'high',
        mcpPort: undefined,
      });
      const first = JSON.stringify(buildCodexLaneConfig(a));
      const fromB = JSON.stringify(buildCodexLaneConfig(b));
      // Interleave: a, b, a, b, ... Shared state between calls would make a
      // later `a` differ from the first one, or leak b's values into it.
      for (let i = 0; i < 5; i++) {
        expect(JSON.stringify(buildCodexLaneConfig(a))).toBe(first);
        expect(JSON.stringify(buildCodexLaneConfig(b))).toBe(fromB);
      }
      expect(first).not.toBe(fromB);
      expect(first).not.toContain('other');
    });

    it('does not depend on the order of user server names', () => {
      const one = buildCodexLaneConfig(
        input({ userMcpServerNames: ['b', 'a'] }),
      );
      const two = buildCodexLaneConfig(
        input({ userMcpServerNames: ['a', 'b'] }),
      );
      expect(one).toEqual(two);
    });

    it('does not mutate its input object', () => {
      const given = input({ userMcpServerNames: ['b', 'a', 'b', 'ptah'] });
      const snapshot = JSON.stringify(given);
      buildCodexLaneConfig(given);
      expect(JSON.stringify(given)).toBe(snapshot);
    });
  });
});

/**
 * A strict TOML 1.0 checker for exactly the value forms the builder emits:
 * booleans, decimal integers, basic strings and single-line inline tables
 * whose keys are bare or basic-string quoted. No TOML parser is a declared
 * dependency of this repository, so the spec carries its own. Anything outside
 * those forms throws: floats, raw control characters, bad escapes, surrogate
 * escapes, trailing commas and newlines. A passing round-trip therefore means
 * Codex's TOML value parser sees the same value.
 */
type TomlValue = boolean | number | string | { [key: string]: TomlValue };

const SHORT_ESCAPES: Record<string, string> = {
  b: '\b',
  t: '\t',
  n: '\n',
  f: '\f',
  r: '\r',
  '"': '"',
  '\\': '\\',
};

function parseTomlValue(source: string): TomlValue {
  let pos = 0;

  const fail = (why: string): never => {
    throw new Error(`${why} at ${pos} in ${JSON.stringify(source)}`);
  };
  const skipSpace = (): void => {
    while (source[pos] === ' ' || source[pos] === '\t') pos++;
  };

  const basicString = (): string => {
    pos++; // opening quote
    let out = '';
    for (;;) {
      if (pos >= source.length) fail('unterminated string');
      const char = source[pos];
      const code = source.charCodeAt(pos);
      if (char === '"') {
        pos++;
        return out;
      }
      if (char === '\\') {
        const escape = source[pos + 1] ?? '';
        if (escape in SHORT_ESCAPES) {
          out += SHORT_ESCAPES[escape];
          pos += 2;
          continue;
        }
        const width = escape === 'u' ? 4 : escape === 'U' ? 8 : 0;
        if (width === 0) fail('invalid escape');
        const hex = source.slice(pos + 2, pos + 2 + width);
        if (hex.length !== width || !/^[0-9A-Fa-f]+$/.test(hex)) {
          fail('invalid unicode escape');
        }
        const scalar = parseInt(hex, 16);
        if ((scalar >= 0xd800 && scalar <= 0xdfff) || scalar > 0x10ffff) {
          fail('escape is not a Unicode scalar value');
        }
        out += String.fromCodePoint(scalar);
        pos += 2 + width;
        continue;
      }
      if ((code < 0x20 && char !== '\t') || code === 0x7f) {
        fail('raw control character');
      }
      if (code >= 0xd800 && code <= 0xdfff) {
        const next = source.charCodeAt(pos + 1);
        const paired = code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff;
        if (!paired) fail('lone surrogate');
        out += source.slice(pos, pos + 2);
        pos += 2;
        continue;
      }
      out += char;
      pos++;
    }
  };

  const key = (): string => {
    if (source[pos] === '"') return basicString();
    const match = /^[A-Za-z0-9_-]+/.exec(source.slice(pos));
    if (match === null) return fail('expected a key');
    pos += match[0].length;
    return match[0];
  };

  const inlineTable = (): { [key: string]: TomlValue } => {
    pos++; // {
    const table: { [key: string]: TomlValue } = {};
    skipSpace();
    if (source[pos] === '}') {
      pos++;
      return table;
    }
    for (;;) {
      skipSpace();
      const name = key();
      if (Object.prototype.hasOwnProperty.call(table, name)) {
        fail('duplicate key');
      }
      skipSpace();
      if (source[pos] !== '=') fail('expected =');
      pos++;
      skipSpace();
      table[name] = value();
      skipSpace();
      if (source[pos] === ',') {
        pos++;
        continue;
      }
      if (source[pos] === '}') {
        pos++;
        return table;
      }
      fail('expected , or }');
    }
  };

  const value = (): TomlValue => {
    const rest = source.slice(pos);
    if (source[pos] === '"') return basicString();
    if (source[pos] === '{') return inlineTable();
    if (rest.startsWith('true')) {
      pos += 4;
      return true;
    }
    if (rest.startsWith('false')) {
      pos += 5;
      return false;
    }
    const integer = /^[+-]?(?:0|[1-9](?:_?[0-9])*)/.exec(rest);
    if (integer === null) return fail('unsupported value');
    pos += integer[0].length;
    if (/^[.eE0-9_]/.test(source.slice(pos))) fail('not a decimal integer');
    const parsed = Number(integer[0].replace(/_/g, ''));
    if (!Number.isSafeInteger(parsed)) fail('integer out of range');
    return parsed;
  };

  const result = value();
  if (pos !== source.length) fail('trailing characters');
  return result;
}

/**
 * Split each entry the way Codex does: the key path is everything left of the
 * first `=`, split naively on dots. Then parse the value as TOML and return a
 * map from key path to value.
 */
function parseEntries(entries: string[]): Map<string, TomlValue> {
  const parsed = new Map<string, TomlValue>();
  for (const entry of entries) {
    const eq = entry.indexOf('=');
    expect(eq).toBeGreaterThan(0);
    const keyPath = entry.slice(0, eq);
    // Codex does not honour quotes in the key path, so it must be bare.
    expect(keyPath).toMatch(/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/);
    expect(parsed.has(keyPath)).toBe(false);
    parsed.set(keyPath, parseTomlValue(entry.slice(eq + 1)));
  }
  return parsed;
}

describe('emitted values parse as TOML and round-trip', () => {
  it.each([
    '1e+21',
    '1.5',
    '9007199254740992',
    '"a\nb"',
    '"\u007f"',
    '"\\ud800"',
    '"\\q"',
    '"open',
    '{a=1,}',
    '{a=1,a=2}',
    '"\ud800"',
  ])('the checker rejects %p, as Codex would', (bad) => {
    expect(() => parseTomlValue(bad)).toThrow();
  });

  it('round-trips every key of the default configuration', () => {
    const parsed = parseEntries(buildCodexLaneConfig(input()).entries);
    expect(Object.fromEntries(parsed)).toEqual({
      'agents.enabled': false,
      'features.plugins': false,
      'features.apps': false,
      'skills.include_instructions': false,
      model_auto_compact_token_limit: 120000,
      tool_output_token_limit: 2500,
      web_search: 'live',
      approval_policy: 'never',
      model_reasoning_effort: 'medium',
      mcp_servers: {
        github: { enabled: false },
        'my server': { enabled: false },
      },
      'mcp_servers.ptah.url':
        'http://localhost:51820/agent/agent-1/workspace/D%3A%5Cprojects%5Capp',
      'mcp_servers.ptah.tool_timeout_sec': 960,
      developer_instructions: 'You are the backend developer.\nBe "precise".',
    });
  });

  it.each(['minimal', 'low', 'medium', 'high', 'xhigh'])(
    'round-trips effort %p, disabled web search and the largest count',
    (reasoningEffort) => {
      const parsed = parseEntries(
        buildCodexLaneConfig(
          input({
            reasoningEffort,
            webSearch: false,
            toolOutputTokenLimit: Number.MAX_SAFE_INTEGER,
          }),
        ).entries,
      );
      expect(parsed.get('model_reasoning_effort')).toBe(reasoningEffort);
      expect(parsed.get('web_search')).toBe('disabled');
      expect(parsed.get('tool_output_token_limit')).toBe(
        Number.MAX_SAFE_INTEGER,
      );
    },
  );

  it('round-trips every escape class in developer_instructions', () => {
    const text =
      'quote " backslash \\ tab \t nl \n cr \r bs \b ff \f ' +
      'c0 \u0001\u001f del \u007f c1 \u0080\u0085\u009f ' +
      'ls   ps   latin é astral 😀 end';
    const parsed = parseEntries(
      buildCodexLaneConfig(input({ developerInstructions: text })).entries,
    );
    expect(parsed.get('developer_instructions')).toBe(text);
  });

  it('round-trips a lone surrogate as U+FFFD', () => {
    const parsed = parseEntries(
      buildCodexLaneConfig(input({ developerInstructions: 'a\ud800b\udc00c' }))
        .entries,
    );
    expect(parsed.get('developer_instructions')).toBe('a�b�c');
  });

  it('round-trips odd server names through the inline mcp_servers table', () => {
    const odd = [
      'a.b',
      'quo"te',
      'back\\slash',
      'tab\tname',
      "single'q",
      'é',
      'x y',
      '[bracket]',
      'eq=name',
    ];
    const parsed = parseEntries(
      buildCodexLaneConfig(input({ userMcpServerNames: [...odd, 'ptah'] }))
        .entries,
    );
    const expected: Record<string, TomlValue> = {};
    for (const name of odd) expected[name] = { enabled: false };
    expect(parsed.get('mcp_servers')).toEqual(expected);
  });
});
