# Survey A — rpc-handlers + skill-synthesis + task-specs

TASK_2026_268, partition A. 13 files, all > 1000 LOC. Measured 2026-08-17 on
branch `ak/tui-defects`.

**Two files are EXEMPT.** Eleven carry a proposed cut.

## A registration fact that de-risks every rpc-handlers row below

The dual-registration rule (`RpcMethodName` in `libs/shared/.../rpc.types.ts` +
`ALLOWED_METHOD_PREFIXES` at
`D:/projects/ptah-extension/libs/backend/vscode-core/src/messaging/rpc-handler.ts:40`)
fires on a **new namespace prefix**. Every cut proposed here keeps the existing
prefix (`skillSynthesis:`, `tasks:`, `auth:`, `agent:`, `session:`,
`setup-wizard:`/`wizard:`) and **moves no method name**. So:

- `ALLOWED_METHOD_PREFIXES` — **untouched in all six rpc-handlers proposals.**
- `RpcMethodName` — **untouched.** No method is added, removed or renamed.
- `RPC_HANDLER_MANIFEST`
  (`D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts:114`)
  — touched **only** by the one proposal that adds a second handler CLASS
  (skills-synthesis, step 2). Its two invariants (disjoint + total, asserted in
  `manifest.spec.ts` and `rpc-allowlist.spec.ts`) mechanically catch a botched
  `METHODS` tuple split at test time, not at runtime.
- Host profiles — **untouched even then**, because a second `skillSynthesis`
  entry reuses `requires: ['skillSynthesis']`, a capability every profile already
  sets (`apps/ptah-electron/src/rpc-host-profile.ts:26`).

Every other rpc-handlers proposal here is the **facade** technique: the handler
class keeps its `METHODS` tuple, its `register()` and every `registerX()`
wrapper, and delegates the BODY to an injected collaborator. Nothing in the
registration chain sees it.

## Ranked table

| #   | File (LOC)                                | Classification                                  | Verdict                                                                                              | Effort                    |
| --- | ----------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------- |
| 1   | `setup-rpc.handlers.ts` (1272)            | Facade collaborator                             | 450 lines of memory-document authoring live inside an RPC handler. Real buried seam.                 | S–M, behaviour-preserving |
| 2   | `task-doctor.service.ts` (1033)           | Facade, 2 collaborators                         | The file header names its own two rules; the split is exactly those two.                             | M, behaviour-preserving   |
| 3   | `skills-synthesis-rpc.handlers.ts` (2295) | Type/projection split, then RPC namespace split | 370 lines of pure DTO projection + three distinct method families under one 18-dep class.            | S then M                  |
| 4   | `skill-candidate.store.ts` (1462)         | Store facade, split by query group              | Three query groups with disjoint row mappers. Textbook technique-2 case.                             | M, behaviour-preserving   |
| 5   | `skill-gap-curator.service.ts` (1238)     | Facade collaborator                             | Four measuring sweeps + one LLM authoring pass with its own rubric contract.                         | M, behaviour-preserving   |
| 6   | `tasks-rpc.handlers.ts` (1515)            | Facade, 2 collaborators                         | Bulk mutation engine and saved-view persistence, neither of them RPC plumbing.                       | M, behaviour-preserving   |
| 7   | `skill-enhancer.service.ts` (1009)        | Facade collaborator                             | Prompt/context assembly is 260 lines and owns 3 of the 11 injected deps.                             | M, needs doc-line refresh |
| 8   | `session-rpc.handlers.ts` (1247)          | Facade collaborator                             | Transcript-locating concern, **duplicated** in row 9's file.                                         | S–M, behaviour-preserving |
| 9   | `agent-rpc.handlers.ts` (1068)            | Facade, 2 collaborators                         | Orchestration-config store + ptah-cli resume, plus the duplicate locator.                            | M, behaviour-preserving   |
| 10  | `auth-rpc.handlers.ts` (1009)             | Facade collaborator                             | One real query group; the rest is 19 coherent methods. Low payoff.                                   | M, low value              |
| 11  | `skill-synthesis.service.ts` (1232)       | Facade collaborator (small)                     | **Largely at its natural size after TASK_2026_256.** One small consistency cut only.                 | S, low value              |
| 12  | `chat-session.service.ts` (1091)          | **EXEMPT** (with escalation)                    | 20-dep constructor is the defect; no line-count cut fixes it and every big cut violates guardrail 3. | —                         |
| 13  | `skill-drain.service.ts` (1090)           | **EXEMPT**                                      | 530 of 1090 lines are decision-carrying rationale on constants. Class body is ~550.                  | —                         |

---

## 1. `setup-rpc.handlers.ts` — 1272

`D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/setup-rpc.handlers.ts`

**Classification** — facade with one collaborator.

**Verdict — real seam, and it is the cleanest one in the partition.** The class
mixes two concerns that share nothing but a caller. The first is an RPC surface:
`registerGetStatus`, `registerLaunchWizard`, `registerDeepAnalyze`,
`registerRecommendAgents`, `registerCancelAnalysis`, `registerListAnalyses`,
`registerLoadAnalysis`, `registerListAgentPacks`, `registerInstallPackAgents`
(lines 147–819). The second is **markdown-document authoring for the memory
store** — `seedWizardMemory` (834–933), `resolveMemoryWriterOrNull` (939–947),
`buildProjectProfileContent` (949–1009), `buildCodeConventionsContent`
(1011–1051), `buildKeyFilesContent` (1053–1196), plus the module-level text
utilities `capUtf8`, `truncateList`, `extractH2Section`, `extractBullets`,
`escapeRegExp` (1203–1271). That second block classifies file paths, extracts H2
sections, caps UTF-8 byte length and composes three memory documents. Not one
line of it is RPC, and its only entry point is a single awaited call inside
`registerDeepAnalyze`.

