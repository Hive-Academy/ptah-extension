# P1-B fixes, lane B

Implemented review findings 2, 3 and 4 within the four assigned source/spec files.

## Files changed

- `libs/backend/agent-sdk/src/lib/helpers/named-account-prompt-gate.ts`: keeps the shared iterator open while empty. Held and committed queues are separate; every later push is held until a fresh commit. Close/reject/abort/iterator return clear both queues and wake readers. Public interface and export names unchanged; state returns to held on subsequent push.
- `libs/backend/agent-sdk/src/lib/helpers/named-account-prompt-gate.spec.ts`: replaces one-shot exhaustion/new-gate expectations with same-iterator multiple turns, empty commit without preapproval, overlapping committed and held input, abort while waiting, close dropping uncommitted input, and listener lifetime coverage. Preserves pre-commit closure/race coverage.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/claude-cli.adapter.ts`: generates a UUID routing hint per spawn; applies SDK-supported effort values when model is omitted; retains existing precedence/logging for unsupported candidates; removes only the structured segment buffer cap.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/claude-cli.adapter.spec.ts`: adds two-fresh-spawn routing coverage, all five supported effort values without model, unsupported effort logging/fallback, and ordered replay of 5,001 buffered segments plus live delivery. Types the permission callback mock arguments for routing assertions.

## Diagnostics result

Called ptah_get_diagnostics with only the four assigned absolute paths, then retried once after final edits. Both responses: source typescript-compiler, unavailable; coverage qualified, unchecked=4. Reason: TypeScript check still running after 45s and not cancelled. No successful diagnostics result is claimed. Tests, Nx, Jest, tsc, lint, build, serve, e2e and package were not run, as instructed. CI must execute the regression specs.

## Decisions

1. Use separate held and committed queues within the existing gate API rather than replacing the gate each turn or reopening an exhausted iterator. Evidence: review finding 2 and implementation-plan.md line 185 require one query prompt iterable and fresh per-turn approval. This also permits approved input to drain while later input remains held. Reversible internal implementation; exported names/signatures remain unchanged.
2. Generate `claude:${randomUUID()}` for each spawn rather than relying on an optional agent id. Evidence: adapter input permits spawns without an agent id; claude-sdk-lane-options.ts prioritizes resume and parent sessions over the routing fallback. Session routing remains intact and fresh runs cannot share the constant hint. Reversible local choice.
3. Apply valid effort without a model, rather than dropping it with a log. Evidence: installed SDK sdk.d.ts Options.effort (line 1823) is independent of model; sdk.mjs emits `--effort` whenever this.options.effort is set without a model condition. Use existing low/medium/high/xhigh/max scale and precedence; unsupported values use the existing Not applied message. Explicit-model metadata behavior remains unchanged. Reversible adapter behavior.
4. Retain all pre-subscription structured segments rather than introducing a shared abstraction or changing the native registry. Evidence: ptah-cli-registry.ts createCallbackInfrastructure at lines 1305-1307 pushes every segment; only its stream-event buffer is capped. Adapter now matches that behavior and still clears buffers during disposal. Reversible, with the same memory tradeoff as the registry.

## Not done

- Diagnostic availability prevented type-check confirmation; CI verification remains required.
- No other source files, task state, exports, registrations or host surfaces were edited. No git commands were run.
