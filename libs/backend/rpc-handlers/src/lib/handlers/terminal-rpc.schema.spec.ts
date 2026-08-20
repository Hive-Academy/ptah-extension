/**
 * terminal-rpc.schema.spec.ts
 *
 * Unit specs for the terminal RPC boundary schemas. The `shell` allowlist
 * itself is covered exhaustively (per platform) in platform-core's
 * `shell-allowlist.spec.ts`; here we assert the schema WIRING — that the refine
 * is applied, that both parse helpers return `null` on failure and the parsed
 * value on success, and that `raw ?? {}` keeps an absent `params` valid.
 *
 * `shell` values below are chosen to be allowlisted on the host running the
 * suite (`process.platform`) so the wiring assertions are OS-independent.
 */
import { z } from 'zod';

import {
  TerminalCreateParamsSchema,
  TerminalKillParamsSchema,
  parseTerminalCreateParams,
  parseTerminalKillParams,
} from './terminal-rpc.schema';

const ALLOWED_SHELL = process.platform === 'win32' ? 'cmd.exe' : 'bash';

describe('terminal-rpc.schema', () => {
  describe('parseTerminalCreateParams', () => {
    it('parses an absent params (undefined) to {} via raw ?? {}', () => {
      expect(parseTerminalCreateParams(undefined)).toEqual({});
    });

    it('parses an empty object', () => {
      expect(parseTerminalCreateParams({})).toEqual({});
    });

    it('parses a full valid payload with an allowlisted shell', () => {
      const parsed = parseTerminalCreateParams({
        cwd: '/ws/root',
        shell: ALLOWED_SHELL,
        name: 'main',
      });
      expect(parsed).toEqual({
        cwd: '/ws/root',
        shell: ALLOWED_SHELL,
        name: 'main',
      });
    });

    it('parses a payload with no shell (host default)', () => {
      const parsed = parseTerminalCreateParams({ cwd: '/ws/root' });
      expect(parsed).toEqual({ cwd: '/ws/root' });
    });

    it('returns null when shell is not in the allowlist', () => {
      expect(parseTerminalCreateParams({ shell: 'rm' })).toBeNull();
      expect(parseTerminalCreateParams({ shell: 'node' })).toBeNull();
    });

    it('returns null when shell contains a path separator', () => {
      expect(parseTerminalCreateParams({ shell: '/bin/bash' })).toBeNull();
      expect(
        parseTerminalCreateParams({ shell: 'C:\\Windows\\System32\\cmd.exe' }),
      ).toBeNull();
    });

    it('returns null when a field has the wrong type', () => {
      expect(parseTerminalCreateParams({ cwd: 42 })).toBeNull();
      expect(parseTerminalCreateParams({ name: false })).toBeNull();
    });

    it('attaches the allowlist message on the shell issue', () => {
      const result = TerminalCreateParamsSchema.safeParse({ shell: 'rm' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some((i) => i.path.join('.') === 'shell'),
        ).toBe(true);
      }
    });
  });

  describe('parseTerminalKillParams', () => {
    it('parses a valid id', () => {
      expect(parseTerminalKillParams({ id: 'term-1' })).toEqual({
        id: 'term-1',
      });
    });

    it('returns null when id is missing', () => {
      expect(parseTerminalKillParams({})).toBeNull();
      expect(parseTerminalKillParams(undefined)).toBeNull();
    });

    it('returns null when id is empty', () => {
      expect(parseTerminalKillParams({ id: '' })).toBeNull();
    });

    it('returns null when id is not a string', () => {
      expect(parseTerminalKillParams({ id: 123 })).toBeNull();
    });
  });

  it('TerminalKillParamsSchema is a zod object', () => {
    expect(TerminalKillParamsSchema).toBeInstanceOf(z.ZodObject);
  });
});