**Proposed cut** — new file
`libs/backend/rpc-handlers/src/lib/setup/wizard-memory-seeder.ts`, class
`WizardMemorySeeder`, one public method
`seed(workspaceRoot, manifest, phaseContents): Promise<void>`. Move lines
822–1271 verbatim. The seeder injects `PLATFORM_TOKENS.DI_CONTAINER` (it already
resolves `IFileSystemProvider` and the memory writer lazily through
`resolveService`) plus `TOKENS.LOGGER` — 2 deps. `SetupRpcHandlers` gains one
injected dep (7 → 8, at the gate but not past it) and `registerDeepAnalyze`
becomes `await this.memorySeeder.seed(...)`.

Resulting sizes: handler ≈ 820, seeder ≈ 450.

**Risk** — low. No method NAMES change; `METHODS`, `register()` and the manifest
entry are untouched, so neither `ALLOWED_METHOD_PREFIXES` nor `RpcMethodName` is
in scope. The one behavioural contract to preserve is the three-layer failure
swallowing documented at 822–833: resolution guard, fingerprint guard, per-seed
try/catch — the wizard response must still reach the caller when seeding fails.
Keep `seed()` returning `Promise<void>` and never rejecting.

**Effort** — S–M, behaviour-preserving.

---

## 2. `task-doctor.service.ts` — 1033

`D:/projects/ptah-extension/libs/backend/task-specs/src/lib/task-doctor.service.ts`

**Classification** — facade, two collaborators.

**Verdict — real seam, and the file's own header states it.** Lines 4–17 name
the two rules that shape the file: (1) `plan()` is pure computation and `apply()`
is the only mutator; (2) "the journal IS the undo". Those are two concerns, and
the code already groups along them, it just is not filed that way.

- **Diagnosis** (pure, no mutation): `crossFileWarnings` (245–254),
  `statusContradiction` (280–298), `isUninformativeTitle` (321–334),
  `inspectCarrier` (721–766), `planAdoption` (776–813), `readDeclaredMetadata`
  (828–872), `inferTitle` (885–926), `listTaskFolders` (696–704),
  `listFileNames` (706–713).
- **Journal / stamp** (durability): `stampRefusal` (638–659), `readStamp`
  (668–694), `buildJournalEntries` (935–973), `revertEntry` (1009–1031), plus
  `JOURNAL_FILE` and `CONTRACT_STAMP_FILE` (69–70).
- **Orchestration** (what stays): `plan` (361–442), `apply` (460–563), `undo`
  (570–632), `executeAction` (975–1007).

**Proposed cut** — two new files in the same directory:

- `task-carrier-inspector.ts` → `TaskCarrierInspector`. Injects
  `IFileSystemProvider` + `Logger`. Public: `inspect(specsDir)` returning the
  per-folder inspection the current `plan()` builds inline, and
  `planAdoption(folderPath, folderName, docs)`. ≈ 330 lines.
- `doctor-journal.store.ts` → `DoctorJournalStore`. Injects
  `IFileSystemProvider` + `Logger`. Public: `readStamp`, `writeStamp`,
  `stampRefusal`, `write(entries)`, `read()`, `revert(entry)`. ≈ 230 lines.
- `TaskDoctorService` keeps `plan` / `apply` / `undo` / `executeAction` and gains
  2 deps: 3 → 5. ≈ 420 lines.

**Risk** — medium, and it is concentrated in one place: `apply()` writes the
journal BEFORE it mutates and **aborts outright if that write fails** (header
lines 12–17). The store must surface a write failure as a thrown/false result
that `apply()` still honours — a store that logs-and-continues turns a documented
abort into silent data loss. Also preserve "an UNREADABLE stamp fails closed"
(28–29). Neither concern changes shape under the split; both must be asserted
against after it. Nothing in this file is on an RPC path, so no registration
surface is involved.

**Effort** — M, behaviour-preserving (with two invariants worth a targeted test
each).

---

## 3. `skills-synthesis-rpc.handlers.ts` — 2295

`D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts`

**Classification** — projection/type split (step 1), then RPC-handler namespace
split (step 2).

**Verdict — real seam, but it is two seams of very different price, and only the
first should be assumed.** The class is 231–1927; **lines 1929–2294 are not in
the class at all** — they are 15 module-level pure projections (`clampLimit`,
`toJudgeCriteria`, `isRecord`, `toPanelCriteria`, `toPanelRationale`,
`toPanelRationales`, `toSummary`, `toDetail`, `toSuggestionSummary`,
`toSuggestionDetail`, `toQueueItem`, `toStageSpend`, `toDrainRun`,
`toDigestItem`, `toInvocation`) mapping store rows to wire DTOs. That is 370
lines with no dependency on the class at all.

Inside the class, 42 `registerX()` methods fall into three families that share
almost no dependencies:

- **Pipeline** (candidates, settings, triggers, lanes, diagnostics, queue,
  digest, bulk) — lines 389–919 and 1512–1762.
- **Library / clones** (`listClones` … `getScorecardDetail`) — 921–1377.
- **Suggestions + specs** (`listSuggestions` … `clearStaleSpecs`) — 1379–1641.

The constructor injects **18 dependencies** (278–339), thirteen of them
`isOptional`. That number is the honest signal here: the class is a union of
three surfaces, not one.

