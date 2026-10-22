# Batch 1c report

Implemented the requested diagnostics, granular policy, and both authorized extractions. Harness remains 915 physical lines, exceeding 700. Source edits stopped after completing the extractions and correcting their duplicate constant declaration, as instructed; no further compaction or extraction attempted.

## Changes

- Command-only diagnostic shapes are emitted at rejected approval requests and unexpected command notifications. Specific experiment paths are replaced before their root; Node executable, slash/case/quoting variants and exact marker script variants are replaced. Whitespace is collapsed, shape capped at 400 characters, and existing sanitize applied. Notes include bounded camelCase top-level param key names and conservative shell-wrapper/quoting/other classification. File mismatches never serialize file-change contents. Exact identity gates remain fail closed.
- All-true granular approval policy is used for ask and undefined/read-only. Other levels retain on-request. CLI overrides use TOML inline tables; config equality uses isDeepStrictEqual; thread/start and turn/start receive the same selected policy. assertSafeSandbox remains active.
- Granular cases now track whether any requestApproval request arrived independently of whether it passed the safety gate. Case finalization emits exactly `granular ask: no approval request observed` when none arrived, including failure/timeout cleanup. The existing required-gate status and stop-after-unverified behavior remain unchanged.
- failureMessages, errorNames, recordCaseFailure and command-shape diagnostics live in evidence-failure-notes.ts.
- JSON-RPC envelope schemas, Frame/RequestFrame types, MAX_FRAME_BYTES and FrameDecoder now live in evidence-frames.ts with named exports. Harness consumes them directly; specs import FrameDecoder and MAX_FRAME_BYTES from the new module. No compatibility re-exports were added.
- Removed the earlier dense statement/block layout used to reach the limit. Embedded marker/MCP script text was preserved during layout restoration. Whitespace restoration is not a byte-exact reconstruction of the earlier file. The result exceeds the limit, so further size work is intentionally left to the orchestrator.
- Ask case purposes and the previously added granular-policy/diagnostic specs remain in place. Existing frame regression tests now exercise the extracted module via their updated imports.

## Source references

- `libs/backend/codex-runtime/tools/evidence-harness.ts:11`: `from './evidence-frames'`.
- `libs/backend/codex-runtime/tools/evidence-harness.ts:506`: `export function policy`.
- `libs/backend/codex-runtime/tools/evidence-harness.ts:514`: `export function approvalPolicyOverride`.
- `libs/backend/codex-runtime/tools/evidence-harness.ts:519`: `export function approvalPoliciesEqual`.
- `libs/backend/codex-runtime/tools/evidence-harness.ts:643`: `let approvalRequestObserved`.
- `libs/backend/codex-runtime/tools/evidence-harness.ts:671`: `approvalRequestObserved ||=`.
- `libs/backend/codex-runtime/tools/evidence-harness.ts:785`: `granular ask: no approval request observed`.
- `libs/backend/codex-runtime/tools/evidence-harness.ts:748`: `!approvalPoliciesEqual(effective['approval_policy']`.
- `libs/backend/codex-runtime/tools/evidence-frames.ts:3`: `export const MAX_FRAME_BYTES`.
- `libs/backend/codex-runtime/tools/evidence-frames.ts:5`: `export const idSchema`.
- `libs/backend/codex-runtime/tools/evidence-frames.ts:12`: `export const envelope`.
- `libs/backend/codex-runtime/tools/evidence-frames.ts:13`: `export type Frame`.
- `libs/backend/codex-runtime/tools/evidence-frames.ts:17`: `export class FrameDecoder`.
- `libs/backend/codex-runtime/tools/evidence-failure-notes.ts:3`: `export const failureMessages`.
- `libs/backend/codex-runtime/tools/evidence-failure-notes.ts:58`: `export function recordCaseFailure`.
- `libs/backend/codex-runtime/tools/evidence-failure-notes.ts:76`: `export function recordCommandShape`.
- `libs/backend/codex-runtime/tools/evidence-harness.spec.ts:10`: `from './evidence-frames'`.
- `libs/backend/codex-runtime/tools/evidence-harness.spec.ts:13`: `describe('bounded command shape`.
- `libs/backend/codex-runtime/tools/evidence-harness.spec.ts:408`: `describe('granular ask approval`.
- `libs/backend/codex-runtime/tools/evidence-cases.json:24`: `Read-only plus granular approvals`.

## Decisions

- Orchestrator explicitly approved proceeding with all five granular flags true. "True means ask" is an ASSUMPTION to prove in spike run 6, not a schema fact. The pinned schema `libs/backend/codex-runtime/src/lib/protocol/codex-app-server-protocol.schema.json:7817` defines the variant (title at 7865), five booleans, and false defaults for request_permissions and skill_approval, but NO field descriptions or boolean semantics. Production adoption remains gated on ask-before-effect evidence.
- Track incoming approval requests rather than successful approval responses, so rejected requests are not mislabeled as absent. Diagnostic bookkeeping does not weaken approval or isolation checks.
- Followed the orchestrator's authorized additional frame-module extraction and stop-above-700 rule instead of pursuing another split or formatting compaction.

## Verification and open doubts

- Final scoped ptah_get_diagnostics over harness, spec and both extracted modules: zero errors, zero warnings; source typescript-compiler, clean coverage. The first check caught the leftover MAX_FRAME_BYTES declaration; removing it completed the extraction and the second check passed.
- No direct nx, jest, tsc, lint, build, npm, Codex binary or git commands were run. Specs were NOT executed; the orchestrator retains the shared execution slot. No model turns were consumed.
- Harness is 915 lines and still fails the requested 700-line limit; stopped and reported this count as directed.
- Spike run 6 must establish actual approval-before-effect behavior and whether all-true granular flags ask. No approval request must remain unverified/failed, now with the explicit diagnostic note. The new finalization note has not been exercised by an integration run.
- Wrapper classification supports common powershell/pwsh -Command/-c, cmd /c and bash/sh -lc/-c forms; unrecognized wrappers or additional changes remain other and are still rejected.
