# Test Report — TASK_2026_264

Pins TASK_2026_247's fix at the wiring level the unit specs mock out.

## Comprehensive Testing Scope

**User Request**: e2e coverage, in Electron, for TASK_2026_247's config-change
permission fix, with a real auth-provider switch to validate the fix live.

**What this closes**: TASK_2026_247 open item 4 — "the reproduction was
never run" — plus TASK_2026_262's live-tier-derivation path, both explicitly
scoped by `.ptah/specs/TASK_2026_264/context.md`.

**Out of scope (per context.md, unchanged)**: the live-model variant (real
agent turn against a local server). Not attempted here.

## The seam — what it is and why that shape

**Added**: `agent:e2eSeedPermission`, one new RPC method, co-located next to
the existing `agent:permissionResponse` in
`libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts`. It:

- Gated on `process.env['PTAH_E2E'] === '1'` — the flag
  `apps/ptah-electron-e2e/src/support/electron-launcher.ts` already sets for
  every e2e run and a real user's build never has. No-ops with
  `{success:false, error:'e2e-only'}` otherwise. This mirrors an existing
  precedent in the repo (`apps/ptah-extension-vscode/src/activation/bootstrap.ts`'s
  `PTAH_E2E`-gated license seed), not a pattern invented for this task.
- Resolves the REAL, DI-registered `SdkPermissionHandler` singleton from the
  container (the same lazy-resolution pattern `agent:permissionResponse`
  already uses) and calls its public `createCallback(sessionId, undefined,
tabId)(toolName, input, {signal, toolUseID})` — the exact entry point the
  SDK itself calls for every tool permission check, and the exact method the
  in-process unit specs (`sdk-permission-handler.spec.ts`,
  `session-lifecycle-manager-dispose.spec.ts`) already call directly. This
  method adds no new behavior to `SdkPermissionHandler` — it only gives an
  out-of-process Playwright test the same access point those Jest specs
  already have.
- Awaits the full round trip and returns `{success, behavior, message,
interrupt}` — the caller needs the actual resolved decision, not just "did
  it arrive", and that only exists once something resolves the request (a
  webview answer, a teardown, or the 60s unroutable-deny timeout).

**Did it need production code?** Yes, argued explicitly rather than smuggled
in: there is no existing way to reach the real `pendingRequests` map from
outside the Electron process except the RPC transport, and the constraint
list in context.md (real map, routable) rules out a fake substitute. The seam
is the smallest thing that satisfies both constraints: it invokes an
already-public method with already-public argument shapes; it does not
change what `SdkPermissionHandler` does, only who can call one of its
methods, and only when `PTAH_E2E=1`.

**Confirmed: no other production code changed.** `git diff` shows exactly two
production-code files touched, both purely additive:

- `libs/shared/src/lib/types/rpc.types.ts` — new `RpcMethodRegistry` /
  `RPC_METHOD_ENTRIES` entries for `agent:e2eSeedPermission` (the mandatory
  compile-time half of RPC dual-registration).
- `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts` — the
  handler above, plus its `METHODS` tuple / `register()` / log-list entries.

Everything else new is test-only, under `apps/ptah-electron-e2e/src/`:

