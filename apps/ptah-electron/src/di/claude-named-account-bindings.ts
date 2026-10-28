import type { DependencyContainer } from 'tsyringe';
import {
  SDK_NAMED_ACCOUNT_PERSISTENCE,
  SDK_SESSION_IMPORT_BINDING_LOOKUP,
  type NamedAccountPersistencePort,
  type SessionImportBindingLookup,
} from '@ptah-extension/agent-sdk';
import {
  CLAUDE_LANE_ACCOUNT_PERSISTENCE,
  type ClaudeLaneAccountPersistence,
} from '@ptah-extension/cli-agent-runtime';
import { ClaudeNamedAccountPersistence } from '@ptah-extension/auth-providers';
import { PERSISTENCE_TOKENS } from '@ptah-extension/persistence-sqlite';

/**
 * Binds the certified named Claude account adapter (TASK_2026_719 B17).
 *
 * Runs in phase 2 after the SQLite block. When the block was skipped there is
 * no `SQLITE_CONNECTION`, the account store cannot exist, and the tokens keep
 * the null defaults that `registerSdkServices` binds (and the lane token stays
 * unregistered), so named runs refuse `unavailable-storage` as on other hosts.
 *
 * The three registrations come after those defaults on purpose: tsyringe
 * resolves a token to its last registration, so these override the nulls.
 * Every consumer resolves them later (phase 3+ or at run time).
 *
 * Kept out of `phase-2-libraries.ts` so the container smoke spec can run it:
 * that module cannot be loaded under Jest.
 */
export function registerClaudeNamedAccountBindings(container: DependencyContainer): boolean {
  if (!container.isRegistered(PERSISTENCE_TOKENS.SQLITE_CONNECTION, true)) return false;
  container.registerSingleton(ClaudeNamedAccountPersistence);
  container.register(SDK_NAMED_ACCOUNT_PERSISTENCE, {
    useFactory: (c) => c.resolve(ClaudeNamedAccountPersistence) satisfies NamedAccountPersistencePort,
  });
  container.register(SDK_SESSION_IMPORT_BINDING_LOOKUP, {
    useFactory: (c) => c.resolve(ClaudeNamedAccountPersistence) satisfies SessionImportBindingLookup,
  });
  container.register(CLAUDE_LANE_ACCOUNT_PERSISTENCE, {
    useFactory: (c) => c.resolve(ClaudeNamedAccountPersistence) satisfies ClaudeLaneAccountPersistence,
  });
  return true;
}
