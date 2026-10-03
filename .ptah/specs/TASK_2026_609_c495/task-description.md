# Requirements - TASK_2026_609_c495 (Part B: surgical improvements to Thoth Library > Agents)

Scope: Part B only, as narrowed by the user (`context.md` "User Decisions — Part B scope change", authoritative). Part A (F1 seed fix + quarantine, F2 `agentGeneration.models` key, F4, F5) is a dependency, not scope.

## Context

Thoth > Library > Agents is the `agent` kind tab of `SkillClonesViewComponent` (`libs/frontend/skill-synthesis-ui/src/lib/components/clones/skill-clones-view.component.ts:84-88`), Electron-only (`:123-132`). It lists `CloneSummary` rows from `skillSynthesis:listClones` (`libs/shared/src/lib/types/rpc.types.ts:1956`; type at `rpc/rpc-skill-clone.types.ts:12-49`), which carries slug, clone status, divergence and usage, but no model, no per-provider copy state and no quarantine state. Provider copy state exists only as per-target path lists in `HarnessTargetHealth` (`missing`, `foreign`, `overwrittenLocalEdit`, `writeFailed`; `harness-sync.types.ts:118-174`) from `harness:health` / `harness:reconcile` (`rpc.types.ts:1755-1762`; reconcile params `targets?` at `harness-sync.types.ts:408-413`). Part A's seed quarantine (commit 5f52dfbc8) moves leaked clones into the scoped root's `.history/<slug>/<ts>/` and records their slugs in `.ptah-seed-quarantine.json` (`user-layer-seed-quarantine.ts:29-48,305-312`); nothing surfaces it in the UI.

The wizard writes agents when the user presses "Generate N agents" on the selection step (`setup-wizard/src/lib/components/agent-selection.component.ts:474-483,883-946`), which calls `wizard:submit-selection` immediately (`wizard-rpc.service.ts:98-104`). The user sees no list of files before they are written, and copies then fan out to provider directories via the harness reconciler.

The user asked for four surgical gains on these two existing surfaces, no new surface.

## Classification

- Type: FEATURE — adds controls and indicators to existing screens; Part A carries the bug fixes.
- Estimate: L — four items across shared contracts, harness-sync model emission for four non-Claude providers (F3), and two frontend surfaces; no new routes.
- Priority: not defined here.

## Scope

In scope: items 1-4 below, on the existing Agents tab and the wizard's generate action.

Out of scope (from `context.md`): Settings silo or any new route/surface; changes to codebase analysis; removing saved analyses; trajectory-based enhancement (existing "Enhance now" covers it); content-manifest update detection (deferred follow-up); Skills and Commands tabs (unchanged).

## Preserve list (must keep working)

- Agents tab: Electron-only notice in VS Code; Refresh; status legend; Skills/Agents/Commands tabs; "Show diverged only" filter and bulk rebase; per-card open, Enhance (`skillSynthesis:enhanceNow` / preview / apply), Rebase and Keep with confirmation; detail drawer with body edit (`saveCloneBody`), history diff and revert; scorecard; empty copy (`skill-clones-view.component.ts:98-105,134-276`).
- Wizard: agent selection and "Generate N agents"; `wizard:submit-selection` with the analysis dir; progress items and transition to `generation`, then enhance and completion steps (`agent-selection.component.ts:883-946`).
- Existing specs in `components/clones/*.spec.ts` and the setup-wizard specs pass unchanged unless a test is changed on purpose for items 1-4 and the reason is recorded.

## Requirements

### 1. Model control per agent card (F2 UI + F3)

User sees, on each agent card, the effective model per provider (Claude, Codex, OpenCode, Copilot, Cursor) with its source, and can set it as the machine default or as a workspace override. Backing today: none (no model field on `CloneSummary`; `provider:listModels` at `rpc.types.ts:1081` may serve model lists). New: read/write of Part A's `agentGeneration.models` key from the card, and model emission into non-Claude copies.

Precedence per provider for agent A in workspace W: W's override for A, W's workspace default, machine default, then the fallback below. A save in workspace X changes only X unless the user edits the machine default on purpose.

