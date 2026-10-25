# PR #808 review threads — verdicts and fixes

Task: TASK_2026_712 residual R1 (D7/D25). Seven unresolved CodeRabbit threads on PR #808.

Status: the 45 tool-call ceiling was reached during this run. All seven verdicts
are final with file:line evidence. Thread 1fe is applied. Threads 1fL, 41SX and
1fh are FIX verdicts with complete drafted changes below, not applied. Threads
1fH, 1fi and 1fl are NO-CHANGE. Fail-closed behavior is preserved everywhere:
no refusal was weakened, no named account can launch (D7), and no new error or
log carries path, env or credential text.

## Verdicts

| Thread | Location | Severity | Verdict | Change or reason | Spec that covers it |
|---|---|---|---|---|---|
| 1fH | `libs/backend/agent-sdk/src/lib/session-metadata-store.ts:984` | Major (outdated) | NO-CHANGE | Already fixed by D25 F2. `listAccountLinkage` (session-metadata-store.ts:117-124) keeps a stored binding that does not parse, and the list projections use it: `getForWorkspace` (:998) and `getAll` (:1023, :1025, :1035). One bad row no longer hides the other sessions. `get()` and `resolveAccountBinding()` stay strict. CodeRabbit marked the thread outdated. | `session-metadata-store.account-binding.spec.ts:42-58` ("refuses present malformed linkage ... but still lists it") |
| 1fL | `libs/backend/auth-providers/src/lib/accounts/claude-account-command.ts:191` | Minor | FIX — drafted, not applied | In `stop()`, when the child never spawned (`pid === null`), the lease must finish at once with `terminated: true` instead of waiting out the 2 s grace timer. `finish` is idempotent and clears the grace timer, so the later timer and `close` are no-ops. Complete change in "Drafted fixes". Not applied: the edit anchor transcribed before compaction did not match the file, and the ceiling did not allow a re-read plus a second edit. | Existing disposal test in `register.spec.ts:142-195` covers the spawned path (`whenSpawned` resolves pid 4321) and stays green. Never-spawned test drafted below. |
| 1fe | `libs/backend/auth-providers/src/lib/di/register.ts:161-163` | Major | FIX — applied | The admission factory is gated at resolution time. When `SQLITE_CONNECTION` is not registered (VS Code host), the factory returns a fail-closed port that refuses exactly like the service (`release-held` for admission, `conflict` for release/retain), instead of throwing inside the factory. Registration stays unconditional because Electron registers the connection after this module. The `isOptional` consumer in agent-sdk (sdk-query-runner.service.ts:311-312) now constructs on VS Code. | `register.spec.ts:88-109` (connection present → `ProviderAccountService`) stays green. No-connection test drafted below, not written (ceiling). |
| 1fh | `libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-runner.ts:412-419` | Major (security) | FIX — drafted, not applied | `sameIdentity` must treat `unknown` as absent proof: it equals nothing, not even itself, and a known identity matches only the same owner key. `bootstrap` must refuse an unproved identity before any binding is committed. Complete change in "Drafted fixes". Not applied: tool-call ceiling. | Drafted spec below. |
| 1fi | `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts:931-935` | Minor | NO-CHANGE | `snapshotLaneAccountReference(laneAccountFields(x))` cannot throw: `laneAccountFields` (lane-resume-gate.ts:170-187) sanitizes every input into a safe shape before the strict snapshot runs, and `snapshotLaneAccountReference` (:189-206) cannot throw on that output. The mismatch throw (:933-934) needs a valid claude binding on both the handle and the request, which requires named admission — release-held under D7 (D25 F1 family). The suggested change also exceeds this task's 8-file cap. | Admission matrix specs added in d9bb1c0b9 (agent-sdk, cli-agent-runtime). |
| 1fl | `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-resume-gate.ts:214` | Minor | NO-CHANGE | The throw is reachable only for `cli === 'claude'` with a roster entry. The claude roster entry does not exist yet: cli-agent-runtime di/register.ts:100 keeps the registration "runtime-local until the Batch 26 roster activation", and D25 F3 defers the roster and the `accountPersistence` handoff to `ClaudeCliAdapter` (di/register.ts:105) to Batch 26. | — (behavior unreachable today) |
| 41SX | `libs/backend/agent-sdk/src/lib/session-metadata-store.ts:876` | Major | FIX — drafted, not applied | The async flush maps every staged row through the strict `sessionIndexEntry`, so one stored row with a binding that does not parse fails every later write. The fix maps the flush through a lenient `preservedIndexEntry`: a bad row keeps its stored binding and stays in the index; the row a write targets stays strict before it is staged. Complete change in "Drafted fixes". Not applied: tool-call ceiling. | Drafted async spec below (the shared mock is sync-only). |

## Files changed

- `libs/backend/auth-providers/src/lib/di/register.ts` — 1fe (new import, gated admission factory, fail-closed port).
- `libs/backend/auth-providers/src/lib/accounts/claude-account-command.ts` — not changed (1fL edit failed on its anchor; drafted below).
- `.ptah/specs/TASK_2026_712_5d7c/pr808-review-fixes.md` — this report.

