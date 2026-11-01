# Security Review - Batch 8q-3a (live Codex permission-level change)

Reviewer scope: `codex-context.ts`, `codex-execution-profile.ts`, `codex-runtime.types.ts`, their specs, and the four mock-only spec edits. Read-only; no checks were run. Evidence is from the working-tree diff plus the surrounding source.

## Verdict

- Recommendation: APPROVE (no Blocking, no Serious findings). Score 8/10.
- Moderate findings 3 and Minor findings 3 are listed below. Moderate 1 (persist racing close) should be fixed before the feature is released, not necessarily before this commit.
- Confidence: MEDIUM-HIGH. Static trace only; the specs were read but not executed.

## Answers to the seven questions

### 1. Can an approval be decided under a level other than the turn's start level?

No, for every turn started through `start()`.

- `start()` snapshots `level` and `levelPolicy` from the same fields at the top of the serialized section (`codex-context.ts:501-502`). It sends that policy (`:506-519`). It sets `activeTurnPermissionLevel = level` at `:520`, before `state = 'running'` (`:521`). The bridge therefore never observes `running` without a snapshot.
- `turnPermissionLevel` (`:207-214`) returns the snapshot while `running` or `interrupting`. The bridge reads it through `permissionLevel: () => this.turnPermissionLevel` (`:273`), and both bridge reads (policy at `codex-approval-bridge.ts:316`, plan-decline at `:341`) are therefore stable for the whole turn, even across the `await this.interact(...)`.
- `updateNextTurn` is admitted while a turn runs (`serialize` only orders RPC admission, `:69`). It rewrites `settings` and `levelPolicy` only. It never touches `activeTurnPermissionLevel`. `steer` (`:700-724`) sends `turn/steer`, which carries no policy, so a steered turn keeps its start policy and its snapshot.
- Reset paths: terminal event for the active turn clears the snapshot (`:416`). A `CodexRequestRejectedError` with no `activeTurn` clears it and returns to idle (`:545-548`). A rejection after `turn/started` already set `activeTurn` keeps the snapshot, which is correct because the turn is live. A non-rejection failure calls `onFailure`, which closes the context. `close()` does not clear the snapshot, but the getter then returns the settings level while the bridge is disposed (`bridge.dispose()` in `close`), and `isCurrent` requires `state === 'running'`, so nothing is decided.
- `isCurrent` requires `state === 'running'` (`:275`), so an `interrupting` turn cancels instead of deciding. That is fail-closed.
- Residual (Moderate 2): a turn that begins by a `turn/started` notification while the context is idle (compaction or a server-initiated turn, `:395-402`) has no snapshot. The getter falls back to the live `settings.permissionLevel`. The server runs such a turn under the thread's last-sent policy, which can differ from the live level after an `updateNextTurn`. The mismatch direction that matters (last turn read-only, level now yolo) is harmless in practice because compaction runs no tools. The opposite direction fails closed.

### 2. Persist-before-mutate, serialization, and close/generation races

