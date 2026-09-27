# Code Logic Review — `TASK_2026_408`

Verdict: REJECTED
Score: 6/10

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 6/10 |
| Assessment | REJECTED |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 4 |
| Failure modes found | 4 documentation failure modes |

Scope: Batch 10 ownership documentation and the two added header paragraphs only. All paths below are relative to `D:/projects/ptah-extension-task-408`. References were read on 2026-09-26; the translation proxy, stream translator and integration spec are being edited concurrently. This verdict concerns factual precision, not acceptance of their implementation.

The main routing, field-loss and capability claims are supported. Four unqualified claims need correction. This is a 6 rather than a 7 because the ownership boundary and a recovery guarantee are misleading; it is above a 5 because most specific claims and every cited implementation anchor were located and substantively supported. The intentional Batch 9 placeholder is excluded from findings.

## Five logic questions

### 1. How does this fail silently?

The documentation hides a supported configuration path: `ownership.md:8` names only `~/.codex/config.toml`, but `libs/backend/harness-sync/src/lib/targets/mcp/codex-home.ts:51` honors `CODEX_HOME`. A reader inspecting the documented path can wrongly conclude that an installation is missing (finding 4).

### 2. What user action produces unexpected behaviour?

A caller supplying `X-Ptah-Mcp-Servers` gets a structured override forwarded despite the new “only the flattened text prompt” claim at `apps/ptah-cli/src/services/proxy/anthropic-proxy.service.ts:44`; the forwarding is at `:500`. Path C can also enter the SDK session machinery described by path A, contrary to `ownership.md:3` (findings 1–2).

### 3. What input data produces a wrong answer?

An overflow code in an HTTP status other than 400/413 does not meet the unconditional mapping description at `ownership.md:21`: `libs/backend/auth-providers/src/lib/translation/responses-error-mapping.ts:193` rejects that status before inspecting the body. A translated overflow is also not proof of host compaction (finding 3).

### 4. What happens when a dependency fails?

The mapping produces a host-recognizable error, while recovery remains the host's decision. HTTP and streamed errors take different delivery paths (`translation-proxy-base.ts:1124`; `responses-stream-translator.ts:739`, both under `libs/backend/auth-providers/src/lib/translation`). The current integration spec permits an error-only HTTP outcome at `translation-proxy.sdk.integration.spec.ts:915`; its streamed variant remains explicitly unproven at `:946`. The doc must not promise compaction for both (finding 3).

### 5. What is missing that the requirements never mentioned?

The distinction between an entry surface and an independent agent loop, the structured MCP-header exception, and the `CODEX_HOME` override are missing from the simplified descriptions (`ownership.md:3`, `ownership.md:8`, `anthropic-proxy.service.ts:44`). These require wording changes, not path C or compaction-policy implementation.

## Failure modes

### 1. Moderate — “They share no loop and no limits” overstates isolation

- Document: `.ptah/specs/TASK_2026_408/ownership.md:3`.
- Trigger: use the CLI workspace proxy with a workspace provider backed by a translation proxy.
- Symptom/impact: maintainers may treat path C as an independent engine and overlook inherited host/proxy limitations.
- Evidence: `apps/ptah-cli/src/services/proxy/anthropic-proxy.service.ts:503` calls `chat:start` without a `ptahCliId`; `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:447` selects the native CLI branch only with that ID, otherwise resolves the workspace provider at `:543` and calls `sdkAdapter.startChatSession` at `:555`. The SDK execution path builds options at `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts:384` and invokes the query runner at `:440`.
- Current handling: the table correctly names ChatBridge for C, but the introductory sentence asserts absolute isolation.
- Recommendation: say these are distinct entry surfaces with different responsibilities; C delegates to a Ptah host session and can inherit A's translation limitations. B owns a separate Codex loop.

### 2. Moderate — Path C header excludes a structured caller input that is forwarded

- Document: `.ptah/specs/TASK_2026_408/ownership.md:9` and `:35` describe the boundary but omit this exception.
- Incorrect new comment: `apps/ptah-cli/src/services/proxy/anthropic-proxy.service.ts:44` says “only the flattened text prompt reaches chat:start”.
- Trigger: provide a valid `X-Ptah-Mcp-Servers` header.
- Symptom/impact: callers and maintainers are told structured caller configuration cannot reach the session, despite a supported MCP forwarding route.
- Evidence: the same file parses the header at `:423`, obtains its override at `:433`, and assigns `chatStartParams['mcpServersOverride']` at `:500–501`. The receiver consumes it at `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:536` and forwards it at `:571`.
- Current handling: caller `tools[]` really are not forwarded; the header override is independent of them. `options: {}` at `anthropic-proxy.service.ts:498` does not exclude a top-level override.
- Recommendation: narrow the comment to “Caller Messages content is flattened; caller tools and tool-result blocks are not forwarded, and slash commands are not parsed.” Mention the separate MCP header route in the doc. Keep fixes owned by TASK_2026_564_87a6.

