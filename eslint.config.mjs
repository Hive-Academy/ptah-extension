import nx from '@nx/eslint-plugin';

/**
 * Message-constant restrictions applied everywhere. Kept in a const because
 * flat config replaces (rather than merges) a rule's options per file match,
 * so the apps-scoped block below must re-state them alongside its own.
 *
 * EXPORTED because that same replacement semantic applies across files:
 * `libs/web/members/eslint.config.mjs` narrows `no-restricted-syntax` for its
 * own `**\/*.ts` and would otherwise silently drop these two selectors for that
 * lib. ESLint only reads the default export, so a named export alongside it
 * changes nothing about how this config is loaded.
 */
export const MESSAGE_LITERAL_SELECTORS = [
  {
    selector:
      "CallExpression[callee.property.name='postStrictMessage'][arguments.0.type='Literal']",
    message:
      'Use MESSAGE_TYPES constants instead of string literals for message types. Import from @ptah-extension/shared.',
  },
  {
    selector:
      "CallExpression[callee.property.name='publish'][arguments.0.type='Literal']",
    message:
      'Use MESSAGE_TYPES constants instead of string literals for event types. Import from @ptah-extension/shared.',
  },
];

/**
 * RPC handler classes are library code. An app that declares one re-opens the
 * per-host duplication TASK_2026_171 removed: the class is invisible to the
 * manifest, so no other host can serve it and no capability gates it.
 *
 * The files below are the families still awaiting the P3 move into
 * `libs/backend/rpc-handlers`. Each migration deletes its entry; when the list
 * is empty the exception can go with it.
 */