- A rejected `store.persist` leaves everything unchanged. The only statements before the `await` (`codex-context.ts:790-803`) are pure: `resolveCodexLevelPolicy`, `codexProfileFingerprint`, building a frozen `nextIdentity`. `committedIdentity` is assigned after the `await` (`:803`). `settings` (`:805-812`) and `levelPolicy` (`:813`) are assigned after that, synchronously, with no `await` between them, so no interleaving is possible.
- `updateNextTurn` goes through `serialize`, so it cannot interleave with `start()` or `compact()`. A start that already holds the queue finishes first and a later `start` sees the new level.
- Invalid patches throw before the persist (`:785`).
- No-op change: `level !== this.settings.permissionLevel` (`:790`) skips the persist. `settings.permissionLevel` is initialised from the profile (`:116`) and is only changed together with the persisted fingerprint, so the committed fingerprint always corresponds to `settings.permissionLevel`. A no-op therefore never skips a needed persist, and the fingerprint is always computed from the new level and its own policy. A change from X to Y then back to X persists twice, which is correct.
- `close()` race (Moderate 1). `close()` does not go through `serialize` (`:924`). `finishClose` awaits only `this.persistence` (the open-time persist, `:940`), not the update persist. `markInactive(this.committedIdentity)` (`:946`) compares the full identity including the fingerprint (`codex-thread-identity-store.ts:46`, `:128-133`). Two outcomes are possible when close lands while the update persist is pending:
  1. `markInactive(old)` runs first and succeeds. The late `persist(new)` then writes `state: 'active'` (`codex-thread-identity-store.ts:105-111`) for a closed context, so the record stays active.
  2. The store write lands first and the identity is swapped after, so `markInactive(old)` fails the `sameBinding` fingerprint check and the record stays active.
  The `stale-generation` guard (`:96`) only protects against a newer generation, not against a same-generation context that has already closed. The port documents that active metadata is not liveness proof (`codex-runtime-ports.ts:34`), which bounds the impact to a stale active flag, hence Moderate. The caller also receives `{ timing: 'nextTurn' }` success from a closed context, since there is no post-await `isClosed()` check (compare `open`, `:267`).

### 3. Byte-identity of the extraction

Identical.

- `resolveApprovalPolicy` is unchanged (`codex-execution-profile.ts:143-160`). `resolveCodexLevelPolicy` (`:167-188`) uses the same `writable` expression as the removed inline code: auto-edit, yolo, or (chat and ask). It uses the same `networkAccess: false` and `writableRoots: writable ? [cwd] : []`.
- The builder passes `selected.consumer`, `selected.permissionLevel` and the normalised `cwd` (`:264`, `:291-295`), which is the value that the old code interpolated. `profile.cwd` is set from that same `cwd` (`:299`), so `updateNextTurn`'s `this.profile.cwd` reproduces it.
- `codexProfileFingerprint` (`:202-210`) is the old expression verbatim (JSON round-trip, `parse(z.json())`, `canonical`, sha256, `sha256:` prefix). Keys are sorted by `canonical`, so object key order cannot change the digest. Chat, lane, gateway and usage consumers therefore get unchanged fingerprints, and stored fingerprints still match with no spurious D14a refusals.
- Resume refusal is unchanged: `codex-runtime.ts:51` still compares `resume.profileFingerprint !== profile.profileFingerprint` against the freshly built profile. A resume under a different level than the saved one still refuses (D24(1)).
- The specs assert fingerprint equality between the extracted helper and the builder (relational, no literal digest). That proves self-consistency but not stability against pre-change digests; the code review above supplies that.

### 4. Level transitions send the right sandbox and approval policy

- plan: read-only sandbox, `networkAccess: false`, `writableRoots: []`, chat approval policy `on-request`. The bridge declines every non-question approval in plan (`codex-permission-policy.ts:20`, `codex-approval-bridge.ts:341`).
- ask (chat): workspace-write with `writableRoots: [cwd]`, `untrusted`. auto-edit: workspace-write, `untrusted`. yolo: workspace-write, `on-request`, network false.
- `start()` builds `sandboxPolicy` from `levelPolicy` at `:511-518`: `workspace-write` maps to `workspaceWrite` with `[cwd]` roots, everything else to `readOnly` with network false. Transitions in both directions therefore send the exact policy pair for the target level.
- Yolo never reaches full access: nothing in the update path can produce `danger-full-access`, and `fullAccessStatus: 'unproved-disabled'` is set only in the builder and is unaffected. Yolo is auto-accept inside a workspace-write sandbox, as before.
- The open-time `thread/start` and `thread/resume` still send `this.profile.approvalPolicy` and `this.profile.sandboxPolicy.mode` (`:228-231`), so (7) holds. `mcpConfig` handling is untouched.

### 5. No-op vs persisted fingerprint

Covered under question 2. No wrong fingerprint can be persisted. The only wrong-state case is the close race.

