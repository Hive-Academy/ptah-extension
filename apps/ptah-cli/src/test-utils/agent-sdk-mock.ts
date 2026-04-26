/**
 * Shared `jest.mock('@ptah-extension/agent-sdk', ...)` factory builders for
 * CLI command specs.
 *
 * Background — why we need to stub agent-sdk:
 *   ts-jest cannot compile the entire SDK transitive graph (pre-existing Zod
 *   schema TS errors in libs/shared block module resolution under jest). The
 *   CLI command modules statically import from `@ptah-extension/agent-sdk`,
 *   so each spec must `jest.mock` the package surface it actually touches.
 *
 * Why this util exists:
 *   `auth.spec.ts` and `settings.spec.ts` both stubbed an inline
 *   `ANTHROPIC_PROVIDERS` array of `{id: string}` shapes — duplicated across
 *   files, and the chosen IDs (`anthropic`, `copilot`, `codex`) didn't
 *   match the real registry IDs (`openrouter`, `moonshot`, `z-ai`,
 *   `github-copilot`, `openai-codex`, `ollama`, `ollama-cloud`,
 *   `lm-studio`, plus the virtual `anthropic` direct ID).
 *
 *   Centralizing here means:
 *     1. Both specs share one fixture, so registry shape drift surfaces in
 *        a single place.
 *     2. The fixture is type-anchored against the real
 *        `AnthropicProvider['id']` element type via `satisfies`, so a
 *        compile-time error fires if the registry shape changes in a way
 *        that breaks `.id` access.
 *     3. The IDs match the real registry, removing the misleading
 *        "virtual" stub IDs.
 *
 * Why only `.id` is populated:
 *   The only consumer reached by the spec call paths is
 *   `libs/backend/rpc-handlers/.../auth-rpc.schema.ts`, which evaluates
 *   `ANTHROPIC_PROVIDERS.map(p => p.id)` at module load to build a Zod
 *   enum. Other fields on `AnthropicProvider` (name, baseUrl, authEnvVar,
 *   …) are not touched in the CLI unit-test surface. Keeping the stub
 *   minimal documents that fact and avoids fabricating fake URLs / keys.
 *
 * If a future spec exercises code that reads richer provider fields, extend
 * `mockAnthropicProviders` (or add a sibling builder) rather than expanding
 * the inline mock again.
 */

import type { ANTHROPIC_PROVIDERS as RealRegistry } from '@ptah-extension/agent-sdk';

/**
 * Element type of the real registry. Importing it gives us a compile-time
 * anchor: if the registry shape ever changes such that `.id` is no longer a
 * `string`, the `satisfies` check below fails to compile.
 */
type RegistryElement = (typeof RealRegistry)[number];

/**
 * Minimal `{id}` projection of registry elements — what the auth-rpc Zod
 * schema actually consumes.
 */
type IdOnlyProvider = Pick<RegistryElement, 'id'>;

/**
 * Stable, real-registry-aligned IDs for use in `jest.mock` factories.
 *
 * Includes the virtual direct-Claude ID (`anthropic`) plus a representative
 * sample of registry IDs covering the auth-method branches the CLI exercises
 * (api-key providers, OAuth-style providers like copilot/codex). Not
 * exhaustive — adding more IDs is fine if a spec needs them, but keep them
 * matching the real registry to avoid drift.
 */
export function mockAnthropicProviders(): readonly IdOnlyProvider[] {
  return [
    // Virtual ID — direct Claude auth (OAuth / API key), not in the
    // registry array but accepted by the auth code paths via
    // `ANTHROPIC_DIRECT_PROVIDER_ID`.
    { id: 'anthropic' },
    // Real registry IDs:
    { id: 'openrouter' },
    { id: 'github-copilot' },
    { id: 'openai-codex' },
  ] as const satisfies readonly IdOnlyProvider[];
}
