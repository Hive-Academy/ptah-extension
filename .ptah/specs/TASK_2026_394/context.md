# TASK_2026_394 — undeclared runtime imports in the published CLI

## Evidence

Found while auditing every project for the defect class behind the 2026-09-04
outage (TASK_2026_392). Method: run `collectExternalImports` from
`apps/ptah-electron/scripts/lib/bundle-imports.js` over
`dist/apps/ptah-cli/main.mjs` and `dist/apps/ptah-cli/tui.mjs`, then compare
against `apps/ptah-cli/package.json`.

The counts match at 37 external imports and 37 declared dependencies. **They are
not the same 37.** Three imports are undeclared:

| Package        | Import site                                                | Verdict       |
| -------------- | ---------------------------------------------------------- | ------------- |
| `@cursor/sdk`  | `cli-agent-runtime/.../cursor-cli.adapter.ts:160`          | **defect**    |
| `@sentry/node` | `vscode-core/src/services/sentry.service.ts:32`            | **defect**    |
| `keytar`       | `platform-cli/src/settings/cli-master-key-provider.ts:159` | correct as-is |

## Why it is invisible here

Both defective packages are in the **root** `dependencies`, so they resolve in
this workspace. `ptah-electron` declares both in its own `package.json`, so they
resolve there too. The failure appears only for a user who ran
`npm i -g @hive-academy/ptah-cli`, where the root manifest does not exist.

## `@cursor/sdk` — the higher-severity one

```ts
async function getCursorSdk(): Promise<CursorSdkModule> {
  if (cursorSdkModule) {
    return cursorSdkModule;
  }
  const mod = (await import('@cursor/sdk')) as unknown as CursorSdkModule;
  ...
}
```

No `catch`. A published-CLI user who selects the Cursor adapter gets an
unhandled `ERR_MODULE_NOT_FOUND`.

The comment above it is also wrong and should be corrected:

> The string literal in import() lets esbuild statically bundle the package.

The scan shows `@cursor/sdk` is an **external** import in `main.mjs`, not
bundled. A comment asserting a safety property that does not hold is worse than
no comment — it stops the next reader from checking.

## `@sentry/node`

`require('@sentry/node')` inside `SentryService.initialize`, guarded only by
`if (!options.dsn) return;`. It throws whenever a DSN is configured.

## `keytar` is not a defect

```ts
const kt = await import('keytar').catch(() => null);
```

Explicitly guarded with a fallback, and a documented optional capability — see
the `// degradation-audit: optional-capability` convention in the `vscode-core`
CLAUDE.md. It is correctly absent from every manifest. Do not "fix" it.

## Acceptance criteria

1. `apps/ptah-cli/package.json` declares `@cursor/sdk` and `@sentry/node` at the
   versions the root lockfile resolves.
2. `keytar` stays undeclared.
3. The misleading bundling comment in `cursor-cli.adapter.ts` is corrected to
   state what actually happens.
4. Reproduced before the fix and verified after: install the packed tarball into
   a clean directory outside this repository, select the Cursor adapter, and
   confirm `ERR_MODULE_NOT_FOUND` before and a working adapter after.
5. Consider whether `getCursorSdk` should also fail gracefully. A missing
   optional vendor SDK arguably deserves a clear message rather than a raw
   module error, but that is a judgement call for the implementer to justify
   either way.

## Release note

The CLI ships on `publish-cli.yml`, a different release train from the license
server. This must not ride along with a license-server deploy.