No spec file was changed: the ceiling was reached before the spec extensions
could be written. All drafted tests are below.

## Decisions

1. Gate the admission factory at resolution time, not at registration time.
   - Options: (a) skip registration when the connection is absent, (b) gate
     inside the factory, (c) no change.
   - Evidence: Electron registers this module before it registers
     `SQLITE_CONNECTION`, so (a) breaks the Electron host. VS Code never
     registers the connection and the `ProviderAccountService` constructor
     requires it (provider-account.service.ts:33-35), so today a VS Code
     resolution of the token throws inside the factory and the optional
     consumer cannot construct. No consumer resolves admission before all
     registrations finish — such a resolution would already throw today; after
     this change it gets the fail-closed port instead.
   - Reversible: yes, one block.

2. The fail-closed port hardcodes the refusal codes `'release-held'` and `'conflict'`.
   - Options: (a) derive from `Exclude<ProviderAccountResultCode, 'ok'>`,
     (b) hardcode the two codes.
   - Evidence: the codes are the D7 refusal pair the service itself returns
     (claude-account-command.ts:68, 74-80), and `claudeLaneRefusal()`
     already hardcodes `'release-held'` (claude-sdk-lane-runner.ts:268-272).
     Option (a) needs an extra import edit; the ceiling did not allow it.
   - Reversible: yes.

3. The fail-closed port is a local function inside `registerProviderAccountServices`.
   - Options: (a) module-level helper after the function, (b) local function
     before the registration it guards.
   - Evidence: the local declaration keeps the whole change inside the
     verified registration block, next to its only use. Function declarations
     are hoisted, so the cached factory can call it after registration returns.
   - Reversible: yes.

4. Apply 1fe, draft 1fL, 41SX and 1fh.
   - Options: apply 41SX (two edits) instead of 1fL (one edit).
   - Evidence: the ceiling allowed four edit calls; 1fe used three (one failed
     anchor on 1fL burned the fourth). The drafted changes are complete, so the
     coordinating session can apply them without new analysis.
   - Reversible: yes.

## Drafted fixes (not applied)

### 1fL — claude-account-command.ts `stop()`

Re-read the `whenSpawned` block inside `stop()` (around line 185-195) and apply
this change; only the `pid === null` branch is new:

```typescript
        void child.whenSpawned.then(pid => {
          if (settled || stopped) return;
          if (pid === null) {
            // Never spawned: no process exists, so termination is established
            // and the reservation can release now instead of after the grace.
            finish({ code, terminated: true });
            return;
          }
          // Tree kill is best effort. Only close proves termination for this lease.
          return killProcessTree(pid, 'SIGKILL');
        }).catch((error: unknown) => {
          // degradation-audit: optional-capability — failed tree kill cannot release the reservation without close
        });
```

### 41SX — session-metadata-store.ts

After `sessionIndexEntry` (lines 360-365), add:

```typescript
/**
 * Index entry for a row this store did not just write. A stored row whose
 * account binding no longer parses keeps its stored binding and stays in
 * the index (one bad row must not fail every write); the row a write
 * targets stays strict in _saveInternal before it is staged.
 */
function preservedIndexEntry(metadata: SessionMetadata): SessionMetadata {
  try {
    return sessionIndexEntry(metadata);
  } catch (error: unknown) {
    if (!(error instanceof SessionAccountBindingError)) throw error;
    const entry = { ...metadata };
    delete entry.cliSessions;
    return entry;
  }
}
```

In `flush()` (line 876), change `items: snapshot.map((item) => this.indexEntry(item)),`
to `items: snapshot.map(preservedIndexEntry),`. The written-row summary at
line 825 stays strict.

### 1fh — claude-sdk-lane-runner.ts

Replace `sameIdentity` (lines 412-419):

```typescript
  private sameIdentity(identity: ProviderAccountIdentityEvidence): boolean {
    // `unknown` is absent proof, never an identity: it equals nothing, not
    // even itself. A known identity matches only the same owner key.
    const baseline = this.identity;
    return (
      !!baseline &&
      baseline.kind === 'known' &&
      identity.kind === 'known' &&
      baseline.ownerKey === identity.ownerKey
    );
  }
```

In `bootstrap` (lines 421-448), directly after `this.identity = await this.readIdentity();`,
insert:

```typescript
    // Refuse an unproved identity before any binding is committed or any
    // prompt is sent, including on a fresh lane with no stored binding.
    if (this.identity.kind !== 'known') throw claudeLaneRefusal();
```

Safety: `bootstrap` has one production caller, the named path
(claude-cli.adapter.ts:124). Ambient lanes run through `ClaudeSdkLaneRunner.run`
(di/register.ts:94, ptah-cli-registry.ts:760) and never call `bootstrap`.

## Drafted spec tests (not written)

### 1fe — `libs/backend/auth-providers/src/lib/di/register.spec.ts`

