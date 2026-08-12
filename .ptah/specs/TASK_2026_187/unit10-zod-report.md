# Unit 10 — remove `zod` from the webview's eager bundle

**Verdict**: feasible and **implemented**. Initial total **2,512,563 B → 2,165,914 B** (−346,649 B) on an isolated tree; **2,200,511 B** (−312,052 B) on the tree as it stands now, the difference being a concurrent session's work, not mine. The 2,500,000 B budget is **met** either way. `zod` appears in **zero** initial chunks by source-map attribution.

---

## 1. §A verdict — found by searching, not by trusting the plan

**The answer is neither of the two options as posed. BOTH mechanisms are live, and each is independently sufficient to keep `zod` eager.** The plan's option 2 is true but incomplete; option 1 is also true, and the plan did not know it.

### 1a. Every frontend site that evaluates a zod schema

Swept `libs/frontend/**` + `apps/ptah-extension-webview/src/**` for value-level references to any `Schema` symbol, then cross-referenced all 96 exported values of the 11 zod-bearing `libs/shared` modules against frontend usage. Result — **7 eager sites, not 6**:

| #   | Site                                                | Schema                               | Eager?  | Why                                                                                                  |
| --- | --------------------------------------------------- | ------------------------------------ | ------- | ---------------------------------------------------------------------------------------------------- |
| 1   | `chat-message-handler.service.ts:263`               | `SdkSubagentEndedPayloadSchema`      | **yes** | `ChatMessageHandler` in `MESSAGE_HANDLERS`, `app.config.ts:116`                                      |
| 2   | `chat-message-handler.service.ts:287`               | `SdkTurnEndedPayloadSchema`          | **yes** | same                                                                                                 |
| 3   | `chat-message-handler.service.ts:311`               | `SdkTurnFailedPayloadSchema`         | **yes** | same                                                                                                 |
| 4   | `chat-message-handler.service.ts:333`               | `SdkCompactionCompletePayloadSchema` | **yes** | same                                                                                                 |
| 5   | `chat-message-handler.service.ts:454`               | `PermissionRequestSchema`            | **yes** | same                                                                                                 |
| 6   | `chat-message-handler.service.ts:528`               | `AskUserQuestionRequestSchema`       | **yes** | same                                                                                                 |
| 7   | **`tasks-ui/services/tasks-store.service.ts:1047`** | **`TaskMetadataPatchSchema`**        | **yes** | **`TasksStore` in `MESSAGE_HANDLERS`, `app.config.ts:176`, via `@ptah-extension/tasks-ui/services`** |
| —   | `task-metadata-editor.component.ts:392`             | `TaskMetadataPatchSchema`            | no      | board is lazy (Batch 4)                                                                              |
| —   | `task-relations.component.ts:580`                   | `TaskMetadataPatchSchema`            | no      | board is lazy (Batch 4)                                                                              |

**Site 7 is new information.** The plan listed six sites in one file. `TasksStore` is eager for exactly the reason Batch 4 made it eager — it is a `MESSAGE_HANDLERS` entry reached through the narrow `/services` barrel — and it calls `.safeParse` on a third schema module (`task-view.types`) that the plan never connected to zod.

False positives ruled out: `TabId.safeParse` / `SessionId.safeParse` / `SurfaceId.safeParse` (100+ call sites) are **hand-written brand helpers** in `chat-state/identity/ids.ts` and `shared/branded.types.ts`, with no zod involvement.

### 1b. The barrel reach is independently sufficient — measured, not argued

I replaced all six chat call sites with hand-written parsers, rebuilt, and attributed. **`npm:zod` stayed at exactly 304.1 kB.** Inspecting the zod-bearing initial chunk's source map showed which `libs/shared` modules travelled with it:

```
=== chunk-XRMW7EUO.js :: 75 zod source files
    libs/shared/src/lib/types/branded.schemas.ts
    libs/shared/src/lib/types/execution/schemas.ts      <-- zero frontend references
    libs/shared/src/lib/types/messages/schemas.ts       <-- zero frontend references
    libs/shared/src/lib/types/permission.schemas.ts
    libs/shared/src/lib/types/sdk-hook.schemas.ts
    libs/shared/src/lib/types/task-view.schemas.ts
    libs/shared/src/lib/types/task-filter.schemas.ts
    libs/shared/src/lib/types/task-saved-view.schemas.ts
  other shared modules present: 113
```

