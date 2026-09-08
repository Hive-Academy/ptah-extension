# Context — private chat sessions on their own provider

## What the user asked

Two chat tiles in one workspace, one on Claude and one on Codex, at the same
time. The user's stated preference for the design (2026-09-07):

> Rather than changing what we have — the global and default provider is used
> in lots of places — allow the user to start a new session with a specific
> provider other than the main one. A private session with its own
> configuration. A utility process or a worker could be an option.

## History

- `TASK_2026_304` filed the first plan: thread a `providerId` through the
  existing global path in 10 batches. Never started. Cancelled 2026-09-07.
- Codex reviewed that plan in
  `.ptah/specs/TASK_2026_304/plan-review-codex.md` and rejected it. Read that
  review first. Its findings are the constraints below. Its `context.md` still
  holds the verified description of today's plumbing and is worth reading.

## Design constraints carried over from the review

1. **Global path untouched.** The singleton `SdkAgentAdapter`, its
   initialization latch, `SessionLifecycleManager`, config/auth subscriptions
   and process-wide `reset()` stay the default lane. An install that never
   starts a private session behaves exactly as before.
2. **In-process, not a worker.** The SDK already spawns one CLI subprocess per
   query and `Options.env` is already per-query. Isolation is ownership and
   lifecycle in Ptah's own objects. A worker / Electron `utilityProcess` is
   deferred until a measured need (SDK static-state leak, event-loop CPU,
   crash containment) appears. Record the trigger conditions in the plan.
3. **Not a naive tsyringe child container.** `agent-sdk/di/register.ts` has 61
   `Lifecycle.Singleton` registrations, so a child container shares the parent
   adapter. A private runtime factory must re-register only the stateful
   subgraph and share platform ports, logger, module loader, metadata/history
   stores and the machine-global OAuth token services deliberately.
4. **Immutable, durable `SessionExecutionConfig`.** A Zod-validated
   discriminated union — `inherit` | `private-provider` | `ptah-cli` —
   persisted with session metadata once the SDK UUID resolves. Backend metadata
   is authoritative; frontend tab state is a projection; RPC hints only apply on
   start or as a legacy backfill. Provider never changes on a live session; a
   picker change starts or forks a new session.
5. **Fail closed.** An explicit private choice whose profile cannot be built
   returns `AUTH_REQUIRED` / a typed failure. It never answers from global auth.
6. **One query-creation funnel.** Start, resume, continue, slash re-query,
   rewind and fork all ask a session router for the execution config.
7. **Safe env.** Private queries build the subprocess env from an explicit
   whitelist (see `build-safe-env.ts`) with explicit absence for all twelve
   `ALL_TIER_ENV_KEYS`, not from `...process.env` plus blanking.
8. **Leases, not a prefix map.** Provider-profile / proxy ownership uses
   reference-counted leases with single-flight acquire, retirement on config
   rotation, idempotent release, and indexes by tab id, real session id and
   workspace. Generalize `ptah-cli-registry.ts` mechanics.
9. **Global resets never reach private runtimes.** `auth:saveSettings`, Copilot
   and Codex login/logout, clear-workspace-override and the config-change
   subscriber dispose only the global adapter.
10. **Three hosts.** VS Code extension host, Electron main and the CLI JSON-RPC
    process share the same factory. The CLI must not depend on a renderer for
    the source of truth.
11. **Out of scope.** Per-workspace credentials, OAuth token scoping, the
    gateway always-global hole (file separately), making private the default.

## Definition of done

Two tiles on one workspace folder, one on Claude and one on a Codex/Copilot/
OpenRouter profile, stream at the same time on distinct proxy ports and model
catalogues. Flipping the global provider, saving auth settings, or a global
initialization failure does not touch the private tile. Both pins survive a
webview reload and a host restart in all three hosts. Closing an idle private
tile releases its runtime and lease. The twelve proof tests listed in the
Codex review (section 4) pass.
