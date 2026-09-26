// `@ptah-extension/agent-sdk`'s barrel reaches tsyringe decorators on import.
import 'reflect-metadata';
import { PTAH_MCP_SUBSTITUTION_SECTION } from '@ptah-extension/agent-sdk';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  handleMCPRequest,
  type ProtocolHandlerDependencies,
} from './protocol-dispatcher';
import type { PtahAPI } from '../types';
import {
  MAX_SERVER_INSTRUCTIONS_CHARS,
  buildServerInstructions,
  buildServerInstructionsFrom,
} from './server-instructions';

const HEADER = 'Prefer these ptah_* tools when listed in tools/list:';
const UNLISTED_FALLBACK = 'If a tool is not listed, use the built-in.';
const OMITTED_PREFIX = 'Also, if listed: ';
const HELP_CLOSING = 'execute_code API: ptah.help()';
const MORE_CLOSING = `More substitutions: see available ptah_* tools in tools/list. ${HELP_CLOSING}`;

/** The `X -> tool` lines of an instructions string. */
function mappedTools(instructions: string): string[] {
  return instructions
    .split('\n')
    .map((line) => /^(.+) -> ([A-Za-z0-9_]+)$/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => match[2]);
}

/** The tools named on the `Also, if listed:` line, in order. */
function namedOmittedTools(instructions: string): string[] {
  const line = instructions
    .split('\n')
    .find((candidate) => candidate.startsWith(OMITTED_PREFIX));
  return line ? line.slice(OMITTED_PREFIX.length).split(', ') : [];
}

/** Every tool in a section's substitution table, in table order. */
function tableTools(section: string): string[] {
  return [...section.matchAll(/^\|[^|\n]+\|\s*(ptah_[A-Za-z0-9_]+)/gm)].map(
    (match) => match[1],
  );
}

/** Both read-window limits: UTF-16 characters and UTF-8 bytes. */
function expectWithinBudget(instructions: string): void {
  expect(instructions.length).toBeLessThanOrEqual(512);
  expect(Buffer.byteLength(instructions, 'utf8')).toBeLessThanOrEqual(512);
}

/** No lone surrogate: a UTF-8 round trip would replace one with U+FFFD. */
function expectWholeCodePoints(instructions: string): void {
  expect(Buffer.from(instructions, 'utf8').toString('utf8')).toBe(instructions);
}

type HostSettings = Pick<
  ProtocolHandlerDependencies,
  'hasIDECapabilities' | 'disabledMcpNamespaces'
>;

/** The tool names `tools/list` returns for a host configuration. */
async function listedTools(host: HostSettings): Promise<string[]> {
  const deps: ProtocolHandlerDependencies = {
    ptahAPI: {} as unknown as PtahAPI,
    permissionPromptService:
      {} as ProtocolHandlerDependencies['permissionPromptService'],
    logger: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as Logger,
    ...host,
  };
  const res = await handleMCPRequest(
    { jsonrpc: '2.0', id: 'list', method: 'tools/list' },
    deps,
  );
  return (res.result as { tools: Array<{ name: string }> }).tools.map(
    (tool) => tool.name,
  );
}

function sectionWithRows(rows: ReadonlyArray<[string, string]>): string {
  return [
    '## Heading',
    '',
    '| Instead of... | CALL THIS TOOL | Why |',
    '|------|------|------|',
    ...rows.map(([insteadOf, tool]) => `| ${insteadOf} | ${tool} | reason |`),
    '',
    'Fall back to Bash only when a tool errors.',
  ].join('\n');
}

