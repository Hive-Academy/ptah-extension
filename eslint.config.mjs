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
 * No recursive file-system watching in a host's main process (TASK_2026_437
 * INV-1). On 2026-09-14 a recursive `fs.watch` over the workspace delivered
 * one JavaScript callback per event to the Electron main thread while ten agent
 * worktrees were deleted, and the app froze. Recursive workspace watching goes
 * through `IWorkspaceWatcher` (`PLATFORM_TOKENS.WORKSPACE_WATCHER`), which runs
 * the native watcher in a supervised host process and hands main coalesced
 * batches.
 *
 * Two halves, so an exemption can lift one without the other:
 * - {@link RECURSIVE_FS_WATCH_SELECTORS} — `fs.watch(…, { recursive })`,
 *   `watch(…, { recursive })` (from `fs`, `node:fs` or `fs/promises`), and
 *   `require('fs').watch(…, { recursive })`, unless the option is the literal
 *   `false`. Renaming `watch` on import or destructure is flagged too, because
 *   a renamed call is invisible to the call selectors.
 * - {@link CHOKIDAR_LOAD_SELECTORS} — every way of loading `chokidar`: a static
 *   import, `import()` and `require()`.
 *
 * LIMIT, stated once: this is a syntax rule. An options object passed through a
 * variable (`const o = { recursive: true }; fs.watch(dir, o)`) or a `watch`
 * reached through an alias of the module (`const w = fs.watch`) cannot be seen
 * without type information. It is a strong tripwire, not a proof of INV-1; the
 * stress specs and code review carry the rest.
 *
 * EXPORTED for the same reason as {@link MESSAGE_LITERAL_SELECTORS}: a lib
 * config that re-states `no-restricted-syntax` for its own files replaces these
 * selectors unless it spreads them too.
 */
const RECURSIVE_FS_WATCH_MESSAGE =
  'No recursive fs.watch in a host process (TASK_2026_437 INV-1). Subscribe through IWorkspaceWatcher (PLATFORM_TOKENS.WORKSPACE_WATCHER), which watches in a supervised host and delivers batches.';
const RENAMED_FS_WATCH_MESSAGE =
  "Import fs watch under its own name (TASK_2026_437 INV-1): the lint rule against recursive watching in a host process only sees calls named 'watch'.";
const CHOKIDAR_MESSAGE =
  'chokidar is confined to the platform file-system providers (TASK_2026_437 INV-1). Recursive watching goes through IWorkspaceWatcher; a scoped watch through IFileSystemProvider.createFileWatcher.';
const FS_MODULE = '/^(node:)?fs(\\u002Fpromises)?$/';

export const RECURSIVE_FS_WATCH_SELECTORS = [
  {
    // `fs.watch(…)`, `fsp.watch(…)`, `require('fs').watch(…)`.
    selector:
      "CallExpression[callee.property.name='watch'] > ObjectExpression > Property[key.name='recursive']:not([value.value=false])",
    message: RECURSIVE_FS_WATCH_MESSAGE,
  },
  {
    // `import { watch } from 'fs'|'node:fs'|'fs/promises'` then `watch(…)`.
    selector:
      "CallExpression[callee.name='watch'] > ObjectExpression > Property[key.name='recursive']:not([value.value=false])",
    message: RECURSIVE_FS_WATCH_MESSAGE,
  },
  {
    // `import { watch as w } from 'node:fs'`.
    selector: `ImportDeclaration[source.value=${FS_MODULE}] > ImportSpecifier[imported.name='watch'][local.name!='watch']`,
    message: RENAMED_FS_WATCH_MESSAGE,
  },
  {
    // `const { watch: w } = require('fs')`.
    selector: `VariableDeclarator[init.callee.name='require'][init.arguments.0.value=${FS_MODULE}] > ObjectPattern > Property[key.name='watch'][value.name!='watch']`,
    message: RENAMED_FS_WATCH_MESSAGE,
  },
];

export const CHOKIDAR_LOAD_SELECTORS = [
  {
    selector: "ImportDeclaration[source.value='chokidar']",
    message: CHOKIDAR_MESSAGE,
  },
  {
    selector: "ImportExpression[source.value='chokidar']",
    message: CHOKIDAR_MESSAGE,
  },
  {
    selector:
      "CallExpression[callee.name='require'][arguments.0.value='chokidar']",
    message: CHOKIDAR_MESSAGE,
  },
];

export const IN_MAIN_RECURSIVE_WATCH_SELECTORS = [
  ...RECURSIVE_FS_WATCH_SELECTORS,
  ...CHOKIDAR_LOAD_SELECTORS,
];

/**
 * Where a half of {@link IN_MAIN_RECURSIVE_WATCH_SELECTORS} does not apply.
 * Each file keeps every other selector its blocks set; only the named half is
 * lifted.
 */