`execution/schemas.ts` and `messages/schemas.ts` have **no frontend reference of any kind**, yet they are in the eager chunk. That is the proof: `export *` from `libs/shared/src/index.ts` drags every zod module in regardless of use, so **removing the call sites alone can never remove zod**.

I also tested the cheap hypothesis first — adding `"sideEffects": false` to `libs/shared/package.json` — and rebuilt. Output was **byte-identical** (2.55 MB, same chunk hashes). It cannot help while the modules are genuinely _reached_: the frontend imports `SessionId`/`TabId`/`UUID_REGEX` from `branded.types.ts`, which imported zod for three schemas the frontend never touches. The flag is retained because it becomes load-bearing once the modules are no longer reached.

**Conclusion**: the split is necessary **and** the call sites must change. Neither alone is sufficient.

---

## 2. §B — approach chosen, and what I rejected

Not one approach — the right one per site, because the two sites have different risk profiles.

### Chosen for the six chat streaming sites: **(a) hand-written parsers, with a proven-equivalence test**

Decisive enabling fact, verified by reading all six call sites: **`parsed.error` is used only in `console.warn`.** No user-facing string depends on zod's message text. So equivalence reduces to a clean two-part contract — identical accept/reject, and identical `safeParse().data` — both mechanically testable. The schemas are also simple (strings, finite numbers, literal unions, nullable, arrays, one record, two UUID flavours).

### Chosen for the one tasks site: **(b) deferred import**

`TaskMetadataPatchSchema` is the opposite case: `applyMetadata` surfaces `parsed.error.issues[0].message` **verbatim to the user**, and the schema uses `superRefine`, `z.enum`, nested `.max()` with custom messages, and a top-level refine. Hand-writing it would mean replicating zod's _issue ordering_ to keep the sentence a user reads correct — brittle, for no extra byte saving.

Deferring is safe **here** for reasons that do not hold on the streaming path, and I checked each: the method is already `async`; every caller already awaits it; writes are serialized per task by `enqueueWrite`; it is user-initiated, not a message pump; and the lazily-loaded board — which imports the same schema statically — is already fetched before a user can reach it. Nothing is queued, reordered, or dropped.

### Rejected

- **(b) for the streaming sites** — rejected outright. `session:turnEnded` / `chat:chunk` arrive on the hot path with no queue. Reordering or dropping a streaming message is far worse than 304 kB, and this task's own record (a 118 kB win reverted over 70 ms) sets that precedent.
- **(a) for the tasks site** — rejected: verbatim user-facing error text made equivalence brittle where deferral was free.
- **(c) splitting `libs/shared` alone** — rejected as _insufficient_, proven in §1b: it removes barrel reach but leaves 7 live call sites. It is, however, **necessary**, so it is part of the shipped solution rather than an alternative to it.
- **`"sideEffects": false` alone** — measured, byte-identical, rejected as a standalone fix (§1b).

### What shipped

1. Split all **11** zod-bearing modules so each `*.types.ts` is zod-free and each `*.schemas.ts` holds the zod, then moved every schema module behind a new secondary entry point `@ptah-extension/shared/schemas`. `libs/shared/src/index.ts` is now zod-free: a BFS over its relative imports reaches 117 modules, **0 zod-bearing**.
2. Six hand-written parsers (`sdk-hook.parsers.ts`, `permission.parsers.ts`) over shared zod-free primitives (`wire-guards.internal.ts`).
3. `TasksStore` defers via a local `metadata-patch-schema.lazy.ts` module (see §8, item 2 — a direct `import('@ptah-extension/shared/schemas')` breaks 22 Nx boundary checks).

---

## 3. Equivalence evidence — demonstrated, not asserted

`libs/shared/src/lib/types/wire-parsers.equivalence.spec.ts` runs **both implementations over 3,063 inputs** and asserts on every one:

1. the parser accepts **exactly** when the schema accepts;
2. on acceptance the value is `toStrictEqual` to `safeParse().data` — `toStrictEqual`, not `toEqual`, so a key present with value `undefined` is not silently equated with an absent key;
3. output **key order** matches zod's;
4. arrays zod freezes via `.readonly()` come back frozen, and arrays it does not freeze come back unfrozen.