**Proposed cut, step 1 (do this first, it is nearly free)** — move 1929–2294 to
`skills-synthesis-rpc.projections.ts`, exporting each function. File drops
2295 → ~1930. Zero risk: no class member moves, no DI, no registration.

**Proposed cut, step 2** — two additional handler classes in the same directory,
each with its own `static readonly METHODS` slice of the existing tuple
(233–276) and its own `RPC_HANDLER_MANIFEST` entry keyed `skillSynthesisLibrary`
/ `skillSynthesisSuggestions`, both `requires: ['skillSynthesis']`:

- `skill-library-rpc.handlers.ts` → `SkillLibraryRpcHandlers`, taking the 12
  clone/enhancement/scorecard methods and deps `enhancer`, `registry`, `mirror`,
  `contentDownload`, `scorecard`, `workspaceProvider`, `logger`, `rpcHandler`,
  `sentryService` — plus the private helpers `toCloneSummary` (1823–1852),
  `readCloneBody` (1854–1877), `isUnder` (1879–1883), `resolveUpstreamSourceDir`
  (1885–1906). ≈ 560 lines, 9 deps (**one over the ~8 gate — flagged**;
  `sentryService` + `logger` could fold behind the shared `report()` helper to
  land at 8).
- `skill-suggestions-rpc.handlers.ts` → `SkillSuggestionsRpcHandlers`, taking the
  8 suggestion+spec methods and deps `suggestionStore`, `specHarvester`,
  `synthesis`, `workspaceProvider`, `logger`, `rpcHandler`, `sentryService`.
  ≈ 300 lines, 7 deps.
- The residual `SkillsSynthesisRpcHandlers` ≈ 1070 lines, 12 deps. **Still over
  700 and still over the dep gate.** State that plainly: this file does not reach
  the ceiling in one pass, and chasing it with a fourth class would be fragment
  sprawl.

**Risk** — the `METHODS` tuple split is the whole risk, and it is a _compile and
test_ risk, not a runtime one: `manifest.spec.ts` asserts the union of all
entries is exactly `RPC_METHOD_NAMES` and pairwise disjoint, so a dropped or
duplicated method name fails a test. `ALLOWED_METHOD_PREFIXES` is untouched (the
prefix stays `skillSynthesis:`). `RpcMethodName` is untouched. **No method name
changes.** Secondary: `parseParams`, `requireDesktop`, `toUserError` and
`report` (1788–1926) are used by all three families — they must be lifted to a
shared module (`skills-synthesis-rpc.guards.ts`) rather than copied.

**Effort** — step 1 S; step 2 M. Both behaviour-preserving.

---

## 4. `skill-candidate.store.ts` — 1462

`D:/projects/ptah-extension/libs/backend/skill-synthesis/src/lib/skill-candidate.store.ts`

**Classification** — store facade, split by query group (technique 2).

**Verdict — real seam.** Three query groups, and — checked, not assumed — their
row mappers partition cleanly along the same lines:

- **Candidate lifecycle** (stays on the facade): `registerCandidate`, `findById`,
  `findByTrajectoryHash`, `findByName`, `listByStatus`,
  `listActiveOrderedByDecayScore`, `setResidency`, `listDormantPromotedSlugs`,
  `listActiveOrderedByActivity`, `updateStatus`, `incrementSuccess`,
  `incrementFailure`, `setPin`, `countDistinctContexts`, `getStats`, the whole
  embedding group (1263–1362), and `toCandidateRow`. `toCandidateRow` is called
  only at 224, 232, 240, 250, 341 — all in this group.
- **Gate verdicts**: `recordJudgeVerdict` (413–468), `recordJudgePanel`
  (494–542), `setDisplayName` (551–563), `recordReplay` (591–634),
  `recordTriggerEval` (653–700), `toJudgeStatus` (1371–1381). ≈ 320 lines.
  **No call to `toCandidateRow`** — these are write-only.
- **Invocation telemetry**: `recordInvocation` (771–803), `recordSkillEvent`
  (805–857), `getWinRates` (926–969), `reconcileSubagentEvent` (991–1039),
  `applyReconciliation`, `toWindowVerdictSource`, `getInvocationStats`
  (1068–1098), `getScorecardAggregates` (1109–1157), `listGradedInvocations`,
  `emptyScorecardAggregate`, `getDominantSkillSlugForSessions`,
  `getRecentSessionsForSlug`, `listInvocations`, `toInvocationRow` (the only
  caller of which is 1257, inside this group). ≈ 480 lines.

**Proposed cut** — two collaborators beside the store, each injecting
`PERSISTENCE_TOKENS.SQLITE_CONNECTION` directly (the store already reaches the
handle through a lazy `private get db()` at 172–174, so no handle needs
threading):

- `skill-candidate-gate.store.ts` → `SkillCandidateGateStore` ≈ 320
- `skill-invocation.store.ts` → `SkillInvocationStore` ≈ 480
- `SkillCandidateStore` keeps the lifecycle + embedding group and delegates the
  other two verbatim. ≈ 680 lines, constructor 3 → 5 deps.

**Do NOT** extract the embedding group (`getEmbedding`,
`searchActiveByEmbedding`, `setEmbedding`, `insertEmbedding`, `readEmbedding`,
1263–1362, ≈ 105 lines): it is under the 150-line floor and
`searchActiveByEmbedding` straddles candidate reads and vec, so it belongs with
the lifecycle group. Guardrail 2.

