import baseConfig, {
  MESSAGE_LITERAL_SELECTORS,
} from '../../../eslint.config.mjs';

/**
 * Lint posture for `@ptah-extension/skill-synthesis` (TASK_2026_180 B1.5.5 —
 * risk R1).
 *
 * ## The one thing this file exists to stop
 *
 * A background lane repointing the user's LIVE chat session mid-conversation.
 * `ProviderModelsService` has two global-mutating methods and they are not
 * equally dangerous:
 *
 *  - `setModelTier` (`provider-models.service.ts:495-500`) guards its
 *    `process.env` / `AuthEnv` writes with `scope === 'mainAgent'`, so a lane
 *    calling it with `scope: 'lane'` happens to be inert TODAY. "Happens to be
 *    inert" is not a contract — the guard is one refactor away from moving.
 *  - `applyPersistedTiers` (`:617-643`) has **no scope guard at all**. It writes
 *    `this.authEnv[k]` AND `process.env[k]` unconditionally. One call from a
 *    background lane silently retargets the foreground conversation, and there
 *    is no error, no log and no test failure anywhere near the call site.
 *
 * `lane-runner.env-immutability.spec.ts` is the behavioural guard: it snapshots
 * `process.env` and the injected `AuthEnv` byte-for-byte around a full lane run.
 * But a spec only covers the paths it exercises, and R1 arrives as a plausible
 * one-line "just refresh the tiers first" in a path nobody thought to snapshot.
 * This rule covers the paths the spec does not.
 *
 * ## Why it is scoped to this lib, not workspace-wide
 *
 * Both methods are legitimate — `agent-sdk` and the settings surfaces call them
 * on purpose, which is how a user's chosen tier reaches the SDK at all. They are
 * banned HERE because this is the library whose every LLM call is background
 * work running beside a live foreground session. The rule belongs where the
 * hazard is, not everywhere the method exists.
 *
 * ## Why identifiers, not just call expressions
 *
 * `MemberExpression[property.name=...]` would miss `const { setModelTier } =
 * svc`, an aliased re-export, and a method the lib defines under the same name
 * to "wrap" it — each of which reaches the same write. Banning the IDENTIFIER
 * and the string LITERAL together means every syntactic route to the name is a
 * lint error, including `svc['applyPersistedTiers']()` and a name passed to
 * `container.resolve`. Comments are not AST nodes, so the several file headers
 * in this lib that explain the hazard by name stay legal — which is the point:
 * the rule must not make the reasoning undocumentable.
 */
const GLOBAL_MUTATING_METHODS = [
  {
    name: 'applyPersistedTiers',
    why: 'it writes `this.authEnv[k]` AND `process.env[k]` unconditionally, with NO scope guard (provider-models.service.ts:617-643)',
  },
  {
    name: 'setModelTier',
    why: 'its `scope === "mainAgent"` guard is the only thing making it inert for lanes, and this library must not depend on that guard staying put (provider-models.service.ts:495-500)',
  },
];

const remedy =
  'A lane gets its credentials as a SNAPSHOT: `LaneResolverService` asks the shared `IProviderAuthResolver` for a `scope: "lane"` override and `LaneRunnerService` forwards it as `input.auth`. Nothing in this library may write global auth state. See lanes/lane-runner.service.ts and lane-runner.env-immutability.spec.ts (P1-5).';

const globalMutationSelectors = GLOBAL_MUTATING_METHODS.flatMap(
  ({ name, why }) => {
    const message = `\`${name}\` must never be referenced from @ptah-extension/skill-synthesis (risk R1): ${why}. Calling it from a background lane repoints the user's live chat session mid-conversation, with no error and no visible failure. ${remedy}`;
    return [
      { selector: `Identifier[name='${name}']`, message },
      { selector: `Literal[value='${name}']`, message },
    ];
  },
);

export default [
  ...baseConfig,
  {
    files: ['**/*.ts'],
    rules: {
      /**
       * MESSAGE_LITERAL_SELECTORS is re-stated because flat config REPLACES a
       * rule's options rather than merging them — omitting it here would
       * silently switch the workspace-wide message-constant restrictions off
       * for this whole library.
       */
      'no-restricted-syntax': [
        'error',
        ...MESSAGE_LITERAL_SELECTORS,
        ...globalMutationSelectors,
      ],

      /**
       * The import-level half. `skill-synthesis` keeps ZERO direct SDK imports
       * (global invariant 3) and mirrors `IInternalQuery` / `LaneAuthOverride`
       * locally, so an import of the class that OWNS these two methods is
       * already wrong twice over. Named here anyway: a value import of
       * `ProviderModelsService` is the shortest route to the hazard, and a
       * banned import is a clearer error than the module-boundary violation it
       * would otherwise surface as.
       */
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@ptah-extension/agent-sdk',
              importNames: ['ProviderModelsService'],
              message: `ProviderModelsService owns the two global-mutating tier methods (risk R1). ${remedy}`,
            },
          ],
        },
      ],
    },
  },
];
