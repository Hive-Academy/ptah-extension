/**
 * Manifest invariants + dual-registration guard (test-strategy-plan.md §4.1).
 *
 * The manifest must partition `RPC_METHOD_NAMES` exactly — that is what makes
 * every host's exclusion set derivable instead of hand-maintained.
 *
 * The allowlist half ensures every method's prefix is present in
 * ALLOWED_METHOD_PREFIXES (the runtime security allowlist in vscode-core).
 * Without it, a handler whose prefix is missing silently fails at runtime —
 * the RpcHandler rejects the registration — rather than breaking CI.
 *
 * Failure message example:
 *   Missing prefixes detected:
 *     - newFeature: newFeature:doSomething  (prefix: "newFeature:")
 */

// ---------------------------------------------------------------------------
// Heavy transitive dependencies must be mocked before the SUT is imported.
//
// Importing the manifest brings in every handler class — see
// `test-utils/heavy-module-mocks.ts` for why that needs stubbing.
// ---------------------------------------------------------------------------
jest.mock('@ptah-extension/workspace-intelligence', () =>
  require('../test-utils/heavy-module-mocks').workspaceIntelligenceMock(),
);

jest.mock('@ptah-extension/memory-curator', () => ({
  // Pass through the real module so MEMORY_TOKENS and other DI symbols are
  // intact (memory-curator has no native bindings). Only stub the heavy
  // async helper that makes network/FS calls.
  ...jest.requireActual('@ptah-extension/memory-curator'),
  deriveWorkspaceFingerprint: jest.fn(),
}));

import 'reflect-metadata';
import { ALLOWED_METHOD_PREFIXES } from '@ptah-extension/vscode-core';
import { RPC_METHOD_NAMES } from '@ptah-extension/shared';
import { RPC_HANDLER_MANIFEST, assertManifestInvariants } from './host-profile';

describe('RPC handler manifest', () => {
  it('claims every registry method exactly once', () => {
    expect(() => assertManifestInvariants(RPC_METHOD_NAMES)).not.toThrow();
  });

  it('uses unique entry keys', () => {
    const keys = RPC_HANDLER_MANIFEST.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('only leaves `host.`-prefixed entries without a library implementation', () => {
    const unowned = RPC_HANDLER_MANIFEST.filter(
      (entry) => !('handler' in entry) && !entry.key.startsWith('host.'),
    ).map((entry) => entry.key);
    expect(unowned).toEqual([]);
  });
});

describe('RPC allowlist dual-registration guard', () => {
  it('every manifest method has its prefix in ALLOWED_METHOD_PREFIXES', () => {
    const missing: string[] = [];

    for (const entry of RPC_HANDLER_MANIFEST) {
      for (const method of entry.methods) {
        const colonIndex = method.indexOf(':');
        // Methods without a colon have no valid prefix — flag them too.
        const prefix =
          colonIndex === -1 ? method : method.slice(0, colonIndex + 1);

        if (!(ALLOWED_METHOD_PREFIXES as readonly string[]).includes(prefix)) {
          missing.push(`  - ${entry.key}: ${method}  (prefix: "${prefix}")`);
        }
      }
    }

    if (missing.length > 0) {
      throw new Error(
        `Missing prefixes detected — add them to ALLOWED_METHOD_PREFIXES in ` +
          `libs/backend/vscode-core/src/messaging/rpc-handler.ts:\n` +
          missing.join('\n'),
      );
    }
  });

  it('every method in RPC_METHOD_NAMES has its prefix in ALLOWED_METHOD_PREFIXES', () => {
    // Covers app-local handlers (VS Code File/Editor/Command/Agent, Electron
    // Workspace/Layout/Terminal) that are not part of SHARED_HANDLERS: every
    // method name in the shared registry must be registrable at runtime, or
    // RpcHandler.registerMethod throws during activation.
    const missing: string[] = [];

    for (const method of RPC_METHOD_NAMES) {
      const colonIndex = method.indexOf(':');
      const prefix =
        colonIndex === -1 ? method : method.slice(0, colonIndex + 1);

      if (!(ALLOWED_METHOD_PREFIXES as readonly string[]).includes(prefix)) {
        missing.push(`  - ${method}  (prefix: "${prefix}")`);
      }
    }

    if (missing.length > 0) {
      throw new Error(
        `RPC registry methods whose prefix is not in ALLOWED_METHOD_PREFIXES ` +
          `(libs/backend/vscode-core/src/messaging/rpc-handler.ts) — these ` +
          `methods cannot be registered at runtime:\n` +
          missing.join('\n'),
      );
    }
  });
});

describe('wizard:get-resumable-run registration (TASK_2026_361)', () => {
  // Dual-registration, spelled out for the one method this task added:
  // compile-time registry (shared), handler manifest ownership (setup), and
  // the runtime prefix guard — which `wizard:` already satisfied and which
  // this task deliberately did NOT touch.
  it('is in the shared RPC registry', () => {
    expect(RPC_METHOD_NAMES).toContain('wizard:get-resumable-run');
  });

  it('is owned by the setup handler manifest entry and no other', () => {
    const owners = RPC_HANDLER_MANIFEST.filter((entry) =>
      (entry.methods as readonly string[]).includes('wizard:get-resumable-run'),
    ).map((entry) => entry.key);
    expect(owners).toEqual(['setup']);
  });

  it('is accepted by the existing `wizard:` runtime prefix', () => {
    expect(ALLOWED_METHOD_PREFIXES).toContain('wizard:');
  });
});
