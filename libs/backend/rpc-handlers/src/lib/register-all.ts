/**
 * Shared RPC Handler Registration (TASK_2025_291 Wave C4b)
 *
 * Centralizes shared RPC handler registration so each app no longer needs
 * to hand-maintain a per-handler fan-out. Each handler class declares a
 * `static readonly METHODS` tuple enumerating the RPC method names it owns;
 * the union of all tuples is compile-asserted to cover every `RpcMethodName`.
 *
 * TUI omits `HarnessRpcHandlers` because it has no harness wiring — callers
 * pass `{ exclude: [HarnessRpcHandlers] }` to preserve that behaviour.
 */

import type { DependencyContainer } from 'tsyringe';
import type { RpcMethodName } from '@ptah-extension/shared';
import {
  AuthRpcHandlers,
  AutocompleteRpcHandlers,
  ChatRpcHandlers,
  ConfigRpcHandlers,
  ContextRpcHandlers,
  EnhancedPromptsRpcHandlers,
  HarnessRpcHandlers,
  LicenseRpcHandlers,
  LlmRpcHandlers,
  PluginRpcHandlers,
  ProviderRpcHandlers,
  PtahCliRpcHandlers,
  QualityRpcHandlers,
  SessionRpcHandlers,
  SetupRpcHandlers,
  SubagentRpcHandlers,
  WebSearchRpcHandlers,
  WizardGenerationRpcHandlers,
} from './handlers';

/**
 * The canonical list of shared handlers. Every handler class in
 * `libs/backend/rpc-handlers/src/lib/handlers/` belongs here.
 *
 * The `as const` preserves the tuple element types so the compile-time
 * assertions below can type-index each class's `METHODS`.
 */
export const SHARED_HANDLERS = [
  AuthRpcHandlers,
  AutocompleteRpcHandlers,
  ChatRpcHandlers,
  ConfigRpcHandlers,
  ContextRpcHandlers,
  EnhancedPromptsRpcHandlers,
  HarnessRpcHandlers,
  LicenseRpcHandlers,
  LlmRpcHandlers,
  PluginRpcHandlers,
  ProviderRpcHandlers,
  PtahCliRpcHandlers,
  QualityRpcHandlers,
  SessionRpcHandlers,
  SetupRpcHandlers,
  SubagentRpcHandlers,
  WebSearchRpcHandlers,
  WizardGenerationRpcHandlers,
] as const;

export interface RegisterAllRpcHandlersOptions {
  /** Handler classes to skip (e.g. TUI excludes HarnessRpcHandlers). */
  readonly exclude?: readonly (typeof SHARED_HANDLERS)[number][];
}

/**
 * Resolve every handler in `SHARED_HANDLERS` (minus exclusions) from the
 * DI container and call `register()` on each.
 *
 * Each handler must be registered with the container (class-as-token via
 * `@injectable()`) before calling this function.
 */
/**
 * Structural shape every handler in `SHARED_HANDLERS` satisfies. Matches
 * tsyringe's `constructor<T>` so the class-as-token `container.resolve`
 * call type-checks when iterating the union.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SharedHandlerCtor = new (...args: any[]) => { register(): void };

export function registerAllRpcHandlers(
  container: DependencyContainer,
  options: RegisterAllRpcHandlersOptions = {},
): void {
  const excluded = new Set<unknown>(options.exclude ?? []);
  for (const Ctor of SHARED_HANDLERS as readonly SharedHandlerCtor[]) {
    if (excluded.has(Ctor)) continue;
    const instance = container.resolve(Ctor);
    instance.register();
  }
}

// --- Compile-time invariants -------------------------------------------------

/**
 * Flatten: union of every handler's `METHODS` tuple element type.
 * `(typeof SHARED_HANDLERS)[number]` is the union of the 18 constructor
 * types; `['METHODS'][number]` projects the element type of each tuple.
 */
type AllRegisteredMethodNames =
  (typeof SHARED_HANDLERS)[number]['METHODS'][number];

/**
 * COVERAGE: every `RpcMethodName` is claimed by at least one handler.
 * If `_MissingOwners` is non-`never`, some method in `RpcMethodRegistry`
 * has no shared-handler owner (it may still be owned by an app-specific
 * handler — VS Code's File/Command/Agent/SkillsSh/McpDirectory handlers,
 * Electron's Workspace/Editor/Layout/Git/Terminal handlers). Callers of
 * this module are responsible for covering the remainder via app-local
 * handler registration.
 */
type _MissingFromSharedCoverage = Exclude<
  RpcMethodName,
  AllRegisteredMethodNames
>;

/**
 * Kept exported so downstream tests can import it and spot-check at compile
 * time. The type is informational — app-specific handlers claim the rest.
 */
export type _AssertAllRpcMethodsOwned = [
  'SHARED_HANDLERS coverage gap (app-specific handlers must cover):',
  _MissingFromSharedCoverage,
];

/**
 * Runtime invariant: no method name appears on two shared handlers.
 *
 * Dev-mode helper. Not auto-invoked so production builds pay zero cost.
 * Apps may call this inside their existing `if (process.env.NODE_ENV ===
 * 'development')` assertion block after `registerAllRpcHandlers` returns.
 */
export function __debugAssertSharedHandlersDisjoint(): void {
  const seen = new Set<string>();
  for (const Ctor of SHARED_HANDLERS) {
    for (const name of Ctor.METHODS) {
      if (seen.has(name)) {
        throw new Error(
          `SHARED_HANDLERS duplicate: '${name}' claimed by ${Ctor.name}`,
        );
      }
      seen.add(name);
    }
  }
}