**Risk** — one documented invariant governs this cut, from
`libs/backend/skill-synthesis/CLAUDE.md`: _"`SkillCandidateStore` is therefore the
enforcing gate on both edges"_ and _"Do not add a second validation layer above
the store, and do not catch and downgrade."_ The split keeps enforcement inside
the store FAMILY, not above it — but the throw-on-non-member-`JudgeStatus`, the
throw on `scored` with a non-finite score and the throw on a non-`scored` status
carrying a number must **move with `recordJudgeVerdict`, not be duplicated** in
the facade. Same for "the nine judge columns are written as ONE fixed UPDATE,
never a dynamic fragment" — copy the statement verbatim. `LEGAL_TRANSITIONS`
(156–160) and `updateStatus` stay together on the facade. All consumers inject
via `SKILL_SYNTHESIS_TOKENS.SKILL_CANDIDATE_STORE` or the class token
(`SkillGapCuratorService` uses `@inject(SkillCandidateStore)`); the facade keeps
both working unchanged.

**Effort** — M, behaviour-preserving.

---

## 5. `skill-gap-curator.service.ts` — 1238

`D:/projects/ptah-extension/libs/backend/skill-synthesis/src/lib/digest/skill-gap-curator.service.ts`

**Classification** — facade with one collaborator.

**Verdict — real seam.** The class (558–1237) runs four MEASURING sweeps
(`collectMissedTriggers`, `sweepFrictionOpportunities`/`clusterFriction`,
`sweepWinRates`, `sweepMemorySignals`) plus one **LLM AUTHORING pass** that has
nothing structurally in common with them: `applyDescriptionRewrites` (768–807),
`collectRewriteTargets` (816–846), `authorClauses` (857–896), and the
module-level `parseRewrites` (458–472), `selectFreshClauses` (481–495),
`composeDescription` (508–533), `buildRewritePrompt` (541–555), `isCovered`
(385–391), `clampWords` (362–368), the ten `DIGEST_REWRITE_*` constants and
`DIGEST_REWRITE_RUBRIC`. The authoring pass is the only consumer of
`laneRunner`, the only thing gated by `allowRewrite`, and the only thing that can
spend tokens.

**Proposed cut** — new file
`libs/backend/skill-synthesis/src/lib/digest/skill-description-rewriter.ts`,
class `SkillDescriptionRewriter`, one public method
`rewrite(found, allowRewrite): Promise<Map<slug, string>>`. Move the members and
free functions listed above plus the `DIGEST_REWRITE_*` block. It injects
`TOKENS.LOGGER` and `SKILL_SYNTHESIS_TOKENS.LANE_RUNNER_SERVICE`
(`{isOptional: true}`) — 2 deps. `SkillGapCuratorService` swaps `laneRunner` for
the rewriter, so its constructor stays at 6 and `runDigest` line 638 becomes
`await this.rewriter.rewrite(missed, allowRewrite)`.

Resulting sizes: curator ≈ 830, rewriter ≈ 410.

**Risk** — medium, and two invariants ride along:

1. `allowRewrite === true`, **not** `?? false` (documented at 594–623: the digest
   RPC is called automatically by the Skills tab and by four background event
   kinds, and `digest` rows are never drained, so nothing else gates this spend).
   **The `=== true` must stay in `runDigest`, at the curator**, not migrate into
   the rewriter — the doc is explicit that "a default at a caller protects that
   caller only".
2. The rewrite rubric must keep riding `systemPromptAppend`, never `prompt` — see
   the lane bullet in `libs/backend/skill-synthesis/CLAUDE.md`: `maxInputChars`
   clips `prompt` and would silently eat the "reply with ONLY JSON" instruction.
   Moving `DIGEST_REWRITE_RUBRIC` into a file named for the rewriter makes that
   easier to hold, not harder.

**Effort** — M, behaviour-preserving.

---

## 6. `tasks-rpc.handlers.ts` — 1515

`D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/tasks-rpc.handlers.ts`

**Classification** — facade, two collaborators.

**Verdict — real seam, though less dramatic than rows 1–2.** Two concerns are
neither RPC plumbing nor task-spec domain logic, but sit here anyway:

- **Bulk mutation engine**: `dedupeTaskIds` (210–220), `nextLabels` (246–258),
  `registerBulkUpdateStatus` (929–973), `applyBulkStatus` (994–1041),
  `registerBulkUpdateLabel` (1058–1136), `applyBulkLabel` (1168–1258),
  `toBulkEntry` (1267–1277), `rebuildAfterBulk` (1301–1313), `readCurrentStatus`
  (1330–1336). ≈ 400 lines of per-item mutation, partial-failure accounting and
  registry rebuild — a transaction-shaped concern that happens to be reachable
  over RPC.
- **Saved views persistence**: `registerGetViews` (352–361), `registerSaveViews`
  (372–456), `readViews` (468–511), `readActiveViewId` (520–530). ≈ 180 lines of
  settings read/validate/clamp against `MAX_SAVED_TASK_VIEWS`. Its only tie to
  the rest of the class is that it is served on the same namespace.

**Proposed cut** — two new files:

- `libs/backend/rpc-handlers/src/lib/tasks/task-bulk-mutation.service.ts` →
  `TaskBulkMutationService`. Public: `updateStatus(root, taskIds, status)` and
  `updateLabel(root, taskIds, label, mode)`, each returning the existing
  `TasksBulkResultItem[]` shape. Injects `TaskWriterService`,
  `RegistryGeneratorService`, `TaskIndexService`, `Logger` — 4 deps. ≈ 410.
