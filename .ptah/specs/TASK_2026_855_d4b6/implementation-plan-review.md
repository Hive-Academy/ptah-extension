# Architecture review — TASK_2026_855_d4b6, correction round 1

## Verdict: APPROVED

The revised contracts address all four prior findings. This approves the plan, not an implementation. No source, settings, state, or tests changed in this review.

## Verified remaining defects

None in the changed contracts. Source lookup, physical-path validation, and forwarding still need the planned implementation tests.

## Resolved findings

1. **Nested lineage:** `implementation-plan.md:43-45,97-104,107` carries nearest-first ancestor roots in runtime config and durable `SessionMetadata`, distinguishing absent, empty, and malformed legacy fields. The host passes `sourceSessionId` (`child-chat-session-host.adapter.ts:99-107`); live lookup accepts tab or SDK ID (`session-lifecycle-manager.ts:650-656`), and durable metadata is retrievable by SDK ID (`session-metadata-store.ts:929-955`). Repeated create preserves existing fields (`session-metadata-store.ts:1525-1540`); summary/detail serialization spreads the record (`session-metadata-store.ts:360-399`). The proposed capture and round-trip are implementable, subject to the specified pre-bind lookup and propagation tests.
2. **Governing-root validation:** `implementation-plan.md:101-105,138-140,148` requires authorization, safety, availability, and physical-identity checks for local policy and every ancestor before reads on launch and restore. This is new work: launch safety checks only cwd (`chat-session.service.ts:905-932`), and folder resolution checks only execution candidates (`session-folder.ts:49-91`). Authorization is lexical (`workspace-authorization.ts:36-55`), and the safety guard does not resolve symlinks (`workspace-path-guards.ts:22-58`); the plan correctly requires checks on supplied and resolved paths. `canonicalRootKey` falls back to a lexical key on realpath failure (`plugin-config-home.ts:163-172`), so it may identify layers only after separate fail-closed validation. The proposal keeps execution, MCP inventory, approval identity, and plugin file lookup on the worktree (`implementation-plan.md:76-85,138-140`).
3. **Agent re-enable:** `implementation-plan.md:52,61-69` excludes inherited `disabledAgentIds` while merging explicit plugin/skill choices. Storage has agent disable but no agent enable (`plugin-config-home.ts:50-57`), so this preserves child plugin/skill ON without inventing an agent override API.
4. **Saved cwd:** `implementation-plan.md:55,121-130` makes a distinct saved cwd authoritative and refuses an unavailable one. The existing candidate loop falls through from `workingDirectory` to `workspaceId` (`session-folder.ts:49-71`); the correction retains workspace fallback only for legacy records without a distinct cwd.

## Lane-introduced constraints versus user/project rules

- User/coordinator decisions: transitive plugin/skill inheritance, validation of every governing root, local-only agent disables, worktree execution/MCP trust, and no source work before approval (`decisions.md:17-20`; `context.md:9-13,22-28`).
- Project/task rules: Electron first, dependent-host verification for later shared edits, no TUI/VS Code feature work, and scoped `npm run verify` only (`implementation-plan.md:15,160-165`; `context.md:30-32`).
- Architect choices: durable nearest-first roots in existing metadata, live values on the next reconstructed query, no immediate persistent-query restart, and lazy legacy upgrade (`implementation-plan.md:16,43-45,53,104`). The former no-persisted-field restriction is withdrawn (`implementation-plan.md:17`).

## Unresolved user-reserved decisions

None for this bounded architecture. No checks were run because this review changed only the document.