### 3. Moderate — Overflow mapping is described as guaranteed compaction

- Document: `.ptah/specs/TASK_2026_408/ownership.md:21`, especially “the prompt-too-long error that the CLI compacts on”.
- Trigger: a matching code in an unsupported HTTP status, disabled/unavailable host recovery, or streamed overflow.
- Symptom/impact: a reader expects automatic recovery where the implementation only guarantees an error translation for qualifying inputs.
- Evidence: `libs/backend/auth-providers/src/lib/translation/responses-error-mapping.ts:189–210` limits HTTP mapping to parsed 400/413 bodies; `:217–235` separately handles Responses errors. `libs/backend/agent-sdk/src/lib/helpers/auto-compact-control.ts:81` can disable automatic compaction. The current `libs/backend/auth-providers/src/lib/translation/translation-proxy.sdk.integration.spec.ts:915–933` accepts propagation without compaction, and `:946` explicitly labels the streamed variant NOT PROVEN. `.ptah/specs/TASK_2026_408/integration-observations.md:105–117` records that residual.
- Current handling: the proxy produces the prompt-too-long contract; it does not own the host recovery decision.
- Recommendation: state that qualifying HTTP 400/413 bodies and Responses errors map to the host's prompt-too-long contract, which can enable reactive compaction subject to host policy. Keep observed outcomes in the intentionally pending Batch 9 section when finalized. This is a correction to the existing guarantee, not a finding against that placeholder. TASK_2026_561_9e57 retains policy ownership.

### 4. Moderate — Codex MCP path is a default, not an invariant

