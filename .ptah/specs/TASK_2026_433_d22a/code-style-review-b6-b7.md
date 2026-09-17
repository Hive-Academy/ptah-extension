# Code Style Review — `TASK_2026_433` (Batches B6 + B7)

## Summary

| Metric          | Value                                |
| --------------- | ------------------------------------ |
| Overall score   | 7/10                                 |
| Assessment      | APPROVED                             |
| Blocking issues | 0                                    |
| Serious issues  | 1                                    |
| Minor issues    | 2                                    |
| Files reviewed  | 4 (`cli-agent-runtime/CLAUDE.md`, `vscode-lm-tools/CLAUDE.md`, `agent-lanes/SKILL.md`, `content-manifest.json`) |

Scope verified read-only, from the worktree `D:\projects\ptah-extension\.claude-worktrees\task-433-role-lanes`. No source edited, nothing committed or stashed. `ptah_get_diagnostics` and other `ptah_*` MCP tools were unavailable this session (`ConnectionRefused` on `localhost:51820`) — verification below is by direct code read (Grep/Read) against the real source, not the MCP tool layer.

## Five style questions

### 1. What breaks in six months?

The `cli-agent-runtime/CLAUDE.md` "Internal Structure" section (`libs/backend/cli-agent-runtime/CLAUDE.md:63-66`) still reads:

```
- `src/lib/di/tokens.ts` — `CLI_AGENT_RUNTIME_TOKENS` (empty placeholder in Batch 1)
- `src/lib/di/register.ts` — `registerCliAgentRuntimeServices` (no-op in Batch 1)
```

That was true when the lib was a scaffold. It is false today: `di/register.ts` registers `AgentSpawnEnvironment`, `AgentOutputBuffer` and `TOKENS.AGENT_PROCESS_MANAGER` as singletons (`libs/backend/cli-agent-runtime/src/lib/di/register.ts:40-47`), and this same diff's own "Facade split of `AgentProcessManager`" section (`CLAUDE.md:222-236`) describes that wiring in detail one page later. A reader who trusts "Internal Structure" over "Facade split" — a plausible reading order top-to-bottom — will believe DI here is still inert. Six months out, the next author touching `di/register.ts` has no reason to update a section this diff left untouched while fixing the sibling "Public API" section right above it (`CLAUDE.md:39-64`, corrected from "Batch 1 scaffold" to the full five-barrel listing in this same commit).

### 2. What would a new team member misread?

The word "drives" in `vscode-lm-tools/CLAUDE.md:93` — "`AgentSpawnArgsSchema.shape` also drives the JSON tool schema (`tool-description.builder.ts`)" — reads as a claim that the JSON schema is generated from the Zod shape. It is not: `buildAgentSpawnTool()` (`tool-description.builder.ts:494-595`) is a hand-written object literal; the two are kept in sync only because `agent-spawn-surface-parity.spec.ts:6-13` asserts `Object.keys(buildAgentSpawnTool().inputSchema.properties)` equals `Object.keys(AgentSpawnArgsSchema.shape)`. A new reader who goes looking for a `zodToJsonSchema(AgentSpawnArgsSchema)` call to add a field will not find one and may hand-edit the object literal without keeping the shape sorted, still passing until the spec catches the drift at test time — annoying but not what "drives" suggests.

### 3. What does this cost to maintain?

Very little beyond the two items above. Every remaining factual claim was spot-checked directly against source and matched exactly (see Pattern compliance table). The two lib docs read as maintained artifacts, not aspirational ones — each numeric constant, error code, and file:line-adjacent claim traces to real code, which is the expensive kind of documentation to fake and the cheap kind to keep current once it exists.

### 4. Where is this inconsistent with the rest of the repository?

`vscode-lm-tools/CLAUDE.md` has an established idiom for a spec-enforced invariant: "Both halves are needed and both are **pinned by** `http-mcp-server.service.spec.ts` section 6" (`CLAUDE.md:82`). The new bullet at `CLAUDE.md:93` uses "pins" correctly for the same kind of relationship one clause later ("`agent-spawn-surface-parity.spec.ts` pins that the advertised property keys… are identical"), but opens with "drives," a different verb for the same underlying mechanism (test-enforced equality, not code generation). Minor, but it is the one place in this diff that doesn't reach for the file's own vocabulary.

### 5. What would you have done differently, and why is that better rather than merely other?

I would have folded the "Internal Structure" fix into this same batch. Task 6.1 already tasked itself with correcting one stale "Batch 1" claim in this file (Public API); the sibling stale claim four lines later is the same defect, same cause (an early-scaffold note never revisited), and would have cost one sentence to fix here rather than becoming a fifth "accepted staleness" a future reader has to independently discover. That is a better outcome than "technically out of task scope" because the two sections are 158 lines apart in a 287-line file a reader consumes in one sitting.

