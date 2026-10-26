import type { DependencyContainer } from 'tsyringe';
import { isAbsolute, relative, sep } from 'node:path';
import {
  initializeSessionRuntimeIdentityLookup,
  resolveCodexNativeBinaryPath,
  type CodexChatScope,
} from '@ptah-extension/agent-sdk';
import {
  CODEX_RUNTIME_TOKENS,
  CodexAccountUsageClient,
  CodexParityGate,
  readCodexDevRouteOverride,
  registerCodexRuntime,
  type ApprovalSink,
  type CodexExecutableManifestRow,
  type CodexParityPlatform,
  type CodexRuntime,
  type CodexRuntimeRegistrationPorts,
} from '@ptah-extension/codex-runtime';

export interface ElectronCodexRoutingInput {
  readonly isPackaged: boolean;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly platform: CodexParityPlatform;
}

/** A capability hint only; opening a chat still uses resolveGatedCodexRuntime. */
export function createElectronCodexRouting(input: ElectronCodexRoutingInput) {
  const devRoute = readCodexDevRouteOverride({
    isPackaged: input.isPackaged,
    env: input.env,
  });
  const capabilities = Object.freeze({
    nativeCodex:
      new CodexParityGate().isEnabled('chat', input.platform) ||
      devRoute?.consumer === 'chat',
  });
  return Object.freeze({ devRoute, capabilities });
}

/** No detected CLI fallback: Electron must spawn the bundled native executable. */
export function createElectronCodexExecutable(
  expectedManifestRow: CodexExecutableManifestRow,
  bundledRoot: string,
) {
  const resolvedPath = resolveCodexNativeBinaryPath();
  if (!resolvedPath) throw new Error('Bundled Codex executable unavailable');
  const local = relative(bundledRoot, resolvedPath);
  // The shared resolver also probes global installations. They must not become
  // an Electron runtime fallback if the host's bundled package is absent.
  if (!isAbsolute(bundledRoot) || !local || isAbsolute(local) || local === '..' || local.startsWith(`..${sep}`)) {
    throw new Error('Codex executable is outside the host bundle');
  }
  return Object.freeze({ resolvedPath, expectedManifestRow });
}

export interface ElectronCodexScopeInput extends ElectronCodexRoutingInput {
  readonly parent: DependencyContainer;
  readonly ports: Omit<
    CodexRuntimeRegistrationPorts,
    'sink' | 'executable' | 'devRoute'
  >;
  readonly expectedManifestRow: CodexExecutableManifestRow;
  /** Absolute host-owned node_modules root (app.asar.unpacked when packaged). */
  readonly bundledRoot: string;
}

/**
 * Per-session registration, never a runtime on the parent. The adapter calls
 * dispose on failed opens as well as normal closure. Usage owns explicit-home
 * auth watchers through CodexAccountUsageClient and releases them on close.
 */
export function createElectronCodexScopeFactory(input: ElectronCodexScopeInput) {
  const routing = createElectronCodexRouting(input);
  const executable = createElectronCodexExecutable(input.expectedManifestRow, input.bundledRoot);
  if (input.ports.binary.executablePath !== executable.resolvedPath) {
    throw new Error('Codex binary identity does not describe bundled executable');
  }
  return (sink: ApprovalSink): CodexChatScope => {
    // Reject before allocating a child: registration disallows inherited runtimes.
    if (input.parent.isRegistered(CODEX_RUNTIME_TOKENS.Runtime, true)) {
      throw new Error('Codex runtime must be owned by a session scope');
    }
    const container = input.parent.createChildContainer();
    registerCodexRuntime(container, {
      ...input.ports,
      executable,
      sink,
      devRoute: routing.devRoute,
    });
    // Lifecycle ownership is the only allowed use of the raw token. Resolving
    // here starts no process and ensures failed opens retain a closeable owner.
    const runtime = container.resolve<CodexRuntime>(CODEX_RUNTIME_TOKENS.Runtime);
    const usage = container.resolve<CodexAccountUsageClient | null>(CodexAccountUsageClient);
    let closing: Promise<void> | undefined;
    const close = async () => {
      try {
        await runtime.close();
      } finally {
        try {
          await usage?.close();
        } finally {
          await container.dispose();
        }
      }
    };
    return { container, dispose: () => (closing ??= close()) };
  };
}

/** Await this before registering SESSION_RUNTIME_IDENTITY_LOOKUP as an instance. */
export async function createElectronCodexIdentityLookup(
  ...args: Parameters<typeof initializeSessionRuntimeIdentityLookup>
) {
  return await initializeSessionRuntimeIdentityLookup(...args);
}
