# Context — TASK_2026_306

## How this task arose

The developer ran `nx serve ptah-electron` in a dev workspace and the app never
opened a window. The serve output was captured to `tmp/logs/log.log` (1200 lines,
2026-08-22) and handed over with the observation that the log "keeps repeating
something and so far didn't start yet".

The repeating block was a `CodexProxy` request/429 cycle with no backoff and no
give-up. Tracing it produced two distinct root causes and seven further defects.

## User intent

Two statements shaped the scope:

1. Analyse the serve log and identify every problem and warning worth fixing.
2. Resolve the boot blocker **properly**, not by papering over it. The
   developer's own diagnosis — quoted because it is the correct framing and
   should survive into the fix:

   > i do believe the issue is that codex subscription is already finished, and
   > i'm using codex as an auth provider in that dev instance, which could
   > happen with any developer so rather we keep looping and have that calls
   > which relies on having a proper and healthy subscription works needs to be
   > gated correctly to avoid bad leaks and poor ux workflow

That framing is right, and one correction follows from it: the boot blocker and
the quota gate are **independent**. The activation chain awaits background work
unconditionally, so a healthy provider with a large drain backlog stalls the
window in exactly the same way. An exhausted subscription turned a long stall
into an unbounded one; it did not create the ordering defect. Both need fixing,
and the boot fix must not be written as if it were a workaround for the quota
problem.

## Scope

**In scope**

- Boot ordering: background work must never gate `createMainWindow`.
- Provider quota gate: a 429 must stop background LLM work before dispatch,
  reusing the existing `ILaneAuthResolver` stall seam rather than inventing a
  parallel mechanism.
- The seven further defects catalogued in `research-report.md` (§3), each with
  its own severity and independent fix.

**Out of scope**

- Any change to `ANTHROPIC_PROVIDERS` registry entries or `defaultTiers`.
- Any change to the translation proxy's 429 _response_ — it is already correct.
- Retry/backoff policy inside the Claude CLI subprocess, which is not ours.

## Constraints carried from the codebase

These are contracts that the fix must not break. Each is documented in the
owning lib's `CLAUDE.md` and was checked during the investigation.

- **No provider is privileged.** `lane.types.ts:15-27` forbids any provider-id
  literal in a lane code path, enforced mechanically by
  `lane-resolver.providers.spec.ts`. A quota gate keyed on the _resolved_
  provider id is permitted; a branch naming a provider is not.
- **Unresolvable lane auth stalls; it never falls back** (`lane.types.ts:134-143`).
  Quota exhaustion is the same category and should reuse this path. Falling back
  would put background work onto foreground quota — the exact defect lanes exist
  to prevent.
- **`LaneAuthOverride.env` keeps `| undefined` values.** Never serialize,
  `structuredClone`, Zod-parse or truthiness-filter a lane env; dropping
  undefined-valued keys re-leaks foreground credentials into background work
  with no type error (`lane.types.ts:86-98`).
- **`skill-synthesis` keeps zero direct SDK imports.** `IInternalQuery`,
  `LaneAuthOverride` and `ILaneAuthResolver` are local structural mirrors. A new
  quota port must follow the same mirror-plus-interned-symbol pattern.
- **`drain()` never throws** (`skill-drain.service.ts:10-15`). Every gate and
  failure resolves to a `DrainSummary`.
- **The memory curator diverges deliberately** — it _does_ fall back to the
  active provider (`sdk-internal-query.curator-llm.ts:84-91`). That divergence is
  intentional for auth, but it would walk straight past a quota gate, so the
  curator needs the check applied separately rather than inherited.

## Environment of the captured run

| Field            | Value                                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------ |
| Host             | Electron 40.10.1, win32/x64, dev build                                                                       |
| Auth             | `authMethod: thirdParty`, provider `openai-codex`, OAuth translation proxy on `127.0.0.1:57825`              |
| Tier mapping     | `opus: gpt-5.6-sol`, `sonnet: gpt-5.6-terra`, `haiku: gpt-5.6-luna` (user-set, overriding provider defaults) |
| Workspace        | `D:\projects\property-hub` (restored from persisted state)                                                   |
| DB               | `C:\Users\abdal\.ptah\state\ptah-dev.sqlite`, 27.46 MB, schema v39, sqlite-vec loaded                        |
| Permission level | `yolo`                                                                                                       |
| Licence          | none — `tier: community`                                                                                     |

## Orchestration decisions

Taken at Checkpoint 0 / 0.1 on 2026-08-22.

| Decision         | Value                                                      |
| ---------------- | ---------------------------------------------------------- |
| Strategy         | BUGFIX — research complete, straight to team-leader MODE 1 |
| Branch           | `ak/boot-blocker-quota-gate` (off `main`)                  |
| Scope            | **Defects A through G.** H (noise) is opportunistic only   |
| `cli_delegation` | **disabled** — sub-agent developers only                   |
| B / cooldown     | 15 min, module constant beside `LANE_AUTH_RETRY_MS`        |
| B / curator      | Stops entirely while its resolved provider is cooling down |
| B / UI signal    | Deferred — backend-observable half only in this task       |

**Why CLI delegation is off.** The work is small, tightly coupled and
reasoning-heavy — a one-line ordering change, a cross-lib port spanning three
libs, and two parsing fixes. None of it is the file-disjoint boilerplate that
CLI fan-out is good at. Independently: `ptah_agent_list` reports `codex` as the
only installed CLI agent, and `codex` is the provider whose exhausted quota
produced this task. `cursor` is not installed. The two healthy options
(`claude cli`, `ollama cloud`) were available and still declined on the coupling
argument, not on availability.

## Next step

`research-report.md` is a defect inventory, not an implementation plan. Defect B
carries a proposed design in §B ("Proposed gate") that is concrete enough to
batch from — a proxy-side quota store, a `ProviderQuotaError` matched by name,
and a new `quota-exhausted` failure kind — but it spans `auth-providers`,
`skill-synthesis` and `memory-curator` and must be batched as its own sequence
with the three open questions resolved first (default cooldown, curator
fallback, user-facing signal).

Defect A is a one-line change and should land first so the app is usable while
the rest proceeds. C through G are self-contained with no ordering constraint
among them.