- `src/support/permission-seam-fixtures.ts` (new) — extends
  `real-rpc-fixtures.ts`'s `test` (does not modify that file) with
  `PTAH_LOG_LEVEL=debug` on the launched app (a real, already-shipped env var
  — see `logger.ts`), a `stdoutLog` helper (plain Node `data` listener,
  independent of the one `electron-launcher.ts` installs), and a `messageLog`
  helper (a persistent `webContents.send` collector, installed once at the
  base of the patch chain so it cannot race `RpcBridge`'s own temporary
  patches — see the file's docblock for the full argument).
- `src/specs/permission/config-change-permission-survival.spec.ts` (new) —
  the two test cases below.

`apps/ptah-electron-e2e/src/support/ui-driver.ts` also carries a small
additive change from earlier in this session (`getObservedMessages` /
`waitForObservedMessage`, for the mocked-fixture `ask-user-question:response`
channel). It is not used by this task's spec or fixtures and is unrelated to
the permission-survival seam described above; noted for completeness, not
part of this deliverable.

## A real finding, reported rather than routed around

The first working draft of test 1 asserted `[ConfigWatcher] Configuration
changed` right after the `auth:saveSettings` RPC call and got a genuine
failure: that line never appeared. Tracing it — `auth:saveSettings` writes
`authMethod`/`anthropicProviderId` via `scopeResolver.write(...)`, then
unconditionally calls `await this.sdkAdapter.reset()`. `reset()` is
`dispose()` + `initialize()`, and `dispose()` itself calls
`disposeAllSessions()` **and** tears down `ConfigWatcher`
(`[ConfigWatcher] Disposed all watchers` — confirmed in the captured log) —
so for this specific RPC, sessions get disposed through the handler's own
explicit reset, not through the watcher's event bus, and the watcher is gone
before its own file-based `authMethod`/`anthropicProviderId` change (if it
would have fired at all) could react.

That is a real, if inert, gap in `auth:saveSettings`'s reachability of the
watcher path — reported here, not silently designed around. The fix: assert
"ConfigWatcher fired" against a trigger that cannot be confused with any
other cause — `auth:setApiKey`, which writes a `ptah.auth.*` secret via
`AuthSecretsService` and calls nothing else. That call, and only that call,
can reach `disposeAllSessions()` through `ConfigWatcher`'s
`secretStorage.onDidChange` path, and the captured log confirms it does:
`[ConfigWatcher] Configuration changed (ptah.auth.provider.lm-studio)` →
`[SdkAgentAdapter] Config change detected, re-initializing...` →
`[SessionLifecycle] Disposing all active sessions...`, all present, in order.
The provider switch (`auth:saveSettings`) is still the trigger for the scope
assertion — it is still a real, production, RPC-driven disposal, just proven
real via `[SessionLifecycle] Disposing all active sessions...` rather than
the watcher's own log line for that specific call.

## Test cases and which context.md assertions they cover

**Test 1** — `a pending permission on an unregistered session survives a real
provider switch and is still answerable; ConfigWatcher actually fired`
(16.6s in the final run):

- Assertion 3 (ConfigWatcher fired): proven in isolation via `auth:setApiKey`
  (see above), plus a placebo guard (`[SessionLifecycle] Disposing all active
sessions...`) on the `auth:saveSettings` step so that step, too, cannot
  pass by doing nothing.
- Assertion 1 (survives + answerable): seeds one permission via
  `agent:e2eSeedPermission` with a random, valid, ROUTABLE `sessionId` that
  is never registered in any `SessionRecord` (no chat session is ever
  started) — the shape TASK_2026_247 names hardest to catch: a background
  subagent or second-window request the disposing call's registry never held.
  A real `auth:saveSettings` provider switch to `lm-studio` runs; the request
  is then answered for real via the production `agent:permissionResponse`
  RPC, and the seed call's own eventual response — captured via
  `messageLog`, correlated by `correlationId` — resolves `behavior: 'allow'`,
  proving it was still pending and genuinely answerable, not merely
  unresolved by coincidence.
- Also covers TASK_2026_262: the captured log shows
  `[ProviderModelsService] Applied persisted tier mappings` and `Tiers
unresolved from static data — refreshing the live catalog` for `lm-studio`
  during this same switch — `lm-studio` declares no `defaultTiers`, so this
  is the live-derivation path, not the static map. This spec does not assert
  on that path's output (that is TASK_2026_262's own concern); it only
  confirms the same real switch exercises it, per context.md's Correction 2.

**Test 2** — `a genuinely disposed (unroutable) permission maps to a
system-abort message, not a canned user-denial` (1.2m in the final run):

- Assertion 2 (mapping): seeds a permission with no `sessionId`/`tabId`,
  which `SdkPermissionHandler.isRoutablePermissionRequest` classifies
  unroutable, arming the real 60s deny timeout
  (`UNROUTABLE_PERMISSION_TIMEOUT_MS`). Letting that timer actually fire is a
  genuine disposal Ptah performs on its own, not a fabrication, and it
  resolves through the identical `systemAbort` branch a real auth-change's
  `cleanupPendingPermissions()` call does. Asserts `interrupt: false`, the
  message contains "SYSTEM ABORT" and "NOT a user decision", and does NOT
  contain the hard-deny wording ("doesn't want to take this action").
