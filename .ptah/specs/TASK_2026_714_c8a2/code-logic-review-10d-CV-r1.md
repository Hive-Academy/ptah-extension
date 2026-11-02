# Code logic review: 10d.C and 10d.V, revision 1

Review family: codex (same family as implementer, user-approved; weaker evidence)
Implementer family: codex

## Scope and evidence

Read the earlier review, three fix tasks and reports, common rules, D26/D27, R1-R4, root instructions, the shared inspector and spec, both host composition files and specs, the CLI guard and surface specs, the CLI smoke spec, public export, and relevant tracked diff. `git status --short` identified the host composition files as untracked, so the tracked diff alone omitted them. No tests, build, typecheck, lint, verification, or diagnostics were run, as expressly prohibited. The Ptah symbol index returned zero hits; native `Select-String` was the fallback after `rg` failed with access denied. No skill loader was listed.

The data flow remains factory registration (`libs/backend/cli-engine/src/lib/container.ts:769-770`; `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts:263-266`) -> adapter probe -> shared inspection -> per-open inspection -> measured digest in runtime ports -> gated or development runtime resolution -> owned-context disposal. The adapter still discovers user MCP servers from the lane home; neither host strips MCP (`libs/backend/cli-engine/src/lib/codex-lane-runtime-composition.ts:145-156,273-275`; `apps/ptah-extension-vscode/src/di/codex-lane-runtime-composition.ts:138-146,242-245`).

## Prior defects

| Defect | Status | File:line evidence and assessment |
| --- | --- | --- |
| C-1, open used pin digest without measuring | **fixed** | CLI `codex-lane-runtime-composition.ts:202-231` inspects at open and passes `inspection.sha256` and `inspection.versionOutput`; spec `:391-413,422-448` distinguishes inspector digest from pin. |
| C-2, probe accepted an explicit path that open refused | **fixed** | CLI `codex-lane-runtime-composition.ts:160-166` compares realpaths before inspection; spec `:252-265` checks refusal and no inspector call. |
| C-3, adapter logs only error class | **deferred** | CLI `codex-lane-runtime-composition.ts:166` propagates the coded error; spec `:228-246` preserves it, while shared adapter logging remains class-only at `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-app-server-lane.adapter.ts:143-146`. Adapter-owner follow-up. |
| C-4, thin home/TUI/disposal specs | **fixed as scoped; TUI coverage deferred** | CLI spec `:270-305` exercises credentials, catalog and user-MCP home; `:208-225` no longer claims TUI invocation; `:419-453` asserts usage client is not closed. `apps/ptah-cli/src/di/container.smoke.spec.ts:510-516` still checks TUI source text, as the fix task allowed. |
| C-5, repeated full hash | **fixed for stable file identity** | CLI probe/open use the inspector at `codex-lane-runtime-composition.ts:166,205`; helper shares pending/completed work at `codex-executable-inspection.ts:69-77,103-109`. See new cache findings. |
| C-6, duplicated composition | **deferred outside executable inspection** | CLI uses the shared inspector at `:166,205`; host profile/context helpers remain at `:47-89,114-157`, as directed. |
| V-1, repeated full hash | **fixed for stable file identity** | VS Code `codex-lane-runtime-composition.ts:68-78,151,182` delegates both calls to the cached inspector. See weak regression assertion below. |
| V-2, dispose error hid open error | **fixed** | VS Code `codex-lane-runtime-composition.ts:231-239` logs the real dispose `Error` and rethrows the original; spec `:303-319` compares the original object and log argument. |
| V-3, gate-admitted spec could pass on raw resolution | **fixed** | VS Code spec `codex-lane-runtime-composition.spec.ts:326-342` injects a gate stub and asserts `isEnabled('lane', platform)`; raw resolution alone would miss that assertion. |
| V-4, missing digest-mismatch and missing-pin cases | **fixed at host boundary** | VS Code spec `:127-160` injects each coded failure and checks `installed: false` / open refusal; shared inspector spec `codex-executable-inspection.spec.ts:101-139` covers real fixture hashing, retry, and missing pin. |
| V-5, development host without a pin | **deferred by D27** | VS Code `codex-lane-runtime-composition.ts:97,68-78` selects native in development and then reports pin absence. D27 deliberately makes native the unpackaged default. |
| V-6, duplicated local hash | **fixed for binary inspection; broader duplication deferred** | VS Code `codex-lane-runtime-composition.ts:68-78` calls the shared inspector; remaining host helpers at `:25-65,105-148` were outside extraction scope. |

## New defects and residual gaps