Corpus construction, per schema: the canonical payload, plus **each field crossed with all 54 hostile values**, plus each field deleted, plus unknown keys added, plus the whole payload replaced by each hostile value, plus targeted extras. Sizes: `SdkCompactionCompletePayload` 334, `SdkTurnEnded` 608, `SdkTurnFailed` 445, `SdkSubagentEnded` 443, `PermissionRequest` 676, `AskUserQuestionRequest` 557. A companion assertion per schema proves the corpus **exercises both outcomes**, so a suite cannot pass by rejecting everything.

**Result: 642/642 pass in `libs/shared`.**

### The corpus caught four real divergences. This is the substance of the evidence.

I did not guess zod's semantics — I probed zod 4.3.6 directly, and the corpus then caught what I still got wrong:

| #   | Divergence                                                                                                                                                                                                                      | Resolution                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `z.number()` **rejects** `NaN`/`±Infinity` — it is a finiteness check, not `typeof`                                                                                                                                             | `isWireNumber` uses `Number.isFinite`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2   | `.int()` enforces the **safe**-integer range — `2 ** 53` is rejected though `Number.isInteger` accepts it                                                                                                                       | `isWireTimestamp` uses `Number.isSafeInteger`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 3   | **`z.record` applies a far stricter plain-object test than `z.object`.** My first parser accepted a `Date` as `toolInput` where zod rejects it. Caught by the corpus, not by review.                                            | Derived the exact rule and validated it against zod over 26 exotic inputs — plain objects, null-prototype objects and arbitrarily deep plain prototype chains accepted; `Date`, `Map`, `Set`, `WeakMap`, `Promise`, `Error`, `RegExp`, typed arrays, arrays, class and subclass instances rejected, as is anything carrying `Symbol.toStringTag` or `Symbol.iterator`. **All 26 agree.** This one mattered: structured-clone transport (Electron IPC) really can deliver a `Date` or `Map`, and accepting one would have widened the trust boundary exactly as warned. |
| 4   | `z.string().uuid()` is **version-agnostic** (v1–v8 plus nil/max), while `UUID_REGEX` in `branded.types.ts` is **v4-only** — and `PermissionRequestSchema` uses _both_: `.uuid()` for `id`, `UUID_REGEX` for `sessionId`/`tabId` | Two distinct checks, `isWireUuid` vs `isUuidV4String`. The corpus includes the seven inputs that separate them, so a parser reusing one check for both fails.                                                                                                                                                                                                                                                                                                                                                                                                          |

### One deliberate, asserted divergence — where the parser is the _stricter_ side

`z.array(...).readonly().safeParse(new Uint8Array(2))` **throws a `TypeError` out of `safeParse`** instead of returning `{success:false}` — zod freezes the input before the array check rejects it, and V8 refuses to freeze a non-empty array-buffer view. (Empty typed arrays reject normally; only non-empty ones throw.)

This is a live defect in the **current shipped code**: `handleSessionTurnEnded` has no `try`/`catch`, so today such a payload would propagate out of the message handler rather than dropping one message. The hand-written parser has no such failure mode — it rejects. The spec asserts precisely that ("parser rejected where zod threw"), so the parser can never silently become the weaker side.

**Net**: on the streaming path the trust boundary is unchanged in what it admits, and strictly improved in one crash mode.

### Logging

`parsed.error` no longer exists, so the six `console.warn` calls now pass `ChatMessageHandler.describePayload(payload)` — the payload's type and top-level **key names** only. That is deliberately _narrower_ than before: zod's error object embedded received values, so this reduces what reaches the console while keeping what identifies a contract mismatch.

---

## 4. §C — consumers and workspace-wide typecheck

Enumerated **before** touching the barrel, by extracting all exported values of the zod-bearing modules and grepping the workspace. **14 files outside `libs/shared`** — far fewer than the plan's feared ~149, which counted all `@ptah-extension/shared` imports rather than schema imports:

| Project           | Files | Migrated to `@ptah-extension/shared/schemas`                                                       |
| ----------------- | ----- | -------------------------------------------------------------------------------------------------- |
| `rpc-handlers`    | 6     | 4 (`session-lifecycle-notifier`, `tasks-rpc.handlers`, `tasks-rpc.schema`, `harness-config-store`) |
| `tasks-ui`        | 3     | 2 lazy components statically; `TasksStore` deferred                                                |
| `vscode-lm-tools` | 2     | 2                                                                                                  |
| `settings-core`   | 2     | 0 — matches were JSDoc prose only                                                                  |
| `vscode-core`     | 1     | 1 (`message-validator.service.ts`)                                                                 |

