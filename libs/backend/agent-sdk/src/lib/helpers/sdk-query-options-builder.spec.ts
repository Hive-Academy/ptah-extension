/**
 * Unit specs for `SdkQueryOptionsBuilder.mergeMcpOverride` —
 * TASK_2026_108 § 2 T2 (Layer 5 helper).
 *
 * Scope: only the private `mergeMcpOverride(base, override)` helper. The full
 * `build()` flow is exercised by integration tests in this same suite path
 * (`session-lifecycle-manager.spec.ts`, etc.) and by other layers higher in
 * the chain (`sdk-agent-adapter.spec.ts`, `chat-rpc.handlers.spec.ts`).
 *
 * The helper itself is `this`-free — the implementation only branches on
 * `override` and returns either the original `base` reference or a new
 * shallow-merged record. We invoke it via index access on a freshly
 * constructed builder; no DI container is needed because the helper does not
 * touch any injected collaborator.
 *
 * Test names mirror the plan's § 2 T2 Test Plan verbatim.
 */

import 'reflect-metadata';

import { SdkQueryOptionsBuilder } from './sdk-query-options-builder';
import type { McpHttpServerConfig } from '../types/sdk-types/claude-sdk.types';
import type { McpHttpServerOverride } from '@ptah-extension/shared';

// ---------------------------------------------------------------------------
// Test harness — minimal builder instance with all collaborators stubbed.
// `mergeMcpOverride` does not touch `this`, so passing `null`-ish stubs is
// safe for THIS spec only. Do NOT copy this harness for tests that exercise
// `build()` — those need the full DI graph.
// ---------------------------------------------------------------------------

interface BuilderWithMerge {
  mergeMcpOverride(
    base: Record<string, McpHttpServerConfig>,
    override: Record<string, McpHttpServerOverride> | undefined,
  ): Record<string, McpHttpServerConfig>;
}

function makeBuilder(): BuilderWithMerge {
  // The constructor signature is irrelevant for this helper — the method is
  // `this`-free. Bypass DI entirely with a constructed instance whose
  // collaborator slots are unused.
  const ctor = SdkQueryOptionsBuilder as unknown as new (
    ...args: unknown[]
  ) => SdkQueryOptionsBuilder;
  const instance = new ctor(
    /* logger              */ undefined,
    /* permissionHandler   */ undefined,
    /* subagentHookHandler */ undefined,
    /* compactionConfig    */ undefined,
    /* compactionHooks     */ undefined,
    /* worktreeHooks       */ undefined,
    /* authEnv             */ undefined,
    /* modelService        */ undefined,
  );
  return instance as unknown as BuilderWithMerge;
}

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

describe('SdkQueryOptionsBuilder.mergeMcpOverride', () => {
  it('returns base unchanged (toBe identity) when override is undefined', () => {
    const builder = makeBuilder();
    const base: Record<string, McpHttpServerConfig> = {
      ptah: { type: 'http', url: 'http://localhost:1/foo' },
    };
    const result = builder.mergeMcpOverride(base, undefined);
    // Reference identity matters — the existing chat path must remain a
    // strict no-op when no override is supplied.
    expect(result).toBe(base);
  });

  it('returns base unchanged when override is empty object', () => {
    const builder = makeBuilder();
    const base: Record<string, McpHttpServerConfig> = {
      ptah: { type: 'http', url: 'http://localhost:1/foo' },
    };
    const result = builder.mergeMcpOverride(base, {});
    expect(result).toBe(base);
  });

  it('merges override entries over base — caller wins on key collision', () => {
    const builder = makeBuilder();
    const base: Record<string, McpHttpServerConfig> = {
      ptah: { type: 'http', url: 'http://localhost:1/registry' },
    };
    const override: Record<string, McpHttpServerOverride> = {
      ptah: { type: 'http', url: 'http://override.example/proxy' },
    };
    const result = builder.mergeMcpOverride(base, override);
    expect(result).not.toBe(base); // a new object is produced
    expect(result['ptah']).toEqual({
      type: 'http',
      url: 'http://override.example/proxy',
    });
  });

  it('preserves base entries that are not overridden', () => {
    const builder = makeBuilder();
    const base: Record<string, McpHttpServerConfig> = {
      ptah: { type: 'http', url: 'http://localhost:1/registry' },
      other: { type: 'http', url: 'http://localhost:2/other' },
    };
    const override: Record<string, McpHttpServerOverride> = {
      added: {
        type: 'http',
        url: 'http://override.example/added',
        headers: { 'X-Trace': 'on' },
      },
    };
    const result = builder.mergeMcpOverride(base, override);
    expect(result['ptah']).toEqual({
      type: 'http',
      url: 'http://localhost:1/registry',
    });
    expect(result['other']).toEqual({
      type: 'http',
      url: 'http://localhost:2/other',
    });
    expect(result['added']).toEqual({
      type: 'http',
      url: 'http://override.example/added',
      headers: { 'X-Trace': 'on' },
    });
  });
});
