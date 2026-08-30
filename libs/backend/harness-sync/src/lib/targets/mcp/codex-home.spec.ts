/**
 * Where Codex keeps its user-global state.
 *
 * `~/.codex` is the DEFAULT, not the rule — `CODEX_HOME` relocates the whole
 * directory, and relocating a tool's dotfile directory is ordinary practice on
 * Linux and macOS. Verified on codex-cli 0.150.1: `CODEX_HOME=/tmp/xyz codex
 * doctor` reports `config.toml /tmp/xyz/config.toml`, directly inside the
 * override rather than under a nested `.codex`.
 *
 * A module that hardcodes `~/.codex` reads and writes a file Codex is not
 * looking at, silently.
 *
 * Source-under-test: `codex-home.ts`.
 */

import { homedir } from 'os';
import { join } from 'path';
import { codexHomeConfigFile, codexHomeDir } from './codex-home';

describe('codexHomeDir', () => {
  let previous: string | undefined;

  beforeEach(() => {
    previous = process.env['CODEX_HOME'];
    delete process.env['CODEX_HOME'];
  });

  afterEach(() => {
    if (previous === undefined) delete process.env['CODEX_HOME'];
    else process.env['CODEX_HOME'] = previous;
  });

  it('defaults to <home>/.codex', () => {
    expect(codexHomeDir()).toBe(join(homedir(), '.codex'));
  });

  it('honours CODEX_HOME, and does NOT nest .codex inside it', () => {
    // Measured: `CODEX_HOME=/tmp/xyz` puts the config at `/tmp/xyz/config.toml`.
    process.env['CODEX_HOME'] = join('/srv', 'codex-state');

    expect(codexHomeDir()).toBe(join('/srv', 'codex-state'));
    expect(codexHomeConfigFile()).toBe(
      join('/srv', 'codex-state', 'config.toml'),
    );
  });

  it('ignores an empty or whitespace CODEX_HOME', () => {
    // An exported-but-empty variable is not a relocation, and treating it as
    // one would resolve the config to a bare `config.toml` in the cwd.
    for (const value of ['', '   ']) {
      process.env['CODEX_HOME'] = value;
      expect(codexHomeDir()).toBe(join(homedir(), '.codex'));
    }
  });

  it('lets an explicit homeDir PIN the answer, suppressing the env lookup', () => {
    // This is what keeps every spec that pins `homeDir` hermetic on a developer
    // machine that exports CODEX_HOME. No host passes `homeDir` — it is
    // specs-only — so production always gets the environment's answer.
    process.env['CODEX_HOME'] = join('/srv', 'codex-state');

    expect(codexHomeDir({ homeDir: join('/tmp', 'fake-home') })).toBe(
      join('/tmp', 'fake-home', '.codex'),
    );
  });

  it('lets an explicit codexHome win over everything', () => {
    process.env['CODEX_HOME'] = join('/srv', 'from-env');

    expect(
      codexHomeDir({
        homeDir: join('/tmp', 'fake-home'),
        codexHome: join('/srv', 'explicit'),
      }),
    ).toBe(join('/srv', 'explicit'));
  });
});