| Provider | Override cleared, a default set | Nothing set | Override set |
| --- | --- | --- | --- |
| Claude | that default | template `model:` (today's behaviour) | the override |
| Codex, OpenCode, Copilot, Cursor | that default | no model field (today's behaviour) | the override |

A non-Claude provider never inherits any Claude value (template, override or default).

Validation for non-Claude values, checked in this order; a value takes the first class it matches:

| Class | Definition | Accepted | Written |
| --- | --- | --- | --- |
| Empty | cleared | yes | no field, or next value up the chain |
| Malformed | not in the provider's reported model list and fails the syntax rule: OpenCode not `provider/model` (one `/`, both sides non-empty); others empty after trim or containing whitespace/line breaks | no, rejected inline | no |
| Known-invalid | the system holds a provider-reported error for this exact value (empty class if no provider exposes one; the design says which) | no, rejected inline | no |
| Listed-valid | in the provider-reported model list, no provider error for it — even when that provider's syntax rule is unverified | yes, no label or confirmation | yes |
| Unlisted | passes syntax, provider reports a list, value not in it | after explicit confirmation; labelled "unlisted" | yes |
| Unverifiable | passes syntax, no list available | yes; labelled "unverified" | yes |

The syntax rule applies only to values not in a provider list; it is reject-only and never makes a value Listed-valid. Exception: OpenCode's documented `provider/model` format is required by its loader, so an OpenCode value must pass it even when listed. Only list entries not marked fallback count as provider-reported. Every accepted value is written on the next sync; a value that could not be written is refused at save, never accepted and dropped later. The architect cites each provider's documented model-id syntax and may correct the provisional rule from that source; where no source exists, the rule stays no looser than above.

Acceptance criteria:

1. When the Agents tab loads, each agent card shall show, per provider, the effective value and its source (override, workspace default, machine default, template, or "none").
2. When the user saves a Claude value, the system shall accept only values Part A's key accepts, and the next written `.claude/agents/<slug>.md` shall carry that `model:`.
3. For each row of the precedence table, when the stated fields are set or cleared, the next synced copy shall carry exactly that result; tests cover each row for Claude and at least one non-Claude provider.
4. When a non-Claude field resolves to no value, its copy shall contain no model field even when the Claude field has a value.
5. For each validation class, saving a value of that class shall give the stated outcome; a rejected value leaves the previous value in effect and shows the reason inline.
6. When the user saves an override or workspace default in workspace X, effective values in workspace Y shall be unchanged (two scratch workspaces).
7. When the user edits the machine default, the card shall state before saving that it applies to every workspace without its own value.
8. When a value is saved, affected provider copies shall update on the next reconcile without a wizard re-run, and an OpenCode copy shall never be written with a Malformed or Known-invalid value.
9. When the save fails, the card shall show the error and keep the previous value.

### 2. Provider sync chips and Sync action

User sees, per agent card, one chip per provider: in sync, missing, or edited; and a Sync action. Backing today: `harness:health` (read-only verify) and `harness:reconcile` with optional `targets` filter; per-target path lists in `HarnessTargetHealth`. New: mapping those paths to agent slugs per card.

Acceptance criteria:

1. When the tab loads, each card shall show a chip for claude, codex, opencode, copilot and cursor derived from the latest health report for the active workspace, without running a reconcile.
2. When a provider is not detected or does not carry agents (`detected` / `facets`), its chip shall say so and shall not read "in sync" or "missing".
3. When the copy for that agent is absent or stale, the chip shall read "missing"; when it was hand-edited, "edited".
4. When the user presses Sync, the system shall call the existing `harness:reconcile` for the active workspace, refresh the chips, and turn "missing" chips "in sync" unless a write fails.
5. When a write fails, the chip shall show the path and reason from `writeFailed` and stay not in sync.
6. When Sync would overwrite an "edited" copy, the system shall state that before running, and the edited copy shall be saved to `.ptah/harness/.history/` as today (`harness-sync.types.ts:150-159`).

### 3. Foreign and quarantined agents indicator with Restore

User sees which agents in this workspace are not owned by it and which were quarantined by Part A, and can restore a quarantined one. Backing today: Part A marker `.ptah-seed-quarantine.json` (quarantined, keptWithLocalWork, keptUnprovable slugs) and `.history/<slug>/<ts>/` snapshots; `HarnessTargetHealth.foreign`. New: an RPC to list and restore quarantined agents, and the indicator in the tab.

Acceptance criteria:

1. When the workspace has quarantined agents, the Agents tab shall show a count and list with slug and quarantine date; when none, nothing or "No quarantined agents", never an error.
2. When an agent is kept but not owned by the workspace source (keptWithLocalWork / keptUnprovable), its card shall carry a "not owned by this workspace" label.
3. When the user restores a quarantined agent, the system shall state the destination before Restore (default: this workspace's source `.claude/agents/<slug>.md`, owned by the workspace; user confirms at the combined gate), copy the snapshot there, propagate it, list it on the tab after refresh, and keep the `.history` snapshot. Until propagation succeeds (including when agent sync is off in the workspace, which Restore never turns on) the item stays listed as "restored, not yet synced" with the reason, and retry is never blocked by a partial copy.
4. When a same-slug agent already exists in the workspace, Restore shall be refused naming the conflict, with both files unchanged.
5. When the user restores in workspace X, workspace Y's agents shall be unchanged.
6. No action on this tab shall delete a quarantined or foreign file.

### 4. Generation preview in the wizard

User sees, after pressing Generate and before anything is written, each selected agent and the provider files it will write, then confirms or goes back. Backing today: none; `onGenerateAgents` writes at once. New: a preview of target paths per agent and a confirm step.

Acceptance criteria:

1. When the user presses Generate, the wizard shall list each selected agent with the workspace-relative path of every file it will write (`.claude/agents/<slug>.md` and each detected provider copy), and shall call `wizard:submit-selection` only after the user confirms.
2. When an agent's target file already exists, the preview shall mark it "will overwrite".
3. When the user cancels the preview, no file shall be written and the selection shall be kept.
4. When the preview cannot be computed, the wizard shall show the reason and still offer Generate with that warning, not block generation.
5. After confirm, the agent files written shall equal the preview's definite paths (test through the real generation path with a fixture workspace); paths whose writing depends on a condition the preview cannot settle shall be shown separately with that condition, never as promised writes.

## Non-functional requirements

- Repository constraints: standalone OnPush components with signals; `libs/frontend/ui` Native* primitives; every new RPC typed in `libs/shared` and called only through the registry.
- UI evidence: before/after screenshots of the Agents tab (items 1-3) and the wizard preview (item 4), dark and light themes; "before" taken from base commit 21c27d17f; stored in the task folder and linked from the QA report.

## Dependencies

- Part A F1 quarantine data (landed in 5f52dfbc8) — item 3 reads its marker and `.history` layout.
- Part A F2 `agentGeneration.models` key shape (machine default + workspace overrides) — item 1 is blocked until PR #634 merges and F2 lands.
- Architect to verify: whether a read-only `harness:health` can report a hand-edited copy before reconcile (item 2 AC 3), whether the reconciler's content hash covers transformed model fields (item 1 AC 8), and which providers expose a model list or model-resolve error.

## Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Bad OpenCode model id hides the agent from OpenCode | MEDIUM | HIGH | Architect cites OpenCode id syntax; tester adds a transformer test per validation class |
| Item 1 slips behind PR #634 | HIGH | MEDIUM | Team-leader sequences items 2-4 first; item 1 batches start after F2 lands |
| Chips mis-attribute paths to slugs | MEDIUM | MEDIUM | Tester fixture with one agent missing on codex and edited on opencode asserts exact chips |

## Handoff

- Next specialist: software-architect.
- Why: no new surface, so no designer gate; the open questions are contract shapes (per-agent sync mapping, quarantine RPC, preview paths, model emission).

## Revision log

- 2026-10-03: plan-review fixes: item 1 listed/fallback/OpenCode rule and no silent drop; item 3 AC3 restore destination and pending state; item 4 AC5 definite vs conditional paths.
- 2026-10-03: scope narrowed by user from a Settings silo to four surgical items on Thoth Library > Agents and the wizard; previous silo version superseded.