- `libs/backend/rpc-handlers/src/lib/tasks/saved-task-view.store.ts` →
  `SavedTaskViewStore`. Public: `read()`, `readActiveId()`, `save(views,
activeId)`. Injects `SETTINGS_TOKENS.TASKS_SETTINGS` + `Logger` — 2 deps. ≈ 190.
- `TasksRpcHandlers` keeps all 17 `registerX()` wrappers, `METHODS`,
  `resolveRoot`, `parse`, `sanitize`, `broadcastChanged`, `groupByStatus`,
  `toWireAction`. Constructor 10 → 10 (it sheds `TASK_WRITER`,
  `REGISTRY_GENERATOR` and `TASKS_SETTINGS` to the collaborators but
  `registerCreate`/`registerUpdateStatus` still need the writer, so call it
  10 → 9). ≈ 950 lines. **Still over 700** — say so; the residual is 17 genuine
  RPC methods and there is no third seam worth inventing.

**Risk** — low. Facade only: **no manifest change, no `METHODS` change, no
method rename**, so neither leg of dual-registration is in scope. The one
behaviour to preserve is the ordering in `applyBulkStatus`/`applyBulkLabel`:
per-item failures are collected, not thrown, and `rebuildAfterBulk` runs once
after the loop. Preserve the `broadcastChanged` emission point exactly — it feeds
the Tasks board's live refresh.

**Effort** — M, behaviour-preserving.

---

## 7. `skill-enhancer.service.ts` — 1009

`D:/projects/ptah-extension/libs/backend/skill-synthesis/src/lib/skill-enhancer.service.ts`

**Classification** — facade with one collaborator.

**Verdict — real seam.** `generateCandidate` (677–769) is a 90-line LLM call
sitting on top of ~170 lines of context assembly that exists only to build its
prompt: `bestPracticeGuidance` (776–800), `collectTrajectorySignal` (802–830),
`collectSpecFindings` (832–844), `buildAgentScorecardBlock` (852–865),
`hasScorecardData` (868–880), `formatScorecardBlock` (882–915), and the three
formatters `fmtCount` / `fmtCost` / `fmtDuration` (989–1008). Those own three of
the service's eleven injected dependencies (`TrajectoryExtractor`,
`SPEC_FINDINGS_TOKEN`, `SKILL_SCORECARD_SERVICE`) and are used nowhere else. The
service's actual job — eligibility, proposal cache, apply/revert/repropagate — is
a different thing.

**Proposed cut** — new file
`libs/backend/skill-synthesis/src/lib/enhancement-prompt-composer.ts`, class
`EnhancementPromptComposer`, public
`compose(slug, currentBody, kind, workspaceRoot): Promise<{systemPromptAppend, prompt}>`
(or whatever pair `generateCandidate` currently assembles). It injects
`TrajectoryExtractor`, `SPEC_FINDINGS_TOKEN` `{isOptional}`,
`SKILL_SCORECARD_SERVICE` `{isOptional}`, `Logger` — 4 deps.
`SkillEnhancerService` drops those three and gains one: 11 → 9. **Still one over
the ~8 gate — flagged**, but moving in the right direction, which the current
shape is not.

Resulting sizes: enhancer ≈ 750, composer ≈ 270.

**Risk** — medium, and it is documentation risk as much as code risk.
`libs/backend/skill-synthesis/CLAUDE.md` cites **two line numbers inside this
file** that a split invalidates:

- `skill-enhancer.service.ts:733` — the `extract(..., TRAJECTORY_MIN_TURNS)` call
  that "genuinely requires 5 role turns where it used to get 2", pinned by a
  test. That call lives in `collectTrajectorySignal` and **moves**. The literal
  argument must travel verbatim; the CLAUDE.md citation must be re-pointed.