**No license-server, CLI, or Electron-app file imports a schema symbol.** Additional spec files were repointed (`agent-sdk`, `tasks-ui`, `libs/shared`); no assertion was changed.

**RPC dual-registration rule: not disturbed.** `libs/shared/src/lib/types/rpc.types.ts` and `rpc-handler.ts` `ALLOWED_METHOD_PREFIXES` _are_ modified in the working tree, but by the **concurrent session** adding an `output-styles` namespace (mtimes 01:38:50 and 01:38:56, interleaved with their other output-styles files). No namespace was added or removed by me. Splitting zod out of `rpc/rpc-harness.types.ts` changes no method prefix.

**Workspace-wide typecheck**: `nx run-many -t typecheck --all` → **exit 0, 89 projects, 0 `error TS`**.

**All four shipping bundles build** — this caught a real bug of mine, see §8 item 1:

| Bundle                                 | Result                                                                                                                 |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `ptah-extension-webview` (Angular)     | pass                                                                                                                   |
| `ptah-electron` `build-main` (esbuild) | pass                                                                                                                   |
| `ptah-extension-vscode` (esbuild)      | pass                                                                                                                   |
| `ptah-cli` (esbuild)                   | pass                                                                                                                   |
| `ptah-tui` (esbuild)                   | **fails — on `@ptah-extension/output-styles` only, the concurrent session's lib. My `shared/schemas` resolves there.** |

---

## 5. Bundle — before/after, delta, attribution

### Canonical production builds (`--configuration=production`, no source maps), exact bytes summed from disk

|                                             | Initial total (B) |  Transfer | Budget 2,500,000 B            |
| ------------------------------------------- | ----------------: | --------: | ----------------------------- |
| Baseline (Unit 9 in tree)                   |     **2,512,563** | 518.46 kB | ✗ missed by 12,563 B          |
| After Unit 10 (isolated, 01:40)             |     **2,165,914** | 461.29 kB | ✓ **met**, 334,086 B headroom |
| Current tree (03:0x, incl. concurrent work) |     **2,200,511** | 468.06 kB | ✓ **met**, 299,489 B headroom |

**Delta attributable to Unit 10: −346,649 B.** The +34,597 B between the two after-numbers is the concurrent session's `chat/settings/settings.component.*` edits (mtimes 02:46:36–02:46:44, after my isolated measurement) — see §7 drift note.

The baseline reproduced exactly: my own baseline build reported _"Budget 2.50 MB was not met by 12.56 kB"_ = 2,512,563 B, confirming the coordinator's figure.

### Attribution — zod is gone, proven by source map, not arithmetic

`attribute.js` over every initial chunk of a `--source-map` build:

| Bucket              |     Baseline |                      After |
| ------------------- | -----------: | -------------------------: |
| **`npm:zod`**       | **304.1 kB** | **absent — no row at all** |
| `lib:shared`        |      86.6 kB |                    73.5 kB |
| `lib:frontend/chat` |     535.3 kB |                   535.4 kB |

Two independent confirmations:

- Per-chunk source-map scan: **`zod` appears in 0 of 16 initial chunks.**
- String-marker scan over all 21 initial files of the canonical build: no match.

`zod` did not vanish, it relocated — it now lives in a **lazy** chunk (311,984 B raw / ~55 kB transfer) alongside a 2.30 kB `schemas` chunk for the deferred import, so the board still validates against the real schema.

Independent cross-check on the built Electron renderer, walking the eager graph from `index.html` and following **static** imports only:

```
renderer-before:  21 eager chunks, 2,224,662 eager JS bytes, zod in eager graph: YES
renderer-after:   20 eager chunks, 1,945,381 eager JS bytes, zod in eager graph: NO
```

---

## 6. Startup TTI — R15

The streaming path changed, so this was run. I got a **true same-session before** without stashing (see §8 item 4 for why stashing was unsafe): reverting **only** `chat-message-handler.service.ts` to schema validation restores zod to the eager bundle _and_ to the streaming path — a one-file control isolating both variables. Confirmed: that file alone moves the bundle 2.17 MB → **2.48 MB**.