1. **Moderate, shared helper: `readVersion` is ignored or reused across call modes.** `libs/backend/codex-runtime/src/lib/codex-executable-inspection.ts:69-77,91-103` keys the entire result without the presence or identity of `options.readVersion`. After a default inspection, a call with `readVersion` returns the cached pinned version without invoking the callback; the reverse order returns the callback's string to a default caller. This violates the exported option contract and can silently skip a version probe. Both current host call sites omit `readVersion` (CLI `:166,205`; VS Code `:73`), so their runtime identity is unaffected. Cache the hash separately from version output, or distinguish version modes while sharing the hash. The spec only repeats calls using the same callback (`codex-executable-inspection.spec.ts:51-58`).
2. **Minor, shared helper: cache retention is unbounded across distinct realpaths.** The map at `codex-executable-inspection.ts:34,76,103` replaces an entry only for the same realpath. Repeated distinct paths retain one resolved promise each for the process lifetime. This contradicts the fix task's claim that the map does not grow without bound; native paths are normally stable, so practical impact is low. Bound retention or give the cache lifecycle ownership.
3. **Minor, VS Code regression spec: pin substitution would still pass.** The fixture gives the inspector and pin the same digest (`apps/ptah-extension-vscode/src/di/codex-lane-runtime-composition.spec.ts:71-80`); the port assertion checks that digest (`:213-223`). If `open()` passed `inspected.pin.binarySha256` instead of `inspected.sha256`, the case would remain green. Source is correct at `codex-lane-runtime-composition.ts:185-188`. Make the mocked inspector digest deliberately different from the mocked pin, as the CLI spec does (`cli-engine/.../codex-lane-runtime-composition.spec.ts:422-432`).
4. **Minor, audit annotations: two intentional rejection handlers lack the required suppression comment.** The helper's `void promise.catch` cleanup (`codex-executable-inspection.ts:104-108`) handles rejection on the *derived* promise and leaves the original returned promise rejected. It therefore does **not** hide an unhandled rejection or turn failure into success; it still needs the common-rule degradation-audit comment. The CLI's pre-existing failed-open cleanup catch logs and rethrows the original at `cli-engine/.../codex-lane-runtime-composition.ts:262-269`, but has no suppression comment at `:265`; VS Code has one at `apps/ptah-extension-vscode/src/di/codex-lane-runtime-composition.ts:235`. These are audit-contract gaps, not lost open errors.

The inspector does not recode a stream failure after successful `stat` (`codex-executable-inspection.ts:53-66,79-83`): deletion or access loss during `createReadStream` rejects with a raw filesystem error. The lane fails closed before registration. This is a diagnostic limit, not evidence of a wrong binary being started.

## Five logic questions

1. **How does this fail silently?** A later caller requesting `readVersion` can get an earlier default result without the callback running (`codex-executable-inspection.ts:76-77,91-93`). Current CLI/VS Code digest mismatch throws before scope creation (`cli-engine/.../codex-lane-runtime-composition.ts:205-210`; `apps/ptah-extension-vscode/src/di/codex-lane-runtime-composition.ts:182-213`).
2. **What user action produces unexpected behaviour?** Supplying a non-native explicit executable is refused in the CLI probe before inspection (`cli-engine/.../codex-lane-runtime-composition.ts:160-164`), matching open. A development VS Code host on a platform without a pin reports native Codex unavailable (`apps/ptah-extension-vscode/src/di/codex-lane-runtime-composition.ts:68-78,97`), the deferred D27 consequence.
3. **What input data produces a wrong answer?** Mixing calls with and without `readVersion` for the same realpath, size, mtime and pin can return the wrong `versionOutput` string (`codex-executable-inspection.ts:69-77,91-101`). Digest mismatch yields a coded error (`:84-90`).
4. **What happens when a dependency fails?** Missing file/pin and wrong digest reject with coded errors (`codex-executable-inspection.ts:42-66,84-90`); failed hash/version promises are evicted only if still current (`:104-108`). VS Code disposal failure is logged while preserving the open error (`apps/ptah-extension-vscode/src/di/codex-lane-runtime-composition.ts:231-239`). A stream failure after `stat` remains a raw error (`codex-executable-inspection.ts:79-83`).
5. **What is missing beyond explicit requirements?** The shared cache needs a version-mode policy and bounded retention across realpaths (`codex-executable-inspection.ts:34,69-77`). The VS Code port spec needs distinct measured and pinned digests (`codex-lane-runtime-composition.spec.ts:71-80,220-223`). A true TUI startup check remains outside this fix scope (`apps/ptah-cli/src/di/container.smoke.spec.ts:510-516`).

## Scores and verdicts

| Batch | Score | Verdict | Rationale |
| --- | --- | --- | --- |
| 10d.C | **8/10** | **APPROVED** | C-1/C-2/C-5 are corrected at runtime; C-3 and broader duplication are scoped follow-ups. The shared helper's version-option flaw does not affect CLI's current calls. Above 7 because measured identity now reaches open; below 9 because cache and audit contracts need follow-up. |
| 10d.V | **8/10** | **APPROVED** | V-1 through V-4 are corrected at runtime, and V-5 follows D27. The helper flaw does not affect VS Code's current calls. The digest port assertion is weak, so evidence is below a 9; correct runtime and failure handling support above 7. |

Confidence: **medium**, reduced by same-family review and prohibited execution checks. The coordinator should verify the shared helper and both host projects before accepting a gate-opening release.

## Decisions

- **Approve C and V while routing the `readVersion` cache contract to the shared-helper owner.** Options: revise both hosts now, or approve their correct no-option paths and repair the exported helper separately. Host call sites at CLI `:166,205` and VS Code `:73` omit the option; collision is at helper `:69-77`. Reversible; this does not authorize opening the lane gate.
- **Treat C-3 as an adapter follow-up.** Options: change the shared adapter in this scope, or report it to its owner. The fix task excludes that adapter; the code preserves the error until the adapter (`cli-engine/.../codex-lane-runtime-composition.ts:166`). Reversible.
- **Treat V-5 as the D27 tradeoff.** Options: narrow the development default by platform, or retain D27. Current selection at VS Code `:97` matches D27; changing it needs a product decision. Reversible.
- **Count TUI smoke as residual coverage, not an unfulfilled fix instruction.** The fix task permitted renaming the duplicate TUI claim; CLI spec `:208-225` did so, while app smoke `apps/ptah-cli/src/di/container.smoke.spec.ts:510-516` remains source-based. Reversible.