- `skill-enhancer.service.ts:690` — `resolveJudgeModel(...)` handed to
  `internalQuery.execute` with **no `auth`** ("it is not a lane but does run
  under the same ambient env"). That call is in `generateCandidate` and should
  **stay** on the enhancer, pinned by `skill-enhancer.service.spec.ts` ("the
  model handed to InternalQuery"). Do not let it drift into the composer — the
  composer must not acquire an `internalQuery` dep.

**Effort** — M, behaviour-preserving code, plus a required CLAUDE.md line-number
refresh.

---

## 8. `session-rpc.handlers.ts` — 1247

`D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts`

**Classification** — facade with one collaborator.

**Verdict — real seam, and its main value is cross-file.** `resolveSessionsDir`
(1178–1215), `findSessionFile` (1142–1161), `listTranscriptIds` (1225–1246) and
`deleteSessionFiles` (540–651) are one concern: locating and removing Claude SDK
JSONL transcripts under `~/.claude/projects/`, working around the CLI's
path-escaping (exact → case-insensitive → `[-_]`-normalized → optional partial
match). That is filesystem archaeology, not RPC.

**The same logic is duplicated** at
`libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts:1038-1067`
(`sessionFileExists`), including a second copy of the
`normalize = (s) => s.toLowerCase().replace(/[-_]/g, '-')` helper and the same
three-way directory match — but **without** `resolveSessionsDir`'s
`allowPartialMatch` guard and its documented caveat (1171–1176) about callers
that treat a directory listing as authoritative. Two copies of a
path-escaping workaround that already carries a correctness footnote is the
finding here, more than the line count.

**Proposed cut** — new file
`libs/backend/rpc-handlers/src/lib/session/claude-transcript-locator.ts`, class
`ClaudeTranscriptLocator`. Public: `resolveSessionsDir(workspacePath, opts)`,
`findSessionFile(sessionId, workspacePath)`, `listTranscriptIds(workspacePath)`,
`deleteTranscript(sessionId, workspacePath)`. Injects `Logger` only — 1 dep.
`SessionRpcHandlers` gains one dep (9 → 10) and `AgentRpcHandlers` replaces
`sessionFileExists` with `locator.findSessionFile(...) !== null` (11 → 12 deps,
−30 lines).

Resulting sizes: session handler ≈ 1050 (**still over 700**), locator ≈ 210,
agent handler −30.

**Do NOT** extract the input guards (`validateSessionId`,
`validateUserMessageId`, `sanitizeForkTitle`, `sanitizeAnchorHint`,
`authorizeSessionAccess`, 157–239, ≈ 100 lines) — under the floor, and
`authorizeSessionAccess` is the privileged-operation gate that belongs beside the
methods it guards. Guardrail 2.

**Risk** — low-medium. Facade only; no manifest, `METHODS` or method-name change.
The one real hazard is the `allowPartialMatch` asymmetry: `findSessionFile`
passes `true`, `listTranscriptIds` passes nothing (i.e. `false`), and the header
at 1171–1176 explains why reversing either is a bug ("a wrong directory would
report live sessions as having no transcript"). Move that docblock with the
method. When adopting the locator in `agent-rpc`, note its current copy has no
partial-match branch — switching it to `findSessionFile` **widens** matching,
which is a behavioural change and needs a decision, not a silent adoption.

**Effort** — S–M. Behaviour-preserving in `session-rpc`; the `agent-rpc` adoption
needs the one-line behavioural review above.

---

## 9. `agent-rpc.handlers.ts` — 1068

`D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts`

**Classification** — facade, two collaborators.

**Verdict — real seam, moderate.** Three concerns under one `agent:` namespace:

- **Orchestration config**: `registerGetConfig` (142–228), `registerSetConfig`
  (230–344), `getAgentCfg` (927–935), `setAgentCfg` (941–947),
  `isCursorApiKeyConfigured` (954–965), `migrateAgentOrchestrationSettings`
  (977–1031). ≈ 330 lines of settings read/write/migrate.
- **Ptah-CLI session resume**: `registerResumeCliSession` (741–814),
  `mergePtahCliAgents` (816–836), `resumePtahCliSession` (838–902),
  `resolveDefaultPtahCliId` (904–918), `sessionFileExists` (1037–1066). ≈ 250.
- The rest (detect CLIs, list models, permission response, e2e seed, stop,
  continue) stays.

**Proposed cut** —

- `libs/backend/rpc-handlers/src/lib/agent/agent-orchestration-config.store.ts` →
  `AgentOrchestrationConfigStore`. Public: `read()`, `write(patch)`, `migrate()`.
  Injects `IWorkspaceProvider`, `IStateStorage`, `CodexAuthService`
  `{isOptional}`, `Logger` — 4 deps. ≈ 340.
- `libs/backend/rpc-handlers/src/lib/agent/ptah-cli-session-resume.service.ts` →
  `PtahCliSessionResumeService`. Injects `PtahCliRegistry`,
  `SessionMetadataStore`, `ClaudeTranscriptLocator` (from row 8), `Logger` — 4
  deps. ≈ 250.
- `AgentRpcHandlers` ≈ 500, constructor 11 → 8 (sheds `STATE_STORAGE`,
  `SDK_CODEX_AUTH`, `SDK_PTAH_CLI_REGISTRY`, `SDK_SESSION_METADATA_STORE`, gains
  2). **Lands exactly at the gate** — a good sign the cut is in the right place.

**Risk** — low-medium. Facade only; `METHODS`, manifest and prefixes untouched;
no method renamed. `migrateAgentOrchestrationSettings` is a one-shot settings
migration — verify it still runs exactly once per host and from the same call
site. Sequence after row 8 so the locator exists.

**Effort** — M, behaviour-preserving.

---

## 10. `auth-rpc.handlers.ts` — 1009

`D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/auth-rpc.handlers.ts`

**Classification** — facade with one collaborator.

**Verdict — one real query group; the remainder is length without a seam.** 19
methods on a coherent `auth:` namespace, most of them 30–60 lines each. The one
group that is genuinely a different concern is **auth-state projection**:
`resolveScopeFromKey` (65–85), `registerGetAuthStatus` (212–340, the file's
largest method at 128 lines), `registerGetStatus` (695–724),
`registerGetApiKeyStatus` (735–773), `registerGetScope` (861–904). Those five
read across `ProviderModelsService`, `ActiveProviderResolver`,
`CopilotAuthService`, `ICodexAuthService`, `ClaudeCliDetector` and
`WorkspaceScopeResolver` to assemble one status DTO. Everything else — the login
flows, save-settings, test-connection, clear-override — is a mutation per method
and does not cluster.

**Proposed cut** — new file
`libs/backend/rpc-handlers/src/lib/auth/auth-status-assembler.ts`, class
`AuthStatusAssembler`. Public: `assemble(params)`, `readScope()`,
`readApiKeyStatus()`. Injects `ProviderModelsService`, `ActiveProviderResolver`,
`CopilotAuthService`, `ICodexAuthService`, `ClaudeCliDetector`,
`WorkspaceScopeResolver`, `IAuthSecretsService`, `Logger` — **8 deps, at the
gate**. `AuthRpcHandlers` keeps the four `registerX()` wrappers delegating to it,
14 → 9 deps.

Resulting sizes: handler ≈ 730, assembler ≈ 290. This is the only file in the
partition where a single cut lands the residual near 700.

**Secondary observation, not a proposal** — `autoMapProviderTiers` (958–998)
derives tier mappings locally. `libs/backend/skill-synthesis/CLAUDE.md` documents
`auth-providers/src/lib/model-tier-derivation.ts` as the shared derivation used
by both the chat and lane paths (TASK_2026_262). Worth _checking_ whether this is
a third copy of that derivation; if it is, that is a correctness finding, not a
size one, and belongs in its own task. I did not verify it — stated as a lead.

**Risk** — low. Facade only; no registration surface touched, no method renamed.
`registerGetAuthStatus` reaches five providers and swallows per-provider failure;
preserve the per-provider try/catch granularity so one unconfigured provider
still cannot blank the whole status.

**Effort** — M. Low value relative to rows 1–7.

---

## 11. `skill-synthesis.service.ts` — 1232

`D:/projects/ptah-extension/libs/backend/skill-synthesis/src/lib/skill-synthesis.service.ts`

**Classification** — facade with one small collaborator.

**Verdict — largely at its natural size. A second big cut is NOT warranted.**
TASK_2026_256 already removed the six stage protocols; what remains is coherent.
The mass is:

- `analyzeSession` (511–756, **245 lines**) — this is the service's reason to
  exist. `libs/backend/skill-synthesis/CLAUDE.md` documents "One path to
  `analyzeSession`" as an invariant. It must not move. Its first 50 lines
  (532–563) are a legacy positional-overload normalizer that could be a private
  `normalizeAnalyzeArgs()` in the same file — a readability tidy, not a split.
- `start()` (263–362) — the **documented registration seam**. Line 273 calls
  `stageHandlers.registerStageHandlers(this)` ABOVE both early returns, pinned by
  `skill-synthesis.stage-handlers.spec.ts` and verified by mutation during 256.
  Untouchable.
- `enqueueAnalyze` (401–475) — the shared entry point whose `turn_count` contract
  is documented. Stays.

Three sub-1000-line candidates exist and two fail guardrail 2 (`promote` /
`reject` / `rejectBulk` / `promoteBulk` / `rejectByPattern` ≈ 95 lines; the event
ring + counters `pushEvent` … `rolloverCountersIfNewDay` ≈ 95 lines). Do not
create either just to satisfy a ceiling.

**Proposed cut (the only one worth taking)** — `readSettings` (1120–1212, ≈ 95
lines) plus `SETTINGS_DEFAULTS` becomes a free function
`readSkillSynthesisSettings(ws: IWorkspaceProvider): SkillSynthesisSettings` in
`libs/backend/skill-synthesis/src/lib/skill-synthesis-settings.ts`. The argument
is **consistency, not size**: this lib already exports exactly this pattern —
`readSkillLanes` (`lanes/skill-lane-config.ts`) and `readSkillTriggers` — as free
functions consumed directly by `SkillsSynthesisRpcHandlers`. `readSettings()`
stays on the service as a one-line delegate so the `SkillStageWorkers` port and
`start()` are unchanged. ≈ 120 lines out; file → ~1110.

The event-ring extraction (`SkillSynthesisTelemetry`) is a defensible _second_
option because `SkillSynthesisDiagnosticsService` already consumes exactly those
three readers (`diagnostics.service.ts:30,32,33` call `lastRunSummary`,
`recentEvents`, `getEligibilityHistogram`) and it would carry
`TOKENS.WEBVIEW_MANAGER` out of a 14-dep constructor. But at ≈ 95 lines of body
it needs its fields and docs to clear 150, and the facade must keep all three
readers so `diagnostics.service.ts` is untouched. Take it only if the dep count
is the goal.

**Risk** — low for the settings cut (pure read, no I/O beyond
`getConfiguration`). The one thing to hold: the inner `get()` swallows throws and
coerces `null`/`undefined` to the fallback — that behaviour is load-bearing for
hosts with no config provider.

**Effort** — S. Low value; schedule last among the non-exempt.

---

## 12. `chat-session.service.ts` — 1091 — **EXEMPT (with escalation)**

`D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts`

**Classification** — EXEMPT for the purposes of this survey.

**Exemption reason** — **the length is a symptom and the cut would not treat it.**
The file's mass is four session-lifecycle methods that share essentially the same
dependency set: `startSession` (321–487, 166), `continueSession` (493–608, 115),
`resumeSession` (616–766, 150), `autoResumeIfInactive` (953–1066, 113) —
545 lines that are one concern (start / continue / resume / auto-resume a chat
session), correctly co-located. Extracting any of them produces a collaborator
needing 12–15 of the constructor's dependencies, which is guardrail 3 violated in
the most direct way available.

**The real finding is the constructor: 20 injected dependencies** (115–161) —
`Logger`, `WebviewManager`, `ConfigManager`, `IAgentAdapter`, `SentryService`,
`CodeExecutionMCP`, `SessionHistoryReaderService`, `SubagentRegistryService`,
`SlashCommandInterceptor`, `SessionMetadataStore`, `IWorkspaceProvider`,
`IPlatformInfo`, `ChatSdkContextService`, `ChatPtahCliService`,
`ChatStreamBroadcaster`, `ChatSubagentContextInjectorService`,
`ChatSlashCommandRouterService`, `ModelSettings`, `IAuthSecretsService`,
`WorkspaceProviderProfileResolver`, `OutputStyleSessionActivationService`. That
is 2.5× the guardrail, and it is a design question about what a chat session
composes — a behavioural task with its own batch, not a line-count refactor.
**Recommend filing it separately.**

**Optional S sweetener, if the file is touched anyway** — the MCP override
builders `getSmitheryOverrideResolver` (164–203), `getOAuthOverrideResolver`
(205–238) and `buildMcpServersOverride` (240–275) are ≈ 115 lines that
`new`-up six `cli-agent-runtime` classes and are the only consumer of
`IAuthSecretsService` here. `ChatMcpOverrideBuilder` in
`libs/backend/rpc-handlers/src/lib/chat/session/chat-mcp-override-builder.ts`
would be nameable and would shed one dep. It lands the file at ~975 — still over
700, which is why it is a sweetener and not the proposal. Note the documented
constraint at 211–212: the OAuth resolver is deliberately built WITHOUT the
interactive `connect()` deps (loopback server / browser opener); a builder that
"completes" it would add an interactive path to a session-start hot path.

---

## 13. `skill-drain.service.ts` — 1090 — **EXEMPT**

`D:/projects/ptah-extension/libs/backend/skill-synthesis/src/lib/queue/skill-drain.service.ts`

**Classification** — EXEMPT.

**Exemption reason** — **the count is documentation, not code.** The class starts
at **line 530**. Lines 1–529 are `SKILL_DRAIN_SECTION`, `SKILL_DRAIN_KEYS`,
`SKILL_DRAIN_DEFAULTS`, `SkillDrainConfig`, `MAX_STAGE_TIMEOUT_MS`,
`STALE_CLAIM_TTL_SAFETY_FACTOR`, `DRAIN_TIER_STAGES`, `DRAIN_TIER_LIMITS`,
`TOKEN_SPENDING_STAGES` and `STAGE_COST_RANK` — each carrying a 40–90 line
rationale header recording measurements and reversed decisions (the
828-session/31-day corpus, the 835-row archaeology backlog, why `trigger-eval` is
in `TOKEN_SPENDING_STAGES`, why `multiRound` is not simply `true`, why
`perWorkspaceBatch` must stay 1). **The class body is ≈ 550 lines — under the
700 ceiling on its own.**

Those constants are read by exactly one class, and the reasoning is what stops
the next reader re-introducing the two starvation defects the headers describe.
Moving them to a sibling file separates each decision from the code it governs
and buys a number, which is precisely the outcome guardrail 1 exists to prevent.
`libs/backend/skill-synthesis/CLAUDE.md` restates several of these headers, so
the co-location is load-bearing across two documents.

**If a cut is nevertheless wanted later** (lowest priority in this partition):
`SKILL_DRAIN_SECTION` / `SKILL_DRAIN_KEYS` / `SKILL_DRAIN_DEFAULTS` /
`SkillDrainConfig` + `readConfig` (1030–1082) form a nameable
`skill-drain-config.ts` at ≈ 200 lines, taking the file to ≈ 890. It is a
settings-reading concern and it passes the nameability test. It is still not
worth doing ahead of any of rows 1–11.

**Risk if attempted** — `assertStaleClaimTtl` (582–593) reads the CONFIGURED
lanes through the drain's own `IWorkspaceProvider`, and `MAX_STAGE_TIMEOUT_MS` is
DERIVED from `SKILL_LANE_DEFAULTS` so it cannot rot. A config split must not
re-hard-code either; the CLAUDE.md records that a hard-coded `30_000` here
silently reaped live runs across the whole 90 s–360 s band.

---

## Cross-cutting notes

1. **Duplicate transcript-locating logic** —
   `session-rpc.handlers.ts:1178-1215` and `agent-rpc.handlers.ts:1038-1067`
   each implement the `~/.claude/projects/` path-escaping workaround, and only
   the first has the `allowPartialMatch` caveat. Rows 8 + 9 should be sequenced
   together.
2. **Constructor arity is the better health metric than LOC in this partition.**
   Three files are already past the ~8 gate before any refactor:
   `chat-session.service.ts` (20), `skills-synthesis-rpc.handlers.ts` (18),
   `skill-synthesis.service.ts` (14), `auth-rpc.handlers.ts` (14),
   `skill-enhancer.service.ts` (11), `agent-rpc.handlers.ts` (11),
   `tasks-rpc.handlers.ts` (10). Rows 9 and 10 are the only proposals that bring
   a class back to or under 8.
3. **Four of the eleven proposals do not land the residual under 700**
   (rows 3, 6, 8, 11). That is stated per row rather than papered over. Where a
   file cannot reach the ceiling with 2–3 collaborators, the honest outcome is a
   better-organised file over the ceiling, not a sixth fragment.
4. **No proposal renames an RPC method, and none adds a namespace prefix**, so
   `ALLOWED_METHOD_PREFIXES` (`rpc-handler.ts:40`) and `RpcMethodName` are out of
   scope for the entire partition. Only row 3 step 2 edits
   `RPC_HANDLER_MANIFEST`, and its two invariants fail loudly in tests.
5. **Two CLAUDE.md files need edits if their rows are executed**:
   `libs/backend/skill-synthesis/CLAUDE.md` (line-number citations
   `skill-enhancer.service.ts:690` and `:733`, row 7; the `SkillCandidateStore`
   enforcing-gate bullet, row 4; the `Internal Structure` list, rows 4/5/7/11)
   and `libs/backend/task-specs/CLAUDE.md` (`Internal Structure`, row 2).
   `libs/backend/rpc-handlers/CLAUDE.md` needs its `Internal Structure` section
   extended for rows 1, 3, 6, 8, 9, 10.