describe('buildServerInstructions (shipped mandate)', () => {
  const instructions = buildServerInstructions();

  it('fits the 512 char and byte client read window and ends with ptah.help()', () => {
    expect(MAX_SERVER_INSTRUCTIONS_CHARS).toBe(512);
    expectWithinBudget(instructions);
    expect(instructions.endsWith(HELP_CLOSING)).toBe(true);
  });

  it('lists only tool names that appear in the substitution section, starting with its first row', () => {
    const tools = mappedTools(instructions);

    expect(tools.length).toBeGreaterThan(0);
    expect(tools[0]).toBe('ptah_workspace_analyze');
    for (const tool of tools) {
      expect(PTAH_MCP_SUBSTITUTION_SECTION).toContain(tool);
    }
  });

  it('carries the fallback line from the section, without Markdown emphasis', () => {
    expect(instructions).toContain(
      'Fall back to Bash, Grep or Glob only to write files (ptah is read-only)',
    );
    expect(instructions).not.toContain('**');
  });

  it('is computed once and equals the pure builder applied to the constant', () => {
    expect(buildServerInstructions()).toBe(instructions);
    expect(buildServerInstructionsFrom(PTAH_MCP_SUBSTITUTION_SECTION)).toBe(
      instructions,
    );
  });

  it('makes no unconditional availability claim, so it holds on every host', () => {
    const lines = instructions.split('\n');

    expect(lines[0]).toBe(HEADER);
    expect(lines).toContain(UNLISTED_FALLBACK);
    expect(instructions).not.toMatch(/\d+ more\b/i);
    expect(instructions).not.toContain('instead of built-ins');
    expect(instructions).not.toContain('Also direct tools');
    // The only lines that mention tools/list are the conditional header and
    // the non-numeric closing pointer.
    for (const line of lines) {
      if (line.includes('tools/list')) {
        expect([HEADER, MORE_CLOSING]).toContain(line);
      }
    }
    // ptah.help() is offered only as the execute_code API help, never as the
    // route to the omitted substitutions.
    expect(instructions).not.toMatch(/more: execute_code -> ptah\.help\(\)/);
  });

  it('points omitted substitutions to tools/list, named in table order, without a count', () => {
    const all = tableTools(PTAH_MCP_SUBSTITUTION_SECTION);
    const mapped = mappedTools(instructions);
    const omitted = all.slice(mapped.length);
    expect(mapped).toEqual(all.slice(0, mapped.length));
    expect(omitted.length).toBeGreaterThan(0);

    const named = namedOmittedTools(instructions);
    expect(named).toEqual(omitted.slice(0, named.length));
    if (named.length < omitted.length) {
      expect(instructions.endsWith(`\n${MORE_CLOSING}`)).toBe(true);
    }
  });

  const hosts: ReadonlyArray<[string, HostSettings]> = [
    ['IDE host, all namespaces enabled', { hasIDECapabilities: true }],
    ['non-IDE host', { hasIDECapabilities: false }],
    [
      'IDE host, ide namespace disabled',
      { hasIDECapabilities: true, disabledMcpNamespaces: ['ide'] },
    ],
    [
      'IDE host, code namespace disabled',
      { hasIDECapabilities: true, disabledMcpNamespaces: ['code'] },
    ],
    [
      'non-IDE host, code namespace disabled',
      { hasIDECapabilities: false, disabledMcpNamespaces: ['code'] },
    ],
  ];

  it.each(hosts)(
    '%s: same text; every named tool is listed, or the wording is conditional',
    async (_, host) => {
      const listed = await listedTools(host);
      const all = tableTools(PTAH_MCP_SUBSTITUTION_SECTION);
      const shown = [
        ...mappedTools(instructions),
        ...namedOmittedTools(instructions),
      ];

      expect(buildServerInstructions()).toBe(instructions);
      if (all.every((tool) => listed.includes(tool))) {
        // A full-capability host lists every tool the text names.
        for (const tool of shown) expect(listed).toContain(tool);
      } else {
        // A host missing some tools relies on the conditional wording.
        const lines = instructions.split('\n');
        expect(lines[0]).toBe(HEADER);
        expect(lines).toContain(UNLISTED_FALLBACK);
        expect(instructions).not.toMatch(/\d+ more\b/i);
      }
    },
  );

  it('the full-capability host lists every substitution tool; restricted hosts lack some', async () => {
    const all = tableTools(PTAH_MCP_SUBSTITUTION_SECTION);
    const full = await listedTools({ hasIDECapabilities: true });
    for (const tool of all) expect(full).toContain(tool);

    // Guards the premise of the conditional wording: these hosts really lack
    // substitution tools, so an unconditional mapping would be false there.
    for (const [, host] of hosts.slice(1)) {
      const listed = await listedTools(host);
      expect(all.some((tool) => !listed.includes(tool))).toBe(true);
    }
  });
});