## Blocking issues

None.

## Serious issues

### Internal Structure section contradicts the corrected Public API and Facade-split sections in the same file

- File: `libs/backend/cli-agent-runtime/CLAUDE.md:63-66`
- Problem: States `CLI_AGENT_RUNTIME_TOKENS` is an "empty placeholder in Batch 1" and `registerCliAgentRuntimeServices` is a "no-op in Batch 1." Both are false as of this diff's own "Public API" section (`CLAUDE.md:39-64`, listing five populated sub-barrels and real DI tokens) and "Facade split of `AgentProcessManager`" section (`CLAUDE.md:222-236`, describing real singleton registrations in `di/register.ts`). Verified against `libs/backend/cli-agent-runtime/src/lib/di/register.ts:40-47`, which registers `AgentSpawnEnvironment`, `AgentOutputBuffer`, and `TOKENS.AGENT_PROCESS_MANAGER` as singletons — nothing here is a no-op.
- Impact: A reader relying on "Internal Structure" (a section named for exactly this kind of orientation) gets actively wrong information about the DI surface, in a file that in the same commit corrected an adjacent instance of the identical defect. This is the "stale 'intentionally empty' Public API section" pattern the task asked to verify was corrected — it was, but only in the one section named that; a twin instance survives four lines further down.
- Fix: Replace `CLAUDE.md:65-66` with a short, accurate description (e.g., "`di/tokens.ts` — `CLI_AGENT_RUNTIME_TOKENS`; `di/register.ts` — `registerCliAgentRuntimeServices`, registers `AgentSpawnEnvironment`, `AgentOutputBuffer` and `AgentProcessManager` as singletons, see Facade split below") or delete the "Internal Structure" section and let "Public API" + "Facade split" carry that information, since they now do so more completely.

## Minor issues

- `vscode-lm-tools/CLAUDE.md:93` — "drives" implies code generation from `AgentSpawnArgsSchema.shape`; the actual mechanism is a parity spec (`agent-spawn-surface-parity.spec.ts:6-13`) asserting key equality against a hand-written object literal in `tool-description.builder.ts:494-595`. The file's own idiom for this ("pinned by") appears one clause later in the same bullet — use it for both clauses.
- `agent-lanes/SKILL.md:47` — "`timeout` \| Milliseconds; default and maximum one hour." is unchanged by this diff (pre-existing content, not touched by the B7 hunk) but is stale: `AgentSpawnArgsSchema.timeout` is `z.number().int().nonnegative().optional()` with no upper bound (`agent-spawn-args.schema.ts:12`, confirmed by `agent-spawn-args.schema.spec.ts:45` accepting `36_000_000`ms = 10 hours). This is the same defect already filed as a B5b follow-up against `tool-description.builder.ts:547`'s "max: 3600000 = 1hr" text (`batches.md` Out-of-delivery follow-ups list). Not a new issue introduced by B7 and not blocking; when that follow-up is picked up, sweep this line at the same time so the two docs don't re-diverge.

## File-by-file

### `libs/backend/cli-agent-runtime/CLAUDE.md`