### 6. Window between the sink (reads `session.settings`) and the bridge (snapshot)

Committing 8q-3a alone does open a window, but it fails closed. Only mid-turn level changes matter, and they disagree in these ways:

- Turn started in plan, chip moved to ask: the sink classifies and may auto-accept a read-only command, but the bridge level is still plan, so `decision` is forced to `decline` (`codex-approval-bridge.ts:341`). Result: a wasted prompt or accept that is ignored. No escalation.
- Turn started in ask, chip moved to plan: the sink presents a card because it no longer sees ask. The bridge still decides under ask, so the user's accept executes. This is correct per D20 (the turn keeps its level) and the card is shown under a stale plan label.
- Turn started in auto-edit or yolo, chip moved to ask: the sink may auto-accept a classified read-only command. The bridge would have presented it or accepted it anyway. This is fewer prompts only for commands the classifier proves read-only; not an escalation.

The sink can only auto-accept when the settings level is ask, and the only bridge level that would decline is plan, so the sink can never grant more than the bridge permits. Severity: Moderate (consistency and UX, not a privilege gap). 8q-3b should still switch the sink to `turnPermissionLevel`, and 8q-3a is acceptable to commit alone provided the two land close together.

### 7. Resume

`thread/resume` uses the open-time profile (`:228-243`). After a live change the persisted fingerprint reflects the new level, so a later resume must be built from the saved level (the rpc-handlers saved-level helper, out of scope here) or it will be refused by `codex-runtime.ts:51`. That refusal is the intended fail-closed behaviour.

## Findings

### Blocking

None.

### Serious

None.

### Moderate

1. `codex-context.ts:803` / `:924-946`: `updateNextTurn` persists after the open-time persistence but is not tracked by `this.persistence`, and there is no `isClosed()` check after the `await`. A close during the persist leaves the identity record `active` (see question 2) and returns success from a closed context. Fix: after the `await`, check `this.isClosed()` and throw (and best-effort `markInactive(nextIdentity)`), or chain the update persist into `this.persistence` so `finishClose` awaits it before `markInactive`.
2. `codex-context.ts:207-214` / `:395-402`: a turn that starts by notification while idle has no snapshot, so the bridge reads the live settings level. Fix: set `activeTurnPermissionLevel` to the settings level at the point where `turn/started` promotes the context to `running`, so that the value cannot change mid-turn.
3. `codex-chat-approval-sink.ts:91,123` (agent-sdk): the sink reads the live level while the bridge uses the snapshot (question 6). It fails closed, and 8q-3b is expected to close it. Do not defer 8q-3b past this commit's release.

### Minor

1. `codex-approval-bridge.ts:253-272`: the identity captured at bridge construction keeps the open-time `profileFingerprint`, so approval requests sent to the sink after a level change carry a stale fingerprint. Nothing in the repository compares it today (grep over `profileFingerprint` shows only the store, runtime resume and metadata), but a future consumer could.
2. `codex-permission-rule-store.ts:25-32,84`: session rules are scoped by provider, home, workspace and thread, not by level. A rule granted with `acceptForSession` under one level auto-accepts matching commands under ask or auto-edit after a live change (`codex-permission-policy.ts:40`). This predates the batch, but a live level change makes it reachable inside one thread. Plan is unaffected because the plan check precedes the rule check. Consider clearing the thread's rules when the level changes to a stricter one.
3. Tests: no spec covers close-during-persist, a turn started by notification, or the sink/bridge disagreement. The mock-only edits (`codex-chat-adapter.spec.ts:67`, `codex-chat-turn-lifecycle.spec.ts:66`, `codex-gateway-adapter.spec.ts:46`, `codex-chat-native-contract.spec.ts:253`) only add the required property and change no behaviour.

## Not affected

MCP config handling (`mcpConfig` creation, send and drop at `:240-250`) is unchanged. No new RPC input surface, secret, path or error text was introduced; the persist error passes through as the store's typed `CodexThreadIdentityPersistError` with fixed text.