```typescript
it('hands out fail-closed admission when the SQL connection is not registered', async () => {
  const c = setup(); // same child container, WITHOUT the SQLITE_CONNECTION registration
  const admission = c.resolve(AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_ACCOUNT_ADMISSION);
  expect(admission).not.toBeInstanceOf(ProviderAccountService);
  await expect(admission.admitClaudeRoute({
    provider: 'claude', scope: 'main',
    selection: { kind: 'ambient' },
    operationId: 'operation-0001', runId: 'run-00001',
  } as Parameters<ProviderAccountAdmissionPort['admitClaudeRoute']>[0]))
    .resolves.toMatchObject({ code: 'release-held' });
  // releaseReservation / retainUnresolvedReservation with the port's command
  // fixture → { code: 'conflict' }.
});
```

### 1fL — `libs/backend/auth-providers/src/lib/di/register.spec.ts`

Model on the disposal test (lines 142-195), with `AccountChild.whenSpawned =
Promise.resolve(null)` and `pid = null`. After `c.dispose()`, the sign-in must
settle at once as `{ code: 'cancelled', terminated: true }` without timer
advance; `jest.getTimerCount()` is 0 (finish cleared the grace timer),
`killProcessTree` was not called, and no operation row was written. The
existing disposal test (pid 4321) keeps covering the spawned path.

### 41SX — `libs/backend/agent-sdk/src/lib/session-metadata-store.account-binding.spec.ts`

The shared `createMockStateStorage` is sync-only, so the async flush branch
needs a local fixture (add `import type { IAsyncStateStorage } from '@ptah-extension/platform-core';`):

```typescript
function asyncFixture() {
  const storage = createMockStateStorage();
  const logger = createMockLogger() as Logger;
  const asyncStorage = {
    ...storage,
    getAsync: jest.fn(async (key: string, defaultValue?: unknown) => storage.get(key, defaultValue)),
    readJsonSequence: jest.fn(async function* (key: string) {
      const items = storage.get<unknown[]>(key) ?? [];
      yield { items, nextCursor: null, done: true, approximateBytes: 2 };
    }),
    replaceJsonSequence: jest.fn(async (key: string, chunks: AsyncIterable<{ items: readonly unknown[] }>) => {
      const items: unknown[] = [];
      for await (const chunk of chunks) items.push(...chunk.items);
      await storage.update(key, items);
    }),
  } as unknown as IAsyncStateStorage;
  return { storage, store: new SessionMetadataStore(asyncStorage, logger) };
}
```

Seed one malformed row (`{ ...binding, directory: '/private/account' }`) and one
healthy row; save a third session. Before the fix `store.save(third)` rejects;
after it, the save resolves, the stored index keeps all three ids with the
malformed row's `accountBinding` preserved, and `store.get(malformedId)` still
rejects `{ code: 'invalid-bound' }`.

### 1fh — `libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-runner.spec.ts`

Construct a real `ClaudeNamedLaneAdmission` (constructor at
claude-sdk-lane-runner.ts:296-308) with a fake `ClaudeLaneAccountPersistence`
interface (:239-266) whose `assertRouteCurrent` resolves and whose
`onAuthEpochChanged` returns a no-op unsubscribe, a route/reservation/admission
fixture as in the existing named tests, and a child whose
`query.accountInfo()` returns `{}` (no email → identity `{ kind: 'unknown' }`).
`bootstrap` must reject with `{ code: 'release-held' }`.

## Existing specs that mock changed members

- `libs/backend/auth-providers/src/lib/di/register.spec.ts` module-mocks
  `killProcessTree` and spies `authorization`/`environment` on the account
  command. Its disposal test drives `stop()` with a spawned pid (4321), so the
  drafted 1fL change does not touch its path. Its admission test (lines 88-109)
  registers `SQLITE_CONNECTION` before resolving the token, so the applied 1fe
  gate still returns `ProviderAccountService` there.
- The agent-sdk `session-metadata-store*.spec.ts` files use the sync
  `createMockStateStorage`, which takes the sync flush branch — unaffected
  until the 41SX draft lands, at which point the async fixture above is needed.

## Suggested jest commands

Changed production code (1fe) is covered by one spec host:

```
npx jest -c libs/backend/auth-providers/jest.config.ts src/lib/di/register.spec.ts --coverage=false --maxWorkers=2
```

When the drafted fixes land, also:

```
npx jest -c libs/backend/agent-sdk/jest.config.ts src/lib/session-metadata-store.account-binding.spec.ts --coverage=false --maxWorkers=2
npx jest -c libs/backend/cli-agent-runtime/jest.config.ts src/lib/claude/claude-sdk-lane-runner.spec.ts --coverage=false --maxWorkers=2
```

## Verification not run

`ptah_get_diagnostics` was not called: the ceiling was consumed by the applied
edits and this report. The changed project is `auth-providers` only. The
coordinating session's checks in the shared slot must cover it; no nx, jest,
tsc, lint or npm command was run from this lane. No git action was taken.