Score 8/10 — 1 serious, 0 minor. Every fact in the new "Role-addressed lanes" section and the "Facade split of `AgentProcessManager`" section was verified directly against source and matched exactly: the `roleChannel` table (codex=`developer-instructions`, copilot/antigravity/opencode/cursor/pi=`task-prompt`, ptah-cli=`system-prompt`), all seven `AgentRoleErrorCode` values in the code's own declaration order, `MAX_ROLE_BYTES = 64 KiB`, the three platform budget-guard constants (`32_767` / `8_191` / `131_071` / `1_048_576 - 4_096`), the guard's call sites (`spawnCli` and codex's pre-`new sdk.Codex` check at `codex-cli.adapter.ts:632`), the "not modelled" gaps (Linux per-arg-only, darwin env bytes excluded), and the smoke spec's actual assertions. The one serious finding above is the sole defect found in this file.

### `libs/backend/vscode-lm-tools/CLAUDE.md`

Score 9/10 — 0 serious, 1 minor. The `AgentSpawnArgsSchema` bullet, the role-delivery/error-mapping bullet, and the `listRoles` degrade-to-`[]` bullet were each verified against `agent-spawn-args.schema.ts`, `ptah-api-builder.service.ts`, `protocol-dispatcher.ts:915-928` and `agent-tool.dispatcher.ts:539-548` — all accurate, including the `try/catch (error: unknown)` wrapper on *both* surfaces and the exact error-code list repeated correctly a second time. Fits the file's existing bullet style (bold lead sentence, then explanation) without exception. One minor wording nit (see above).

### `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/agent-lanes/SKILL.md`

Score 8/10 — 0 serious, 1 minor (pre-existing, out of this batch's scope). Frontmatter (lines 1-4) is untouched by this diff — confirmed the diff hunk starts at line 41, well past the frontmatter block, so it stays byte-identical to `origin/main`'s post-PR#501 HEAD as the conflict guard in `batches.md` requires. The added `role` row (§2) and the `role` paragraph (§3) match the tool's actual description exactly (no vendor names in either; `tool-description.builder.ts:587-594`'s `role` property description is likewise vendor-free) and match the table/prose conventions already used by neighboring rows. `lane-rule-single-home.spec.ts` is not violated: its `HOME` constant is this same file, and none of its six `LANE_RULES` regexes match role content, so there is nothing to restate elsewhere. The unrelated, unchanged `timeout` row's staleness is noted above as a minor, non-blocking, already-tracked issue.

### `content-manifest.json`

Score 10/10 — regenerated, not hand-edited. `node scripts/generate-content-manifest.js --check` reports `content-manifest.json is up to date (sha256:0da065b53da28a6d3d350086ecd84dc55396869841fe10e48e7e40ad1d8e53cb, 224 files)`, matching the diff's new `contentHash` exactly.

## Pattern compliance

| Repository rule or nearby convention | Status | Evidence |
| --- | --- | --- |
| `catch (error: unknown)` narrowed with `instanceof Error` (root CLAUDE.md) | PASS | `agent-role-resolver.service.ts:95-96,164-165`; `agent-tool.dispatcher.ts:542-544`; `protocol-dispatcher.ts:921,926` |
| Zod `.strict()` at external MCP boundary (root CLAUDE.md "Validation") | PASS | `agent-spawn-args.schema.ts:6-20` |
| Facade rule: public class keeps name/token/signatures, extracted concern becomes injected collaborator (root CLAUDE.md "File size") | PASS | `agent-process-manager.service.ts:156-161` injects `AgentSpawnEnvironment`/`AgentOutputBuffer` by class token, same pattern as `AgentMessageRouter`; `di/register.ts:44-47` registers both as singletons before the manager |
| Doc claims must be true against code (task instruction) | PASS (with 1 exception) | See File-by-file above; exception is the stale Internal Structure section (Serious finding) |
| No duplication of content already elsewhere in the file (task instruction) | PASS | "Role-addressed lanes" (resolver/adapter internals) and the `vscode-lm-tools` role bullet (MCP surface/error mapping) split the same feature along the file's own dependency boundary with no overlapping claims |
| Lane rules have one home (`lane-rule-single-home.spec.ts`) | PASS | `HOME` is `agent-lanes/SKILL.md` itself; no `LANE_RULES` pattern matches the new `role` content |
| `description`/`title` as `>-` block scalar where they contain a colon (task-specs rule) | N/A | Not applicable — no task.md frontmatter touched in this diff |
| Manifest regenerated via script, not hand-edited (task instruction) | PASS | `node scripts/generate-content-manifest.js --check` green, hash matches diff |

## Maintenance debt

- Introduced: ~180 new lines of documentation across two lib `CLAUDE.md` files, all independently verified against source; one new skill row + one new skill paragraph, both accurate and scope-disciplined (no vendor names, no restated lane rules).
- Retired: the stale one-line "Batch 1 scaffold" placeholder in `cli-agent-runtime/CLAUDE.md`'s Public API section.
- Net: strongly positive — the role-addressed-lanes feature (a cross-cutting change spanning two libs) is now documented with a level of code-traceable precision this review could verify claim-by-claim. The one negative is that the Public API fix wasn't paired with the nearly-identical Internal Structure fix four lines away, leaving one contradiction where there used to be a lone stale note.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Key concern: `cli-agent-runtime/CLAUDE.md`'s "Internal Structure" section (lines 63-66) now contradicts the "Public API" and "Facade split" sections in the same file — a documentation-only defect, not a behavior risk, and a one-sentence fix.
- What a 10/10 version would do differently: fix the Internal Structure section in the same commit (it's the same defect class the batch was already fixing four lines above); use "pinned by" consistently in `vscode-lm-tools/CLAUDE.md:93` instead of introducing "drives" for the same test-enforced-equality relationship; and, while touching `agent-lanes/SKILL.md`, take the free opportunity to correct the adjacent stale `timeout` row rather than leaving two docs (`tool-description.builder.ts` and this skill) independently wrong in the same way.