- Deliberately NOT wired through the auth-change trigger — it needs no
  registered session and no auth switch, and the mapping logic under test
  (`sdk-permission-handler.ts`'s `systemAbort` branch) is identical either
  way. Costs ~60s of real wait; accepted as the price of a genuine disposal
  over a synthetic one.

## Revert-proof — the acceptance criterion

Reverted `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-control.service.ts`'s
`disposeAllSessions()` per-record loop back to the pre-TASK_2026_247
unconditional global sweep:

```ts
// before revert (current/fixed):
for (const rec of records) {
  this.permissionHandler.cleanupPendingPermissions(rec.tabId);
  if (rec.realSessionId && rec.realSessionId !== rec.tabId) {
    this.permissionHandler.cleanupPendingPermissions(rec.realSessionId);
  }
}
// after revert (pre-fix):
this.permissionHandler.cleanupPendingPermissions();
```

Rebuilt `ptah-electron:build-dev`, ran only this spec directly against that
build (`npx playwright test src/specs/permission/config-change-permission-survival.spec.ts`):

- **Test 1 (scope) — RED**, as required:
  `expect(seedResponse.data?.behavior).toBe('allow')` → `Expected: "allow",
Received: "deny"`. The orphaned permission — belonging to no session in the
  disposing registry — was denied by the reinstated global sweep, exactly the
  defect TASK_2026_247 fixed.
- **Test 2 (mapping) — stayed GREEN** (1.2m), as expected: it depends only on
  the independent unroutable-timeout branch in `sdk-permission-handler.ts`,
  untouched by this revert.

Restored `session-control.service.ts` immediately after
(`git diff` on that file is empty — confirmed). Rebuilt `ptah-electron:build-dev`
again and re-ran the full gate (below) to confirm both cases pass with the
real fix back in place.

## Gate numbers

`nx run ptah-electron-e2e:e2e` (full suite, fix restored, final run):

```
13 skipped
143 passed (24.0m)
Successfully ran target e2e for project ptah-electron-e2e and 2 tasks it depends on
```

Both new tests present and green in that run:

```
ok  66  .../config-change-permission-survival.spec.ts:39:7  ... ConfigWatcher actually fired  (16.6s)
ok  67  .../config-change-permission-survival.spec.ts:204:7 ... system-abort message ...       (1.2m)
```

The 13 skipped are pre-existing, environment-conditional skips unrelated to
this change (e.g. `git-watcher.spec.ts`'s watcher-timing cases observed
skipping in earlier runs too, before any of this task's edits existed on
disk). The rest of the suite (141 other tests) is unmodified in behaviour —
no other spec file was touched.

An earlier full-suite attempt, run before the ConfigWatcher-trigger fix
above, failed with exactly one red test (this spec's test 1, on the wrong
assumption about which RPC call produces the watcher's log line) — recorded
here for the timeline, not as a current gate result; superseded by the clean
143-passed run above.

## Not verified — named explicitly

- **VS Code and CLI hosts.** This is an Electron-only e2e; the fix is
  runtime-agnostic (`session-control.service.ts` has no Electron-specific
  code), but this task did not run an equivalent check under
  `ptah-extension-vscode-e2e` or the CLI.
- **`openrouter` as the provider.** Not tried — `lm-studio` satisfied both
  the hermetic and live-tier-derivation requirements from context.md, so the
  `openrouter` fallback (needs a real key) was not needed.
- **The live-model variant.** Explicitly out of scope per context.md; not
  attempted.
- **Whether `auth:saveSettings`'s watcher-bypass (the finding above) is
  itself a defect worth fixing.** Reported as an observation, not diagnosed
  further or filed as its own item — TASK_2026_247's fix behaves correctly
  regardless of which of the two real paths reaches it, so nothing in this
  task's acceptance criteria required chasing it further.
