/**
 * `features.tool_search_always_defer_mcp_tools` in a Codex `config.toml`.
 *
 * Codex has historically kept MCP tools out of the model's tool list until it
 * runs a tool search, and this key is what `CodexCliAdapter` sends in-process
 * to stop that. On codex-cli 0.150.1 the flag reports stage `removed` and could
 * not be moved from any surface, so whether it still does anything is open —
 * see `enableCodexMcpToolSearch`. What is NOT open is what these cases pin: a
 * config the user hand-edits must come back intact, and must still PARSE.
 *
 * The path is a parameter because Codex has two config files (home and
 * project-scoped) and the flag has to land in the same one as the server entry
 * it accompanies.
 *
 * Source-under-test: `codex-tool-search-flag.ts`.
 */

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  clearCodexMcpToolSearch,
  codexConfigPath,
  enableCodexMcpToolSearch,
  CODEX_TOOL_SEARCH_FLAG,
} from './codex-tool-search-flag';

describe('codex tool-search feature flag', () => {
  let tempHome: string;
  let configPath: string;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'harness-sync-codex-flag-'));
    configPath = join(tempHome, '.codex', 'config.toml');
  });

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true });
  });

  function seed(content: string): void {
    mkdirSync(join(tempHome, '.codex'), { recursive: true });
    writeFileSync(configPath, content, 'utf-8');
  }

  function read(): string {
    return readFileSync(configPath, 'utf-8');
  }

  function enable() {
    return enableCodexMcpToolSearch(configPath);
  }

  function clear() {
    return clearCodexMcpToolSearch(configPath);
  }

  it('exposes the HOME path for callers that want that scope', () => {
    expect(codexConfigPath({ homeDir: tempHome })).toBe(configPath);
  });

  it('writes wherever it is pointed, including a workspace config', async () => {
    // `CodeExecutionMCP` registers Ptah's own server into
    // `{ws}/.codex/config.toml`, so the flag has to follow it there rather than
    // land in a home file the server entry is not in.
    const ws = mkdtempSync(join(tmpdir(), 'harness-sync-codex-ws-'));
    const wsConfig = join(ws, '.codex', 'config.toml');
    try {
      await expect(enableCodexMcpToolSearch(wsConfig)).resolves.toBe('written');

      expect(readFileSync(wsConfig, 'utf-8')).toContain(
        `${CODEX_TOOL_SEARCH_FLAG} = false`,
      );
      // And the home file was not touched.
      expect(() => readFileSync(configPath, 'utf-8')).toThrow();
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  describe('a config that already declares [features]', () => {
    // This is the common case and the dangerous one: Codex writes `[features]`
    // itself, and TOML permits a table header exactly once. Appending a second
    // would leave the whole file unparseable, which is a broken Codex rather
    // than a degraded harness.
    const seeded = [
      '[plugins."browser@openai-bundled"]',
      'enabled = true',
      '',
      '[features]',
      'js_repl = false',
      '',
      '[mcp_servers.node_repl]',
      'command = "node_repl.exe"',
      '',
    ].join('\n');

    it('merges into the existing table instead of adding a second one', async () => {
      seed(seeded);

      await expect(enable()).resolves.toBe('written');

      const content = read();
      expect(content.match(/^\[features\]$/gm)).toHaveLength(1);
      expect(content).toContain(`${CODEX_TOOL_SEARCH_FLAG} = false`);
    });

    it('inserts the line INSIDE [features], not after the next table', async () => {
      seed(seeded);
      await enable();

      const lines = read().split('\n');
      const header = lines.indexOf('[features]');
      const flag = lines.findIndex((line) =>
        line.startsWith(CODEX_TOOL_SEARCH_FLAG),
      );
      const nextTable = lines.findIndex(
        (line, index) => index > header && line.startsWith('['),
      );

      expect(header).toBeGreaterThanOrEqual(0);
      expect(flag).toBeGreaterThan(header);
      expect(flag).toBeLessThan(nextTable);
    });

    it('leaves every byte outside the inserted line alone', async () => {
      seed(seeded);
      await enable();

      const withoutOurLine = read()
        .split('\n')
        .filter((line) => !line.startsWith(CODEX_TOOL_SEARCH_FLAG))
        .join('\n');
      expect(withoutOurLine).toBe(seeded);
    });

    it('is idempotent — a second call writes nothing new', async () => {
      seed(seeded);
      await enable();
      const afterFirst = read();

      await expect(enable()).resolves.toBe('unchanged');
      expect(read()).toBe(afterFirst);
    });

    it('removes only its own line', async () => {
      seed(seeded);
      await enable();

      await clear();

      expect(read()).toBe(seeded);
    });
  });

  describe('a config with no [features] table', () => {
    const seeded = ['[mcp_servers.node_repl]', 'command = "x"', ''].join('\n');

    it('appends a fenced block', async () => {
      seed(seeded);

      await expect(enable()).resolves.toBe('written');

      const content = read();
      expect(content).toContain('# ptah:begin features');
      expect(content).toContain('[features]');
      expect(content).toContain(`${CODEX_TOOL_SEARCH_FLAG} = false`);
      expect(content).toContain('# ptah:end features');
      expect(content.startsWith(seeded.trimEnd())).toBe(true);
    });

    it('removing the fenced block restores the file exactly', async () => {
      seed(seeded);
      await enable();

      await clear();

      expect(read()).toBe(seeded);
    });

    it('creates the file when none exists', async () => {
      mkdirSync(join(tempHome, '.codex'), { recursive: true });

      await expect(enable()).resolves.toBe('written');

      expect(read()).toContain(`${CODEX_TOOL_SEARCH_FLAG} = false`);
    });
  });

  describe('a value the USER set', () => {
    // Ptah's line carries a `# ptah:managed` marker. A line without one is the
    // user's own setting: honouring it is the correct outcome, and it is
    // reported distinctly so a caller can say the tools may stay hidden rather
    // than silently disagreeing with the file.
    it('is never overwritten, and is reported as user-owned', async () => {
      const seeded = [
        '[features]',
        `${CODEX_TOOL_SEARCH_FLAG} = true`,
        '',
      ].join('\n');
      seed(seeded);

      await expect(enable()).resolves.toBe('user-owned');

      expect(read()).toBe(seeded);
    });

    it('is never removed either', async () => {
      const seeded = [
        '[features]',
        `${CODEX_TOOL_SEARCH_FLAG} = true`,
        '',
      ].join('\n');
      seed(seeded);

      await clear();

      expect(read()).toBe(seeded);
    });

    it('a root-level dotted `features.` key is left alone rather than shadowed', async () => {
      // `features.js_repl = false` at the top of the file already defines the
      // table; adding a `[features]` header beside it is the same TOML conflict
      // as a duplicate header.
      const seeded = ['features.js_repl = false', '', '[windows]', ''].join(
        '\n',
      );
      seed(seeded);

      await expect(enable()).resolves.toBe('user-owned');

      expect(read()).toBe(seeded);
    });
  });

  it('survives a real-world config with quoted table keys and literal strings', async () => {
    // Shape taken from an actual `~/.codex/config.toml` (codex-cli 0.150.1):
    // a top-level array, `[projects.'<windows path>']` tables whose keys are
    // single-quoted literals, `[plugins."x@y"]` with a dotted quoted key, an
    // existing `[features]`, and an `[mcp_servers.*]` table with a sub-table.
    // Every one of those is a place a naive line scanner could go wrong.
    const seeded = [
      'notify = [ "C:\\\\tools\\\\notify.exe", "turn-ended" ]',
      "[projects.'c:\\users\\abdal']",
      'trust_level = "trusted"',
      '',
      "[projects.'d:\\projects\\ptah-extension']",
      'trust_level = "trusted"',
      '',
      '[windows]',
      'sandbox = "unelevated"',
      '',
      '[plugins."browser@openai-bundled"]',
      'enabled = true',
      '',
      '[features]',
      'js_repl = false',
      '',
      '[mcp_servers.node_repl]',
      'args = []',
      "command = 'C:\\tools\\node_repl.exe'",
      '',
      '[mcp_servers.node_repl.env]',
      'NODE_REPL_NODE_PATH = "C:\\\\tools\\\\node.exe"',
      '',
    ].join('\n');
    seed(seeded);

    await expect(enable()).resolves.toBe('written');

    const content = read();
    // Exactly one `[features]`, so the file still parses.
    expect(content.match(/^\[features\]$/gm)).toHaveLength(1);
    // The flag landed inside it, ahead of `[mcp_servers.node_repl]`.
    const lines = content.split('\n');
    const header = lines.indexOf('[features]');
    const flag = lines.findIndex((line) =>
      line.startsWith(CODEX_TOOL_SEARCH_FLAG),
    );
    expect(flag).toBe(header + 1);
    // And nothing else moved.
    expect(
      lines
        .filter((line) => !line.startsWith(CODEX_TOOL_SEARCH_FLAG))
        .join('\n'),
    ).toBe(seeded);

    await clear();
    expect(read()).toBe(seeded);
  });

  it('clearing a config that was never written is a no-op', async () => {
    const seeded = ['[features]', 'js_repl = false', ''].join('\n');
    seed(seeded);

    await clear();

    expect(read()).toBe(seeded);
  });

  it('clearing a missing file does not throw', async () => {
    await expect(clear()).resolves.toBeUndefined();
  });

  it('preserves CRLF line endings', async () => {
    seed(['[features]', 'js_repl = false', ''].join('\r\n'));

    await enable();

    const content = read();
    expect(content).toContain('\r\n');
    expect(content).not.toMatch(/[^\r]\n/);
  });
});