- Document: `.ptah/specs/TASK_2026_408/ownership.md:8`.
- Trigger: run with nonempty `CODEX_HOME`.
- Symptom/impact: the stated MCP location directs troubleshooting to the wrong file.
- Evidence: `libs/backend/harness-sync/src/lib/targets/rival-targets.ts:122` constructs the Codex MCP facet; `libs/backend/harness-sync/src/lib/targets/mcp/codex-toml-mcp-facet.ts:113` resolves its home path through `codexHomeConfigFile`; `libs/backend/harness-sync/src/lib/targets/mcp/codex-home.ts:51–58` chooses `$CODEX_HOME/config.toml`, falling back to `~/.codex/config.toml`.
- Current handling: code supports relocation; the doc repeats the default-only target summary.
- Recommendation: label `~/.codex/config.toml` as the default and document `$CODEX_HOME/config.toml` when set. Describe this as the harness-sync installed-server destination, not every MCP source of the native adapter (`codex-cli.adapter.ts:611–643` also supplies Ptah's server via SDK config).

## Blocking issues

None found in the reviewed documentation/comment changes.

## Serious issues

None found in the reviewed documentation/comment changes.

## Moderate and minor issues

Four moderate findings above. No separate naming, formatting or style findings.

## Data flow

1. A: SDK options → localhost tier selection → Messages request → protocol branch. OK: `sdk-query-options-builder.ts:1129`, `:1233`; `translation-proxy-base.ts:482`, `:498`, `:551`, `:598`.
2. A translated requests: explicit reconstructed fields → Responses tool-name guard → provider image capability → upstream. OK: `responses-request-translator.ts:140–163`; `translation-proxy-base.ts:554–569`. Recovery wording gap: finding 3.
3. B: Codex thread → `runStreamed` → full-turn continuation. OK: `codex-cli.adapter.ts:671–701`, `:787`. Harness-sync config path gap: finding 4.
4. C: caller body → tool notifications and flattened prompt → ChatBridge → `chat:start` → configured SDK adapter. Tool/result-loss description is supported by `anthropic-proxy.service.ts:392–434`, `:494–506`, `:700–718`. Ownership/override gaps: findings 1–2.

## Requirements fulfilment

| Requirement / document anchors | Status | Evidence or gap |
| --- | --- | --- |
| Distinguish A/B/C (`ownership.md:3–9`) | PARTIAL | Separate entries are accurate; isolation and config qualifiers need findings 1, 2, 4 |
| A routing and native response relay (`:13`) | COMPLETE | Base `:643–647`, Codex `:130–132`, base response pipe `:694–715`; request aliases can normalize model at base `:514–521`, so byte preservation should be understood as the cited response relay |
| Localhost user tier/log (`:15`) | COMPLETE | Builder `:1129–1133`, `:1233–1237`; shared `auth-env.utils.ts:14`, `:34–37` |
| Stateless history/store and stripped fields (`:16–17`) | COMPLETE | Responses translator `:140–163`, `:353–375`; Chat translator `:68–88`; cited comment anchors also match |
| Guard/image lane distinction (`:18–19`) | COMPLETE | Base `:551–601`, `:726–728`; Chat translator `:281–305`; Codex `:148–149`; repository search found no other production image-hook override |
| DONE residual (`:20`) | COMPLETE | Stream translator `:314`, `:752–778`; collector ignores sentinel at `:181` and rejects missing snapshot at `:246`; plan R4 `implementation-plan.md:581` records rationale |
| Overflow/no proxy preflight (`:21–22`) | PARTIAL | Reactive proxy design supported; finding 3 qualifies recovery |
| Native capabilities/models (`:26–27`) | COMPLETE | Adapter `:492–494`, `:507–514`, `:537–539`; provider entry has eight IDs at `codex-provider-entry.ts:28–91` |
| Harness-sync skills/commands/agents (`:8`, `:28–29`) | COMPLETE | Target `:87–124`, `:168–176`; Codex transformer `:65–68`. Home-only prompt rationale matches target `:22–24`; external issue not independently verified because network is prohibited |
| C caller tools/options/prompt/results/config/skills (`:35–39`) | COMPLETE | Service `:392–414`, `:494–499`, `:673–718`; `autoApprove` appears only at declaration `:94`; collector `:197–216` builds placeholders consumed only by notification/count flow |
| Two new headers accurate and comment-only | PARTIAL | B `codex-cli.adapter.ts:8–11` is accurate; C `anthropic-proxy.service.ts:43–46` needs finding 2. Both paragraphs are inside block comments and contain four added content lines. No baseline/diff was provided and git is prohibited, so whole-file change purity cannot be independently certified |

Implicit requirements not addressed: the qualifiers in findings 1–4. The deliberate `ownership.md:41–43` placeholder is accepted.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Text-only tool results | YES | Responses translator `:445–465`; image downgrade skips strings `responses-tool-output-images.ts:25–30` | Doc accurate |
| Non-Codex tool-result images | YES | Default false hook and placeholders, base `:567–569` | Doc accurate |
| Native adapter abort versus messaging interrupt | YES | `capabilities()` false at adapter `:493`; terminal abort controller at `:780` | B header describes messaging capability, not absence of cancellation |
| MCP caller header | NO (documentation) | Service forwards at `:500` | Finding 2 |
| Relocated Codex home | NO (documentation) | Resolver reads env at `codex-home.ts:51` | Finding 4 |
| Streamed overflow recovery | NO (guarantee) | Error mapping exists; integration outcome unresolved | Finding 3 |

## Verification limits

Read all three Batch 10 files in full, followed their references, and inspected the batch/context/plan and existing relevant verification notes. No root or covering AGENTS.md/CLAUDE.md was found in the worktree search; supplied project guidance was applied. No same-batch style review or task-description.md exists in the task folder. Native file reads were necessary because no Ptah file-content reader is exposed.

Scoped `ptah_get_diagnostics` was requested for the two TypeScript paths. It returned **Unavailable: None of the requested files are inside the workspace root**. No tests, build, network, git commands, or source edits were performed. Tests would not establish documentation truth or comment-only change purity. The requested Write tool is not exposed; the report alone was written using the native filesystem command. Commit attribution at `ownership.md:15` is supported only by `batches.md:359`, not independently checked in git.

## Verdict

- Recommendation: REJECT pending documentation corrections.
- Confidence: HIGH for static code facts; MEDIUM for recovery claims while Batch 9/reference code remains in flight.
- Top risk: readers treat C as independent of A and mistake translated overflow for guaranteed compaction.
- What a robust implementation would add: no production change in this batch; correct the four descriptions, retain task ownership, and obtain a baseline comparison for the comment-only gate through the authorized parent workflow.