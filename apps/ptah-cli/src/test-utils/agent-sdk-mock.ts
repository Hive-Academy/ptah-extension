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
 *   The consumers reached by the spec call paths only read `.id`:
 *   `auth.ts`'s did-you-mean list (`getAllAnthropicProviders().map(p => p.id)`)
 *   and `auth-rpc.schema.ts`'s provider-id refinement. Other fields on
 *   `AnthropicProvider` (name, baseUrl, authEnvVar, …) are not touched in the
 *   CLI unit-test surface. Keeping the stub minimal documents that fact and
 *   avoids fabricating fake URLs / keys.
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
    { id: 'anthropic' },
    { id: 'openrouter' },
    { id: 'github-copilot' },
    { id: 'openai-codex' },
  ] as const satisfies readonly IdOnlyProvider[];
}

/**
 * Stub of the merged-registry accessors the real barrel exports
 * (TASK_2026_236). `getAllAnthropicProviders()` replaced the direct
 * `ANTHROPIC_PROVIDERS` iteration in `auth.ts`; `getAnthropicProvider()` backs
 * the `auth-rpc.schema.ts` provider-id refinement. Both resolve against the
 * same fixture so a spec cannot see one list from one accessor and a different
 * list from the other.
 */
export function mockProviderRegistryAccessors(): {
  ANTHROPIC_PROVIDERS: readonly IdOnlyProvider[];
  getAllAnthropicProviders: () => readonly IdOnlyProvider[];
  getAnthropicProvider: (id: string) => IdOnlyProvider | undefined;
} {
  const providers = mockAnthropicProviders();
  return {
    ANTHROPIC_PROVIDERS: providers,
    getAllAnthropicProviders: () => providers,
    getAnthropicProvider: (id: string) => providers.find((p) => p.id === id),
  };
}

/**
 * Mirror of the real `ALL_TIER_ENV_KEYS` (`agent-sdk`
 * `helpers/sdk-model-service.ts`) — the three tier `_MODEL` vars plus the three
 * metadata vars that ride alongside each.
 *
 * Why a spec that never mentions tier env vars still needs this: any spec whose
 * command statically imports `@ptah-extension/cli-engine` drags in
 * `auth-providers`' barrel → `di/register.ts` → `curator-auth-resolver.ts`,
 * which SPREADS this constant at module scope. A virtual agent-sdk mock that
 * omits it makes that spread throw `is not iterable` before a single test runs,
 * and the failure surfaces as "Test suite failed to run" with a stack pointing
 * at library code the spec has nothing to do with.
 *
 * Keep this list in step with the real constant. It is a fixture, not an
 * assertion target — nothing reads the values, but the spread needs a real
 * iterable.
 */
export function mockAllTierEnvKeys(): readonly string[] {
  return [
    'ANTHROPIC_DEFAULT_OPUS_MODEL',
    'ANTHROPIC_DEFAULT_SONNET_MODEL',
    'ANTHROPIC_DEFAULT_HAIKU_MODEL',
    'ANTHROPIC_DEFAULT_OPUS_MODEL_NAME',
    'ANTHROPIC_DEFAULT_OPUS_MODEL_DESCRIPTION',
    'ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES',
    'ANTHROPIC_DEFAULT_SONNET_MODEL_NAME',
    'ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION',
    'ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES',
    'ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME',
    'ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION',
    'ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES',
  ];
}
