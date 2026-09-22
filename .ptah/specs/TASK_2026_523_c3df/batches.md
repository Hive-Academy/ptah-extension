# Batches — TASK_2026_523_c3df

Decomposition of `implementation-plan.md` (1183 lines) into executable batches.
This file is the team-leader handoff. It does **not** restate the plan — read
`implementation-plan.md` for the ten decisions, the RPC contracts and the
evidence, and `design-spec.md` for the UI specification.

> **Naming collision, fixed here.** The plan's landing section reuses the labels
> `D1 / D2 / D3` for commits inside group D, which collide with the user
> decisions `D1 / D2 / D3` in `context.md`. This file uses **`D-i` / `D-ii` /
> `D-iii`** for the commits and reserves `D1 / D2 / D3` for the user decisions.

---

## The invariant that governs everything

**No intermediate commit may leave two writable editors for the same settings
key.** Reviewable mechanically: for every key in the plan's target key map,
`git grep` at every commit on the branch must find **at most one** component
that WRITES it. Reads may overlap — the Memory tab keeps a read-only summary and
the Skills tab keeps a link, both deliberate.

One PR. Small ordered commits inside it. The revert unit is the branch, because
a partial revert IS the forbidden two-editor state.

---

## Batches

| Batch | Scope | Executor | Parallel with | Commit |
| --- | --- | --- | --- | --- |
| **A** | Type promotion into `libs/shared`; `auth:getEffectiveRoute`; `ConfigScopeRpcHandlers` (`config:getScopes`, `config:clearScopeOverride`); `SCOPED_SETTING_KEYS`; DI phase-3 registration + `expected-resolvable` / `expected-absent` manifests | `backend-developer` | A2, B, C | Own; freely splittable |
| **A2** | `auth:verifyDraftConnection` + `auth:cancelDraftVerification`; `DraftVerificationService`; `ProviderAuthResolver.buildDraftOverride`; `ProbeFailureReason` union; the 1–10 classification precedence table | `backend-developer`, then `code-logic-reviewer` | A, B, C | Own; **sequence after A** if one person takes both — both edit `auth-rpc.handlers.ts` `METHODS` |
| **B** | `skillSynthesis.judgeProvider` + `skillSynthesis.enhanceTimeoutMs` in BOTH `file-settings-keys.ts` tables; settings DTO chain; `SkillEnhancerService` timeout read, optional `ProviderAuthResolver` injection, `resolveLaneModel` reuse | `backend-developer` | A, A2, C | Own |
| **C** | `ProviderModelPickerComponent` extensions (fixed-provider mode, catalog retry, disabled state, manual model entry); `ProviderMarkComponent`; `provider-marks.data.ts` | `frontend-developer` | A, A2, B | Own |
| **D-i** | Build the six `providers/` components + `ProvidersSettingsStateService` against stubs. Not mounted | `frontend-developer` | — (needs A, A2, B, C on the branch to compile) | Own; may be several commits, one per component |
| **D-ii + D-iii** | Mount the page in `SettingsComponent`; deep-link forwarding; wizard step-3 wiring onto `auth:verifyDraftConnection`; **and** all eight treatments from Decision 9; **and** the `LlmProvidersConfigComponent` reference check | `frontend-developer` (one person) | — | **ONE COMMIT. The only atomic pair in the task.** |
| **E** | The twelve behaviour pins from the plan's quality requirements | `senior-tester` | after A2, B, C | Own |
| **F** | Nx tag + boundary verification after the page lands | `code-style-reviewer` | after D-iii | Own |
| **G** | Release gate: `vsce package` + `vsce ls`, assert zero non-JS files carry a flagged token | `devops-engineer` | after C | Own — **blocks release, not merge** |

**A, A2, B and C are file-disjoint from each other** and can run in parallel with
different executors. Inside D-i the six components are file-disjoint and can be
parallelised; D-ii/D-iii is one integration by one person.

---

## Dual-registration: only the compile-time half is needed

All five new RPC methods sit under prefixes that **already exist** in
`ALLOWED_METHOD_PREFIXES` — `config:` at `rpc-handler.ts:52`, `auth:` at `:56`.
So batches A and A2 add entries to the `RpcMethodName` union in
`libs/shared/.../rpc.types.ts` and to `RPC_HANDLER_MANIFEST`, and touch the
runtime allowlist **not at all**. The silent-crash failure mode CLAUDE.md warns
about cannot occur here. Do not add a prefix; do not "fix" the allowlist.