### The naive comparison was wrong, and interleaving reversed it

First pass, five runs per condition in two consecutive blocks:

|                  | wall-clock "reload → canvas interactive" (ms) | median |  mean |
| ---------------- | --------------------------------------------- | -----: | ----: |
| after (block 1)  | 301, 349, 263, 259, 301                       |    301 | 294.6 |
| before (block 2) | 254, 261, 238, 246, 256                       |    254 | 251.0 |

That reads as a **+47 ms regression** — but it is mechanistically implausible: 279 kB less eager JS and 11 modules' worth of top-level `z.object(...)` construction removed from bootstrap cannot make startup slower, and `first-paint` drifted _up_ too, which a smaller eager bundle cannot cause. The blocks were also taken at different machine loads (after-block stdev 35 vs before-block 9).

So I re-measured **interleaved A/B**, swapping two pre-built renderers between runs so no rebuild sat between conditions:

|       pair |  before |   after |     delta |
| ---------: | ------: | ------: | --------: |
|          1 |     245 |     266 |       +21 |
|          2 |     281 |     274 |        −7 |
|          3 |     331 |     284 |       −47 |
|          4 |     287 |     239 |       −48 |
|          5 |     217 |     276 |       +59 |
|          6 |     375 |     313 |       −62 |
| **median** | **284** | **275** |   **−27** |
|   **mean** |   289.3 |   275.3 | **−14.0** |

Paired deltas favour _after_ in 4 of 6 pairs; stdev of the deltas is 47.2 ms.

**Honest reading: no measurable regression.** −14 ms mean against a 47 ms paired stdev is not distinguishable from zero. I am **not** claiming an improvement in this metric.

`domContentLoadedEventEnd` — the metric most directly tied to eager bundle size — is the cleaner signal, favouring _after_ in 5 of 6 pairs:

|        | samples (ms)                 |  median |  mean |
| ------ | ---------------------------- | ------: | ----: |
| before | 169, 157, 257, 254, 225, 188 |   206.5 | 208.3 |
| after  | 160, 166, 174, 165, 214, 181 | **170** | 176.7 |

Mechanistically consistent with −279 kB of eager JS to fetch, parse and execute.

---

## 7. Tests, typecheck, lint

| Check                                                                                   | Result                                                             |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `nx run-many -t typecheck --all`                                                        | **exit 0**, 89 projects, 0 errors                                  |
| `test shared`                                                                           | 642/642 (includes the 3,063-input equivalence suite)               |
| `test chat`                                                                             | 470/470                                                            |
| `test tasks-ui`                                                                         | 691 passed / 2 skipped                                             |
| `test ptah-extension-webview`                                                           | 25/25                                                              |
| `test core, chat-state, chat-streaming`                                                 | 241, 277, 660 — all pass                                           |
| `test rpc-handlers, vscode-core, vscode-lm-tools, agent-sdk`                            | 314, 144, 737, 1652 — pass except one pre-existing failure (below) |
| `lint` — shared, chat, tasks-ui, vscode-core, vscode-lm-tools, agent-sdk, webview, core | **0 errors** (pre-existing warnings only)                          |

**Not mine, verified by mtime rather than by `git status` letters:**

