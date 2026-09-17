# Boot readiness timeout / startup freeze

User reports initial-load UI freezing for a couple of minutes. Screenshot contains repeated (count10) [ClaudeRpcService] RPC timeout for method: boot:getReadiness. User explicitly prioritizes this as critical irrespective of relation to compaction and requests a CLI agent investigate.

Strategy BUGFIX: investigate logs and implementation, establish cause, plan minimal fix, orchestrator review before implementation. CLI delegation explicitly enabled: Ollama Cloud pc-85830910-3d81-4248-84c1-4fa52752dd19. No commits/pushes. No production data changes or restarting user's running app.

Dedicated worktree D:/projects/ptah-extension/.claude-worktrees/boot-readiness-timeout, branch fix/boot-readiness-timeout. Product reads and eventual edits must use that worktree, not root. Canonical report folder D:/projects/ptah-extension/.ptah/specs/TASK_2026_415. Independent related task414 handles compaction; avoid scope overlap and never run process-wide nx reset while other agents execute.

## Evidence and leads

- Screenshot repeated boot:getReadiness timeout, not yet proof of root cause. Distinguish missing handler/transport readiness vs handler blocking vs event-loop starvation vs frontend rendering stalls.
- Application log C:/Users/abdal/AppData/Roaming/Ptah/logs/Ptah Electron-2026-09-10.log. Read locally and narrowly. Never include secrets/prompts in report. Log earlier startup around23:05 UTC on Sept9 and later startup before15:44 UTC Sept10; identify correct current process by log boot markers rather than guessing.
- Memory leads (must verify current code): TASK_2026_380 investigated initial-load performance. Five boot RPCs previously blocked main thread: autocomplete:agents, git:info, config:models-list, session:list, auth:getAuthStatus. boot:getReadiness uses BOOT_READINESS port and ElectronBootReadinessProvider; NullBootReadinessProvider for other hosts. Pull recovery is required because pushes before Angular bootstrap can be lost.
- Existing measure-boot-rpcs.mjs reportedly measures cold boot on isolated copied profile. Inspect before considering execution; do not copy/access production DB unnecessarily or start another live profile. Prefer unit/integration reproducible slow-boot fixtures.
- Screenshot compaction diagnostics correctly resolve originating session/tab, and context stats suppression is deliberate guard. Separate background_agent missing agentId fallback warning is lower-priority and not evidence of startup cause.

## Acceptance for eventual fix

Readiness RPC should be available promptly and represent true state, never fake ready. Bound polling/inflight requests and clean teardown. Address demonstrated blocking work rather than increase timeout or suppress diagnostics. Preserve all three hosts and hexagonal boundaries. Tests should exercise slow startup, request/response delivery, recovery/teardown and identified actual failure. Report installed-bundle vs source mismatch if present. No arbitrary broad startup redesign.