const CHOKIDAR_ALLOWED = [
  // By design: the Electron and CLI file-system providers own chokidar for the
  // scoped `IFileSystemProvider.createFileWatcher`.
  'libs/backend/platform-electron/src/implementations/*file-system-provider.ts',
  'libs/backend/platform-cli/src/implementations/*file-system-provider.ts',
];
const FS_WATCH_AND_CHOKIDAR_ALLOWED = [
  // By design: the watch-host entries run in their own process.
  'libs/backend/platform-electron/src/workspace-watch/*.entry.ts',
  'libs/backend/platform-cli/src/workspace-watch/*.entry.ts',
];
const RECURSIVE_FS_WATCH_ALLOWED_APP_TS = [
  // FU-11 e2e git-watcher spec. A Playwright spec evaluating a raw recursive
  // `fs.watch` inside the test app's main process to probe OS delivery. It
  // mirrors the in-process workspace watcher TASK_2026_437 Batch 11 removed
  // from `GitWatcherService`; it runs only under e2e and is to be rewritten
  // against the watch host or deleted (orchestrator follow-up FU-11).
  'apps/ptah-electron-e2e/src/specs/git-watcher.spec.ts',
];
const RECURSIVE_FS_WATCH_ALLOWED_JS = [
  // Dev build tooling: `electron:serve` mirrors the renderer build output with
  // a recursive watch in its own Node process, never inside the app.
  'apps/ptah-electron/scripts/watch-renderer.js',
];

/** Apps ship no RPC handler classes; see {@link APP_LOCAL_RPC_HANDLERS_PENDING_MIGRATION}. */
const APP_RPC_HANDLER_CLASS_SELECTOR = {
  selector: 'ClassDeclaration[id.name=/RpcHandlers$/]',
  message:
    'RPC handler classes belong in libs/backend/rpc-handlers with a RPC_HANDLER_MANIFEST entry, not in an app. Apps ship only their rpc-host-profile.ts.',
};

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
  'apps/ptah-extension-vscode/src/services/rpc/handlers/file-rpc.handlers.ts',
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
          // Only NARROW subpaths are exempt. A static import of the BARE
          // barrel (`@ptah-extension/tasks-ui`) still errors, which is exactly
          // the regression guard we want: it is how an eager consumer would
          // silently pull the whole lib back into the initial bundle.
          //
          // `@ptah-extension/marketplace/harness` (TASK_2026_306 Batch 11) is
          // the one exemption that is not a `/services` barrel. It exports one
          // leaf presentational component and one pure function so the eager
          // `DashboardGridComponent` can render the blocked-paths disclosure
          // without re-implementing it — same rule, same measurement
          // discipline, different kind of export. It exports no surface and no
          // hub, so it does not defeat the split either.
          checkDynamicDependenciesExceptions: [
            '@ptah-extension/tasks-ui/services',
            '@ptah-extension/harness-builder/services',
            '@ptah-extension/marketplace/services',
            '@ptah-extension/marketplace/harness',
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
      // TASK_2026_383 component 4 evidence: only 9 empty catches repo-wide,
      // 7 of them in specs and the 2 production ones inside detector
      // fixtures in workspace-intelligence's own error-handling-rules.ts.
      // Nearly free, nearly pointless as a standalone gate — the real
      // inventory is tools/degradation-audit's ratchet below, not this rule.
      'no-empty': ['error', { allowEmptyCatch: false }],
    },
  },
  {
    files: ['**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...MESSAGE_LITERAL_SELECTORS,
        ...IN_MAIN_RECURSIVE_WATCH_SELECTORS,
      ],
    },
  },
  {
    files: [
      '**/*.tsx',
      '**/*.cts',
      '**/*.mts',
      '**/*.js',
      '**/*.jsx',
      '**/*.cjs',
      '**/*.mjs',
    ],
    rules: {
      'no-restricted-syntax': ['error', ...IN_MAIN_RECURSIVE_WATCH_SELECTORS],
    },
  },
  // `@typescript-eslint/no-floating-promises` was evaluated here and
  // rejected — see `implementation-plan.md` component 4's "Rejected
  // alternatives" and TASK_2026_383 batch-3-report.md for the measurement.
  // `projectService: true` scoped to `apps/ptah-electron/src/**`,
  // `libs/backend/thoth-runtime/src/**`, `libs/backend/persistence-sqlite/src/**`
  // took ~70s to type-check ptah-electron's `src/` alone (measured
  // 2026-09-06) AND failed outright on every `*.spec.ts` in that tree
  // ("was not found by the project service") because
  // `apps/ptah-electron/tsconfig.json` references only `tsconfig.app.json`,
  // never `tsconfig.spec.json`. The plan's own contingency for this exact
  // outcome is the AST selector in `tools/degradation-audit` instead — see
  // the `floating-promise` pattern there, scoped to the same three
  // directories without needing type information or a project rebuild.
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
        ...IN_MAIN_RECURSIVE_WATCH_SELECTORS,
        APP_RPC_HANDLER_CLASS_SELECTOR,
      ],
    },
  },
  // Last, so they replace the `no-restricted-syntax` options the blocks above
  // set for these files: only the named half of the watch rule is lifted.
  {
    files: CHOKIDAR_ALLOWED,
    rules: {
      'no-restricted-syntax': [
        'error',
        ...MESSAGE_LITERAL_SELECTORS,
        ...RECURSIVE_FS_WATCH_SELECTORS,
      ],
    },
  },
  {
    files: FS_WATCH_AND_CHOKIDAR_ALLOWED,
    rules: {
      'no-restricted-syntax': ['error', ...MESSAGE_LITERAL_SELECTORS],
    },
  },
  {
    files: RECURSIVE_FS_WATCH_ALLOWED_APP_TS,
    rules: {
      'no-restricted-syntax': [
        'error',
        ...MESSAGE_LITERAL_SELECTORS,
        ...CHOKIDAR_LOAD_SELECTORS,
        APP_RPC_HANDLER_CLASS_SELECTOR,
      ],
    },
  },
  {
    files: RECURSIVE_FS_WATCH_ALLOWED_JS,
    rules: {
      'no-restricted-syntax': ['error', ...CHOKIDAR_LOAD_SELECTORS],
    },
  },
];