const APP_LOCAL_RPC_HANDLERS_PENDING_MIGRATION = [
  'apps/ptah-extension-vscode/src/services/rpc/handlers/editor-rpc.handlers.ts',
  'apps/ptah-extension-vscode/src/services/rpc/handlers/file-rpc.handlers.ts',
  'apps/ptah-electron/src/services/rpc/handlers/editor-rpc.handlers.ts',
];

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: [
      '**/dist',
      '**/.vscode-test/**',
      // ptah-video-studio transient artifacts: Remotion bundle output, the
      // whisper.cpp binary/model cache, and rendered mp4 output. All are
      // generated/downloaded (gitignored) and must never be linted.
      'apps/ptah-video-studio/build/**',
      'apps/ptah-video-studio/.whisper/**',
      'apps/ptah-video-studio/out/**',
      'apps/ptah-video-studio/.remotion/**',
      // Transient developer scratch. Mutation-testing a fix means copying a
      // source file, stubbing it out, running the spec and restoring it, and
      // scratch render/bundle harnesses land beside the code they drive. Both
      // exist for seconds to minutes inside one working tree — but the
      // pre-commit hook runs `nx affected --target=lint` across the WHOLE
      // workspace, so anyone else committing during that window inherits
      // thousands of errors from a file that is about to be deleted and that
      // is none of their business. Their finished commit dies for it.
      //
      // The scratch pattern is anchored to an explicit `tmp-scratch-` marker
      // rather than a bare `tmp-` prefix. `tmp-` is a plausible name for real
      // code and it already collided: it silently un-linted the tracked
      // apps/ptah-cli/tests/e2e/_harness/tmp-home.ts, whose containment check
      // is exactly the kind of logic that must stay under lint. Name a scratch
      // harness `tmp-scratch-*` and it is ignored; anything else is source.
      '**/*.bak',
      '**/tmp-scratch-*.{mjs,cjs,js,jsx,ts,tsx}',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      // Strict 'error' severity (TASK_2026_103 W5 + F4). Both scope:*
      // and type:* constraints are clean after retagging
      // @ptah-extension/rpc-handlers from type:util to type:feature
      // (matches its actual role as an RPC orchestration feature).
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'],
          // TASK_2026_187 Unit 5. These libs are lazy-loaded by the webview
          // composition root via `import('@ptah-extension/<lib>')`, but their
          // `MESSAGE_HANDLERS` services MUST stay eager to receive push
          // messages at bootstrap (invariant I-3). The narrow `/services`
          // subpath is a SEPARATE entry point that exports no components, so
          // importing it statically does not defeat the split — measured at
          // -126,834 B (tasks-ui) and -40,694 B (harness-builder) of initial
          // bundle. Nx's check is project-granular and cannot see that.
          //
          // Only the `/services` subpaths are exempt. A static import of the
          // BARE barrel (`@ptah-extension/tasks-ui`) still errors, which is
          // exactly the regression guard we want: it is how an eager consumer
          // would silently pull the whole lib back into the initial bundle.
          checkDynamicDependenciesExceptions: [
            '@ptah-extension/tasks-ui/services',
            '@ptah-extension/harness-builder/services',
          ],
          depConstraints: [
            {
              sourceTag: 'scope:shared',
              onlyDependOnLibsWithTags: ['scope:shared'],
            },
            {
              sourceTag: 'scope:extension',
              onlyDependOnLibsWithTags: ['scope:shared', 'scope:extension'],
            },
            {
              sourceTag: 'scope:webview',
              onlyDependOnLibsWithTags: ['scope:shared', 'scope:webview'],
            },
            {
              // The landing app is being decomposed into libs/web/* (scope:web)
              // by tools/migration. Until the app is fully emptied it consumes
              // both the legacy in-app code and the extracted web domains.
              sourceTag: 'scope:landing',
              onlyDependOnLibsWithTags: [
                'scope:shared',
                'scope:landing',
                'scope:web',
                'scope:api-contracts',
              ],
            },
            // --- domain-extraction scopes (tools/migration) -------------
            // libs/web/*  (@ptah-web/*) — Angular domains carved out of the
            // landing app. They may talk to each other and to the shared
            // HTTP contracts, never to a server-side lib.
            {
              sourceTag: 'scope:web',
              onlyDependOnLibsWithTags: [
                'scope:shared',
                'scope:web',
                'scope:api-contracts',
              ],
            },
            // The license server (its own `scope:app` tag) is being decomposed
            // into libs/api/* by tools/migration. Until it is fully emptied it
            // consumes both its remaining in-app code and the api domains.
            {
              sourceTag: 'scope:app',
              onlyDependOnLibsWithTags: [
                'scope:shared',
                'scope:api',
                'scope:api-contracts',
              ],
            },
            // libs/api/* (@ptah-api/*) — NestJS domains carved out of the
            // license server.
            {
              sourceTag: 'scope:api',
              onlyDependOnLibsWithTags: [
                'scope:shared',
                'scope:api',
                'scope:api-contracts',
              ],
            },
            // libs/api-contracts/* (@ptah-contracts/*) — the wire contract
            // between scope:web and scope:api. Depends on nothing but itself.
            {
              sourceTag: 'scope:api-contracts',
              onlyDependOnLibsWithTags: ['scope:api-contracts'],
            },
            {
              sourceTag: 'scope:electron',
              onlyDependOnLibsWithTags: [
                'scope:shared',
                'scope:electron',
                'scope:extension',
              ],
            },
            {
              sourceTag: 'scope:cli',
              onlyDependOnLibsWithTags: [
                'scope:shared',
                'scope:cli',
                'scope:extension',
              ],
            },
            // e2e harnesses drive the runtime apps and consume shared
            // contracts (e.g. @ptah-extension/showcase-manifest). Without
            // this entry, scope:e2e matches no sourceTag and any workspace
            // import trips projectWithoutTagsCannotHaveDependencies.
            {
              sourceTag: 'scope:e2e',
              onlyDependOnLibsWithTags: ['scope:shared', 'scope:e2e'],
            },
            {
              sourceTag: 'type:application',
              onlyDependOnLibsWithTags: [
                'type:feature',
                'type:data-access',
                'type:ui',
                'type:util',
              ],
            },
            // type:* import direction (TASK_2026_103 W5 + F4).
            // Enforced as 'error' after rpc-handlers was retagged
            // type:feature (F4) — no remaining violations.
            {
              sourceTag: 'type:app',
              onlyDependOnLibsWithTags: [
                'type:feature',
                'type:data-access',
                'type:ui',
                'type:util',
                'type:core',
              ],
            },
            {
              sourceTag: 'type:feature',
              onlyDependOnLibsWithTags: [
                'type:feature',
                'type:data-access',
                'type:ui',
                'type:util',
                'type:core',
              ],
            },
            {
              sourceTag: 'type:data-access',
              onlyDependOnLibsWithTags: ['type:data-access', 'type:util'],
            },
            {
              sourceTag: 'type:ui',
              onlyDependOnLibsWithTags: ['type:ui', 'type:util'],
            },
            {
              sourceTag: 'type:util',
              onlyDependOnLibsWithTags: ['type:util'],
            },
            {
              sourceTag: 'type:core',
              onlyDependOnLibsWithTags: ['type:core', 'type:util'],
            },
            // e2e is an application-level consumer (mirrors type:app): it may
            // depend on feature/data-access/ui/util/core libs it exercises.
            {
              sourceTag: 'type:e2e',
              onlyDependOnLibsWithTags: [
                'type:feature',
                'type:data-access',
                'type:ui',
                'type:util',
                'type:core',
              ],
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.cts',
      '**/*.mts',
      '**/*.js',
      '**/*.jsx',
      '**/*.cjs',
      '**/*.mjs',
    ],
    // Override or add rules here
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-empty-function': ['warn'],
    },
  },
  {
    files: ['**/*.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...MESSAGE_LITERAL_SELECTORS],
    },
  },
  {
    /**
     * File-size ceiling (TASK_2026_268). `skill-synthesis.service.ts` grew
     * 906 -> 2027 lines with nothing in the repo to flag it. This is the
     * tripwire, not a sweep: 137 files already sit over 700 lines and 50
     * over 1000 (measured 2026-08-17, see .ptah/specs/TASK_2026_268/context.md),
     * so this MUST stay 'warn' — an 'error' here blocks every commit in the
     * workspace and gets reverted within a day. The pre-commit hook runs
     * `nx affected --target=lint --max-warnings=-1`, which does not fail on
     * warnings, so the existing 137 keep committing while new growth gets a
     * visible nudge. See CLAUDE.md "Coding Standards" for the accompanying
     * facade rule and guardrails against fragment sprawl.
     *
     * Scope is `**\/*.ts` only — the exact population the 700/1000 figures
     * above were measured against (2681 files). `.tsx` (Ink TUI components)
     * was not part of that measurement and is deliberately left out rather
     * than silently widening the ceiling to an unmeasured population.
     *
     * `*.spec.ts` is excluded: a long spec is usually parameterized cases or
     * fixture data, not a buried concern, and a warning there is noise
     * against files nobody is trying to keep small.
     *
     * `generated-prisma-client/**` is excluded: generated code has no author
     * to hand the warning to.
     *
     * `skipComments: true` because this codebase documents WHY at length
     * (see any CLAUDE.md in libs/backend) — counting comment lines against a
     * class that earns its comments would push teams to delete the
     * explanation instead of shrinking the code. `skipBlankLines: true`
     * because blank lines are formatting, not a signal of size or
     * complexity, and counting them would make the same file trip or clear
     * the ceiling purely based on how it happens to be spaced.
     */
    files: ['**/*.ts'],
    ignores: [
      '**/*.spec.ts',
      '**/*.d.ts',
      'libs/api/core/src/lib/generated-prisma-client/**',
    ],
    rules: {
      'max-lines': [
        'warn',
        { max: 700, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  {
    files: ['apps/**/*.ts'],
    ignores: APP_LOCAL_RPC_HANDLERS_PENDING_MIGRATION,
    rules: {
      'no-restricted-syntax': [
        'error',
        ...MESSAGE_LITERAL_SELECTORS,
        {
          selector: 'ClassDeclaration[id.name=/RpcHandlers$/]',
          message:
            'RPC handler classes belong in libs/backend/rpc-handlers with a RPC_HANDLER_MANIFEST entry, not in an app. Apps ship only their rpc-host-profile.ts.',
        },
      ],
    },
  },
];
