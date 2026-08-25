# TASK_2026_264 — context

## Where this came from

User proposal, 2026-08-16: "why don't we make this with e2e and test with
electron, it should have different auth providers like claude and codex and
ollama so you can switch and validate your work."

The instinct is right and the harness is well suited. Two parts of the framing
changed under investigation, and the corrections are the useful part of this
file.

## Why e2e, specifically

TASK_2026_247's open item 4 says the reproduction "was never run", and its
verification note says the fix is pinned by unit specs rather than by the live
auth-change. That is the whole gap. The unit specs prove real things —
`session-lifecycle-manager-dispose.spec.ts` pins the cleanup SCOPE and
`sdk-permission-handler.spec.ts` pins the system-abort MAPPING — but both drive
`cleanupPendingPermissions` directly. **`ConfigWatcher` is mocked, so nothing in
the suite proves it fires on a real settings write, or that the handler reaches
`disposeAllSessions`.** That edge is the one an e2e can close and a unit test
structurally cannot.

## Correction 1 — the defect is provider-agnostic

`ConfigWatcher` fires on `authMethod`, `anthropicProviderId` and any
`ptah.auth.*` secret write. It watches the SETTINGS KEY, not provider behaviour,
so claude → codex and claude → ollama exercise byte-identical code. Three
providers buys one case run three times, not three cases.

What does matter is that the switch be **real** rather than a synthetic settings
write: `AuthManager.doConfigureAuthentication` is what actually writes the
`ptah.auth.*` secrets that trip the watcher, and a test that pokes the settings
file directly would prove less than it appears to. One real switch is enough.

## Correction 2 — pick lm-studio, not ollama

A provider-switch e2e also covers TASK_2026_262, since switching is exactly what
triggers `applyPersistedTiers`. But the choice of provider decides whether it
does:

| Provider     | `defaultTiers`   | Local | Covers 262's live-derivation path        |
| ------------ | ---------------- | ----- | ---------------------------------------- |
| `ollama`     | yes (`qwen3:8b`) | yes   | **no** — resolves through the static map |
| `lm-studio`  | **none**         | yes   | **yes**                                  |
| `openrouter` | none             | no    | yes, but needs a key                     |

`lm-studio` is the only entry that is both hermetic and exercises the live
derivation. Switching to `ollama` would validate the switch mechanism while
silently missing the code TASK_2026_262 added.

## The blocker, and it is the whole task

Reproducing 247 needs an **in-flight permission request at the moment config
changes**. Normally that means a real agent session calling a tool — real
credentials, a nondeterministic model, and a race the test has to win.

`apps/ptah-electron-e2e/src/support/` has no seam for this. Checked: no
permission helper, and `real-rpc-fixtures.ts` exposes `repo`, `ptahHome`,
`electronApp`, `mainWindow`, `ui`, `rpcBridge` and nothing permission-shaped.

**Designing that seam is the deliverable.** Constraints it has to satisfy:

- It must produce a request that reaches the REAL `SdkPermissionHandler`'s
  `pendingRequests` map — a fake that only looks like one proves nothing, since
  the defect is about what walks that map.
- It must not require a live model or credentials.
- It must not become a production code path that only exists for tests. If the
  only honest way in is a production seam, say so and argue for it rather than
  smuggling it in.
- Routable vs unroutable matters: an unroutable request arms the 60 s deny
  timeout (`sdk-permission-handler.ts:75`), so the seam should produce a
  ROUTABLE request or the test measures the timeout instead of the defect.

## What the harness already gives you

- `real-rpc-fixtures.ts` — `rpcBridge` talks to the REAL handler, nothing
  intercepts the `rpc` channel.
- `ptahHome` — an isolated `os.homedir()` per test, so auth switching never
  touches the developer's `~/.ptah/settings.json` or credentials. This is the
  fixture that makes the whole idea safe.
- Serial execution is already mandatory (`workers: 1`, `fullyParallel: false`)
  because the Electron app owns global DI state — which is exactly what an auth
  switch mutates, so this test fits the existing constraint rather than
  straining it.
- `specs/settings/settings.spec.ts` and the setup-wizard specs are prior art for
  driving the settings surface.

## What the test must assert

1. A pending permission on session A **survives** an auth change made while it
   is in flight — it is neither denied nor resolved, and its owner can still
   answer it. This is TASK_2026_247 fix 1 (scope), and the assertion that
   matters is ANSWERABLE, not merely un-denied.
2. When a permission IS torn down by a genuine disposal, what the model receives
   says system abort and is retryable — not the canned user-denial string. This
   is fix 2 (mapping).
3. `ConfigWatcher` actually fired. Without this the test could pass because
   nothing happened at all, which is the failure mode a green e2e hides best.

## Explicitly out of scope

The live-model variant — a real agent loop against a local server producing a
real tool call and a real prompt. It is the only thing that can prove the
`interrupt: false` assumption empirically (TASK_2026_247 records that as
reasoned, not verified, because the canned string comes from the bundled CLI
binary which is not readable source). It needs the local server installed and a
model pulled, so it is too environment-dependent for CI and belongs behind
`@nightly` or `@live` in its own carrier. Decided 2026-08-16: deterministic
seam first.

## Verification

- `nx run ptah-electron-e2e:e2e` — the new spec green, and the existing suite
  unmoved.
- The spec must fail if TASK_2026_247's scope fix is reverted. Prove it by
  reverting `session-control.service.ts`'s per-record cleanup and watching this
  test go red — if it stays green it is not testing what it claims.