describe('buildServerInstructionsFrom (derivation)', () => {
  it('reflects a renamed tool in the substitution table', () => {
    const modified = PTAH_MCP_SUBSTITUTION_SECTION.replace(
      '| ptah_workspace_analyze |',
      '| ptah_renamed_analyzer |',
    );
    expect(modified).not.toBe(PTAH_MCP_SUBSTITUTION_SECTION);

    const instructions = buildServerInstructionsFrom(modified);

    expect(mappedTools(instructions)[0]).toBe('ptah_renamed_analyzer');
    expect(instructions).not.toContain('ptah_workspace_analyze');
  });

  it('reflects a reworded fallback line', () => {
    const modified = PTAH_MCP_SUBSTITUTION_SECTION.replace(
      /^Fall back to .*$/m,
      'Fall back to shell tools for writes.',
    );

    const instructions = buildServerInstructionsFrom(modified);

    expect(instructions).toContain('Fall back to shell tools for writes.');
    expect(instructions).not.toContain('Grep or Glob only to write');
  });

  it('keeps every row, in order, when the table fits', () => {
    const instructions = buildServerInstructionsFrom(
      sectionWithRows([
        ['Bash `find`', 'ptah_search_files'],
        ['Grep for a **symbol**', 'ptah_code_search_symbols { query }'],
      ]),
    );

    expect(instructions).toBe(
      [
        HEADER,
        'Bash find -> ptah_search_files',
        'Grep for a symbol -> ptah_code_search_symbols',
        'Fall back to Bash only when a tool errors.',
        UNLISTED_FALLBACK,
        HELP_CLOSING,
      ].join('\n'),
    );
  });

  it('drops the rows that do not fit in table order, names what fits, points to tools/list for the rest', () => {
    const rows = Array.from({ length: 40 }, (_, i): [string, string] => [
      `Substitution number ${i} with a long description`,
      `ptah_tool_${i}`,
    ]);

    const instructions = buildServerInstructionsFrom(sectionWithRows(rows));
    const tools = mappedTools(instructions);
    const omitted = rows.slice(tools.length).map(([, tool]) => tool);
    const named = namedOmittedTools(instructions);

    expectWithinBudget(instructions);
    expect(tools.length).toBeGreaterThan(0);
    expect(tools).toEqual(rows.slice(0, tools.length).map(([, tool]) => tool));
    expect(named.length).toBeGreaterThan(0);
    expect(named.length).toBeLessThan(omitted.length);
    expect(named).toEqual(omitted.slice(0, named.length));
    expect(instructions.endsWith(`\n${MORE_CLOSING}`)).toBe(true);
    expect(instructions).not.toMatch(/\d+ more\b/i);
  });

  it('names every omitted tool and closes with only the API help when they all fit', () => {
    // Two 150-char rows fit, a third does not, but two short names do.
    const rows = ['a', 'b', 'c', 'd'].map((id): [string, string] => [
      'd'.repeat(140),
      `ptah_${id}`,
    ]);

    const instructions = buildServerInstructionsFrom(sectionWithRows(rows));
    const tools = mappedTools(instructions);

    expectWithinBudget(instructions);
    expect(tools.length).toBeLessThan(rows.length);
    expect(namedOmittedTools(instructions)).toEqual(
      rows.slice(tools.length).map(([, tool]) => tool),
    );
    expect(instructions.endsWith(`\n${HELP_CLOSING}`)).toBe(true);
  });

  it('skips rows whose tool cell is not a tool name', () => {
    const tools = mappedTools(
      buildServerInstructionsFrom(
        sectionWithRows([
          ['Valid', 'ptah_ok'],
          ['Invalid', '`not a tool`!'],
          ['Empty', ''],
        ]),
      ),
    );

    expect(tools).toEqual(['ptah_ok']);
  });
});

