# P1-12 Ubuntu replay isolation

## Files

- Added `tools/review-eval/ubuntu-bwrap-launcher.ts` and adjacent spec.
- Added `tools/review-eval/model-api-broker.ts` and adjacent spec.
- Added `tools/review-eval/isolation-attestation.ts` and adjacent spec.
- Changed `libs/backend/codex-runtime/src/lib/codex-app-server-process.ts` and adjacent spec.

## Bwrap argv design

`makeUbuntuBwrapRequest` validates absolute canonical inputs, requires Linux, restricts the request to Codex `app-server`, checks cwd under the snapshot and the executable under a sealed runtime, and rejects overlapping source/output roots. It emits one argv array for `bwrap`: `--unshare-all --clearenv`, private `/tmp`, source read-only at `/work/src`, output writable at `/work/out`, runtime read-only at `/runtime`, and host broker Unix socket read-only at `/run/model-broker.sock`. PATH is only `/runtime/bin`; `gh`, host env tokens, MCP sockets, and host git refs are absent unless the supplied runtime or snapshot itself contains them. The Codex process is launched through an expected in-namespace proxy binary at `/runtime/bin/model-broker-proxy`, with HTTP(S) proxy loopback variables. The launcher rejects a missing or misplaced proxy binary.

The broker accepts only POST `/v1/responses` and `/v1/chat/completions` toward `https://api.openai.com/`; it injects the credential on the host and rejects redirects, arbitrary destinations, methods, paths, and caller-supplied auth fields. It records allowed/denied method and path without tokens. Attestation requires all six denials, correct mount modes, zero failures, and writes a hashed JSON record outside the lane root with exclusive creation and mode 0600.

## Denial → probe → spec

| Denial | Probe/evidence | Spec |
| --- | --- | --- |
| Non-Linux launch | Typed `ReplayIsolationError` before delegate spawn | `ubuntu-bwrap-launcher.spec.ts` |
| Host env tokens and `gh` PATH | `--clearenv`, empty host env, PATH only sealed runtime | `ubuntu-bwrap-launcher.spec.ts` |
| Direct network and GitHub | `--unshare-all`; broker path/method/origin allowlist | `ubuntu-bwrap-launcher.spec.ts`, `model-api-broker.spec.ts` |
| Secrets and MCP sockets | Only explicit mounts, no home or host socket mount | `ubuntu-bwrap-launcher.spec.ts`, `isolation-attestation.spec.ts` |
| Post-head refs | Read-only bounded snapshot; no host git mount | `ubuntu-bwrap-launcher.spec.ts`, P1-11 snapshot builder |
| Any leak or missing probe | `evaluateIsolation` makes score invalid | `isolation-attestation.spec.ts` |

`runIsolationProbes` executes the six named denial probes through an injected runner and records a failed probe if execution throws. Specs use fakes only. The runner that executes real commands inside a live namespace is an Ubuntu integration responsibility.

## Codex runtime compatibility

An optional sixth constructor parameter transforms the `ProcessSpawnRequest` immediately before the existing spawner call. With no hook, the original request and default spawner behavior remain unchanged. The adjacent spec checks hook invocation and modified request; pre-existing exact spawn-request spec checks the default path. Scoped `ptah_get_diagnostics` found zero TypeScript errors in all eight changed TypeScript files. No Nx or Jest command ran, per D26; orchestrator must run `npm run verify -- -p review-eval` and `npm run verify -- -p codex-runtime`.

## Decisions

- Require Linux and canonical paths; reject other platforms with a typed error. Evidence: P1-12 and plan line 228. Reversible for a future family-specific adapter.
- Pin the broker to the OpenAI origin and two inference paths. Evidence: P1 is Codex-only and the plan requires inference-only egress. Reversible after a reviewed endpoint policy.
- Require a sealed runtime and a named proxy binary instead of mounting host `/usr` or PATH. Evidence: the plan requires only necessary runtime binaries/libs and no `gh`. Reversible when the Ubuntu runtime image is specified.
- Keep the attestation outside the lane and invalidate a missing or failed denial probe. Evidence: AC-17.7 and plan line 229. Reversible only with a changed scoring policy.

## Open issues on Ubuntu

This batch does **not** establish a runnable end-to-end replay. The repository has no audited `/runtime/bin/model-broker-proxy` binary or sealed runtime image, and this batch's file scope does not include one. The host Unix broker server is constructed but must be bound/listened by the Ubuntu runner. A real namespace probe runner is also still needed; the fake specs prove policy and invalidation logic, not kernel enforcement. A score must remain invalid until that proxy, the socket route, runtime dependencies, real denial probes, and attestation persistence are exercised on Ubuntu. D21 places the live replay after merge; D28's fixture is still pending. Skill loading was unavailable: no skill-loading tool was listed for this lane.