(While you are there: the constant is at `rpc-handler.ts:44`. Root `CLAUDE.md`
and `libs/backend/rpc-handlers/CLAUDE.md` both say `:46` and are wrong.
`libs/backend/vscode-core/CLAUDE.md` says `:44` and is right.)

## The three traps that will bite an executor who skims

Each of these is a silent failure — it compiles, it looks right in review, and it
breaks at runtime with no error.

1. **The `''` / `'inherit'` sentinel (batch C + D).** `ProviderModelPickerComponent`
   emits `''` for inherit. `resolveJudgeModel` (`model-resolver.ts:171`) matches
   only the literal `'inherit'`. A naive swap of the free-text input for the
   picker sends an **empty model string** to the provider and silently breaks
   skill enhancement — worse than the 30 s timeout that started this task. The
   translation happens at the binding and the plan names its owner. Pin it.

2. **A pinned `judgeProvider` changes the MODEL rule too (batch B).**
   `buildLaneEnv` blanks the tier env by design, so a pinned dated model id has
   no tier mapping left to travel through and reaches the endpoint verbatim.
   Reuse `resolveLaneModel` (`lane-resolver.service.ts:156-164`) rather than
   restating it. Enhancement stays **not** a lane; only the resolution rule is
   shared.

3. **`libs/frontend/ui` is `type:ui` (batch C).** The Nx rule confines it to
   `['type:ui','type:util']` and it must never import `@ptah-extension/core` —
   pinned by `dependency-boundaries.spec.ts`, which also pins the tag and the
   constraint list. Every picker extension arrives through an **injected port**,
   the way `PROVIDER_MODELS_LOADER` already does. Reaching for a service is the
   natural move and it will fail lint.

---

## Carried-over fixes and where they live

| Fix | Batch |
| --- | --- |
| Raise / expose `ENHANCE_TIMEOUT_MS` → `skillSynthesis.enhanceTimeoutMs` | B |
| Free-text judge-model input → shared picker, relabelled "Judging and enhancement" | C (extension) + D-ii/iii (mount + removal) |
| Surface the memory-curator model in the consolidated place | D-ii/iii |

---

## Out of scope, deliberately

- **Removing the `authMethod` store default** (plan Decision 2). Changes a value
  read on every session-start path in three hosts, for a benefit Decision 1
  already delivers. Its own task with its own test matrix.
- **Scoped writes for memory and skill keys.** Only auth keys have a scoped
  write path today (`memory-rpc.handlers.ts:707` takes no scope argument). The
  panel shows provenance everywhere but offers the override control only where
  `writeScopes` allows it. Widening that is a separate task.
- **`anthropicProviderId` default divergence** — `file-settings-keys.ts:443`
  says `'openrouter'`, `auth-schema.ts:22` says `''`. Pre-existing. This task
  makes it VISIBLE for the first time, so expect it to be reported. Do not fix
  it here without measuring who reads each default.
- **Fixing `auth:testConnection` directly.** A2 supersedes it for the wizard
  path; the old method keeps its callers until D-iii removes them.

---

## Open items with owners

| Item | Owner | Blocks |
| --- | --- | --- |
| `vsce package` + `vsce ls` against a **throwaway** extension id | `devops-engineer` (batch G) | Release. An ID that fails validation is permanently burned |
| Final single-owner consistency read of `implementation-plan.md` | orchestrator | Handoff — **done**; no duplicate headings, risks 1–11 ordered |

---

## Provenance

| Artifact | Lane | Verified by orchestrator |
| --- | --- | --- |
| `research-report.md` | antigravity, `researcher-expert` | 11 provider ids + line numbers exact; 4 cited paths exist |
| `design-spec.md` | codex, `ui-ux-designer` | `saveAndTest` ordering confirmed; component inventory checked against `libs/frontend/ui` barrel |
| `implementation-plan.md` | claude cli (Subscription), `software-architect`, 3 revisions | `file-settings-keys.ts:442/154/443`, `eslint.config.mjs:263-266`, `rpc-handler.ts:44`, `auth-schema.ts:22`, `claude-rpc.service.ts:129`, `app-state.service.ts:906`, `auth-rpc.handlers.ts:819-833`, `memory-rpc.handlers.ts:707` — all exact |

Two lanes wrote `implementation-plan.md` concurrently. Neither clobbered the
other; the second verified the first's `§4` and closed its two gaps. Consistency
read performed and clean.
