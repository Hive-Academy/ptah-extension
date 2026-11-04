## Files changed

- `libs/backend/worker-runtime/src/lib/session-driver.ts` and `session-driver.spec.ts`: tab routing with a pre-resolution queue; metadata, provider and concurrency gates; `chat:continue` turn admission; turn markers; `chat:abort` callback for log append failure; native Codex attach snapshot gate.
- `libs/backend/worker-runtime/src/lib/transcript.ts` and `transcript.spec.ts`: baseline and history marks from `readForResume`; lock-proven attach refresh; log and snapshot outcomes; fail-closed lock refusal.
- `libs/backend/worker-runtime/src/lib/pending-permissions.ts` and `pending-permissions.spec.ts`: synchronous first-answer consumption, SDK response forwarding, answer record, manual-approval assertion.
- `libs/backend/worker-runtime/src/index.ts`: public exports for the three modules.

## Decisions

- **Decision:** Inject the history reader, metadata reader, lock, and writer lookup as ports. **Options:** resolve services in the driver or inject them. **Evidence:** W8 names `CHAT_TOKENS.HISTORY_READ`, Batch 18 owns service assembly, and current runtime units use injected boundaries. **Reversible:** yes.
- **Decision:** Admit a turn through `chat:continue` before reading baseline history. **Options:** acquire a second driver lock directly or use the coordinator path. **Evidence:** Batch 17 requires the existing coordinator and forbids a second path; successful RPC admission is the point where that coordinator owns the turn. **Reversible:** yes.
- **Decision:** Reserve a slot before awaiting the RPC. **Options:** count only active turns or count active turns plus pending admissions. **Evidence:** concurrent admissions must obey `maxActiveTurns`. **Reversible:** yes.
- **Decision:** Expose a manual-approval assertion for service startup wiring. **Options:** silently ignore auto-approve or refuse startup. **Evidence:** AD-16 and Batch 17 require refusal. **Reversible:** yes.

## Spec coverage

- Tab map and pre-resolution queue: `routes pre-resolution events and aborts through chat:abort when a log append fails`.
- `TURN_IN_FLIGHT`, `WORKER_BUSY`, normal Claude and metadata-less admission: `claude-sdk and metadata-less sessions take chat:continue; tracks in-flight and busy turns`.
- `NO_PROVIDER_READY`: `refuses without a ready provider before calling chat:continue`.
- Native limit before RPC and metadata error: `refuses native Codex before chat:continue and before any lock path; metadata failure also refuses`.
- Baseline, end mark, persisted JSONL, desktop turn attach refresh, old `afterSeq`, no-change attach: `A3 / R-K fixture JSONL refreshes after an intervening desktop turn and replays its new baseline`.
- Other holder snapshot and unavailable lock: `returns a labelled snapshot while another process holds the lock and fails closed when unavailable`.
- First answer wins, answer record and disallowed `always_allow`: `first answer wins synchronously; auto-approve is refused`.
- Startup auto-approve flags: `refuses worker auto-approve flags and environment`.
- Append failure abort through `chat:abort`: `routes pre-resolution events and aborts through chat:abort when a log append fails`.

## Not done / Clarifications Needed

- The protocol's `WorkerErrorCode` currently excludes `CODEX_UNAVAILABLE` (`errors.spec.ts` explicitly expects false), so the driver emits an internal typed refusal; Batch 18's wire adapter needs a protocol error-code decision or mapping before it can expose that exact code to clients. This batch did not change `worker-protocol` outside its assigned files.
- The service assembly that supplies `SessionLogWriterOptions.onAppendFailed` and calls `assertManualApproval` belongs to Batch 18. The driver provides the callbacks and assertions, and the specs exercise them, but they are not yet invoked by an assembled worker service.
- Jest and `npm run verify` were not run in this sandbox per the user instruction; the orchestrator owns the scoped verify.
- Both `npx tsc --noEmit -p libs/backend/worker-runtime/tsconfig.lib.json` and `npx tsc --noEmit -p libs/backend/worker-runtime/tsconfig.spec.json` passed after formatting. Scoped Ptah diagnostics timed out while its background check was running; the direct scoped TypeScript checks passed.

## Orchestrator corrections (verify)

- `transcript.ts`: lint `no-unsafe-finally` (a `throw` in `finally` could hide the refresh
  error). The lock release now runs on every path, and the refresh error takes priority over
  a failed release.
- Carried to Batch 18: map the internal `CODEX_UNAVAILABLE` refusal to a wire code per W12;
  wire `SessionLogWriterOptions.onAppendFailed` and `assertManualApproval` in the service.
- Result: `npm run verify -- -p @ptah-extension/worker-runtime` passed (19 suites, 46 tests).