- `agent-sdk` `sdk-query-runner.service.spec.ts` — `ANTHROPIC_AUTH_TOKEN` is `""` not `undefined`. Concerns auth-env derivation; that spec references no symbol I touched. The implicated `session-query-executor.service.ts` has been dirty since **22:19**, before this session began.
- `settings-core` TC-18 isolation test — fails because it scans for the string `settings-core` and now finds `.ptah/specs/TASK_2026_197/tasks.md` (created **00:58**, another session's task folder). Triggered by the concurrent commit `eb10c5cb8 chore: track .ptah/specs in git history`.
- `rpc-handlers` had a missing-dependency lint error from the concurrent session's `output-style-rpc.handlers.ts`; it lints clean now — they fixed it mid-session.

### §D — the tree shifted mid-batch. It did, twice, and neither overlaps Unit 10.

1. **`HEAD` advanced** `5fd739b03 → eb10c5cb8` (`chore: track .ptah/specs in git history`). `git diff --name-only` over that range touches **only** `.gitignore` and `.ptah/specs/**` — **zero** overlap with any Unit 10 file.
2. **A concurrent session is actively building an `output-styles` feature in the working tree.** By mtime, its files cluster at 00:54–00:55 and 01:38–01:43 and 02:46, interleaved with mine at 01:03–01:39 and 02:45: `libs/backend/output-styles/` (new lib), `output-style-rpc.{handlers,schema}.ts`, `rpc-output-style.types.ts`, `rpc.types.ts`, `rpc-handler.ts`, `settings-core/schema/output-style-schema.ts`, both apps' `phase-2-libraries.ts`, `register-thoth-libraries.ts`, `.commitlintrc.json`, and `chat/settings/settings.component.*`.

**Unit 9's files were not touched** (`theme.service.ts` + spec, `theme-boot-lists.spec.ts`, `index.html`, `tailwind.config.js`, `project.json` — all still at their 00:33–00:41 mtimes). Units 7 and 8 were not run. Nothing was committed.

---

## 8. OUTSTANDING — HUMAN GATE

1. **I introduced, and fixed, a shipping-build break — please confirm the fix is complete.** Three app tsconfigs (`ptah-electron`, `ptah-cli`, `ptah-tui` `tsconfig.build.json`) **replace** `paths` wholesale instead of inheriting from `tsconfig.base.json`, so a new secondary entry point is invisible to their esbuild bundles. `ptah-electron:build-main` failed with `Could not resolve "@ptah-extension/shared/schemas"`. I added the mapping to all three and all four bundles now build. **This is a repo-wide trap**: any future secondary entry point must be added in four places, and nothing enforces it. Worth a ratchet.

2. **`metadata-patch-schema.lazy.ts` exists to work around an Nx rule, not for its own sake.** A direct `await import('@ptah-extension/shared/schemas')` in `TasksStore` makes `@nx/enforce-module-boundaries` classify **all of `@ptah-extension/shared`** as lazy-loaded from `tasks-ui`, rejecting ~15 ordinary static imports — **22 errors on a freshly reset graph** (measured both ways). The rule models projects, not entry points. Routing through a relative module gives identical chunks with no suppression. If you dislike the indirection, the alternative is hand-writing `TaskMetadataPatchSchema`, which I rejected in §2 because its messages are shown verbatim to users.

3. **`startup-tti.spec.ts` fails as a test even when its numbers are healthy, and it failed more often in the after condition.** `expect(fixtureBootTiming.paint.length).toBeGreaterThan(0)` — paint entries came back empty in **11 of 22** runs overall, but asymmetrically: **8 of 11 after-runs vs 3 of 11 before-runs**, including 6/6 in the interleaved after-condition. I could not resolve whether the after build paints before the harness observes, or whether this is harness flakiness that happened to cluster. **I am flagging it rather than dismissing it**: it is the one result I cannot fully explain, and it is the assertion that makes the spec red. The wall-clock and DCL numbers it prints are unaffected and are what §6 reports.

4. **A matched before/after via `git stash` was deliberately not attempted.** The precedent in `e2e-validation-report.md` §6.1 used `git stash push -u`, but that session's concurrent writer was only _committing_; mine has ~20 uncommitted files of in-flight feature work, and stashing would have captured and removed it. I used the one-file control instead (§6), which isolates both variables Unit 10 changes.

5. **`ptah-tui` does not build** — `Could not resolve "@ptah-extension/output-styles"` from `register-thoth-libraries.ts`. Same tsconfig-paths trap as item 1, in the concurrent session's feature. **I did not fix it** (not my unit, and they are mid-edit), but the tree currently ships a broken TUI bundle.

6. **`"sideEffects": false` was added to `libs/shared/package.json`** and is retained. It changed nothing on its own (§1b) but is load-bearing now that the schema modules are no longer reached. I verified `libs/shared` has no import-time side effects — every mutation found is inside a function body, and `reflect-metadata` is imported only under `src/testing/`, a separate entry point. Worth a second opinion, since the flag affects backend bundles too.

7. **Not committed**, per instructions. `libs/shared/src/index.ts` was modified under the explicit authorisation in the brief; nothing else on the I-8 DO-NOT-TOUCH list was touched. TASK_2026_196 was not fixed.