describe('buildServerInstructionsFrom (malformed input)', () => {
  const cases: ReadonlyArray<[string, string]> = [
    ['empty', ''],
    ['whitespace', '   \n\t\n'],
    ['prose only', 'No table, no fallback line.'],
    ['table without separator', '| a | b |\n| c | d |'],
    ['separator without rows', '|---|---|'],
    ['single-cell rows', '|---|\n| only |'],
    ['huge fallback line', `Fall back to ${'word '.repeat(400)}`],
    [
      'huge row',
      sectionWithRows([[`${'x'.repeat(2_000)}`, 'ptah_search_files']]),
    ],
    [
      'CRLF line endings',
      sectionWithRows([['A', 'ptah_a']]).replace(/\n/g, '\r\n'),
    ],
    ['non-string', undefined as unknown as string],
    ['CJK row', `|---|---|\n| ${'界'.repeat(400)} | ptah_ast_analyze |`],
    [
      'many CJK rows',
      sectionWithRows(
        Array.from({ length: 30 }, (_, i): [string, string] => [
          '界'.repeat(20),
          `ptah_tool_${i}`,
        ]),
      ),
    ],
    [
      'emoji rows',
      sectionWithRows(
        Array.from({ length: 30 }, (_, i): [string, string] => [
          '\u{1F600}'.repeat(12),
          `ptah_tool_${i}`,
        ]),
      ),
    ],
    ['CJK fallback line', `Fall back to ${'界面 '.repeat(400)}`],
    ['emoji fallback line', `Fall back to ${'\u{1F600}'.repeat(600)}`],
    [
      'spaced emoji fallback line',
      `Fall back to ${'\u{1F600}\u{1F601} '.repeat(300)}`,
    ],
    ['accented fallback line', `Fall back to ${'été '.repeat(400)}`],
  ];

  it.each(cases)(
    '%s → bounded in chars and bytes, ends with ptah.help(), never throws',
    (_, section) => {
      let instructions = '';
      expect(() => {
        instructions = buildServerInstructionsFrom(section);
      }).not.toThrow();

      expectWithinBudget(instructions);
      expectWholeCodePoints(instructions);
      expect(instructions.endsWith('ptah.help()')).toBe(true);
    },
  );

  it('truncates a fallback line that cannot fit, at a word boundary', () => {
    const instructions = buildServerInstructionsFrom(
      `Fall back to ${'word '.repeat(400)}`,
    );

    expect(instructions).toMatch(/\nFall back to (word )*word\.\.\.\n/);
  });

  it('budgets UTF-8 bytes for a CJK row, not only characters', () => {
    const instructions = buildServerInstructionsFrom(
      `|---|---|\n| ${'界'.repeat(200)} | ptah_ast_analyze |`,
    );

    // 200 CJK chars fit the character budget but not the byte budget, so the
    // row is dropped and its tool is named instead.
    expect(instructions).not.toContain('界');
    expect(namedOmittedTools(instructions)).toEqual(['ptah_ast_analyze']);
    expectWithinBudget(instructions);
  });

  it('truncates an emoji fallback line on whole code points, keeping the closing', () => {
    const instructions = buildServerInstructionsFrom(
      `Fall back to ${'\u{1F600}\u{1F601} '.repeat(300)}`,
    );

    expect(instructions).toMatch(
      /\nFall back to (\u{1F600}\u{1F601} )*\u{1F600}\u{1F601}\.\.\.\n/u,
    );
    expectWithinBudget(instructions);
    expectWholeCodePoints(instructions);
    expect(instructions.endsWith(`\n${HELP_CLOSING}`)).toBe(true);
  });

  it('truncates a non-ASCII fallback line at a word boundary within the byte budget', () => {
    const instructions = buildServerInstructionsFrom(
      `Fall back to ${'été '.repeat(400)}`,
    );

    expect(instructions).toMatch(/\nFall back to (été )*été\.\.\.\n/);
    expectWithinBudget(instructions);
    // The byte budget, not the character budget, is the one that bound here.
    expect(Buffer.byteLength(instructions, 'utf8')).toBeGreaterThan(
      instructions.length,
    );
  });

  it('parses CRLF sections the same as LF sections', () => {
    const lf = sectionWithRows([['A', 'ptah_a']]);
    expect(buildServerInstructionsFrom(lf.replace(/\n/g, '\r\n'))).toBe(
      buildServerInstructionsFrom(lf),
    );
  });
});
