# Code Style Re-review P2 fixes (round 1 of 2)

Review family: Claude reviewer, Codex implementer.
Score: 8.5/10. Verdict: APPROVED (4 minor leftovers, none blocking).

## Status of original findings
1. Validator split: RESOLVED. schemas 536 / methods 305 / validator 247 lines; eslint on the three: 0 max-lines warnings. Validator keeps error class, dispatch, frame validation and re-exports. codex-runtime.ts is 734 raw lines but lint reports no max-lines (comments/blanks skipped); only 4 pre-existing preserve-caught-error warnings (e.g. :662).
2. Fixtures: RESOLVED. src/lib/__fixtures__/spike-run-6e..6j.json; no `.ptah/specs` path in any spec. Sampled grep found no secrets; a full redaction audit of the JSON was not done. Residual: codex-parity-gate.ts:14 doc comment still names the task folder (comment only).
3. CodexProtocolManifest: RESOLVED. Gone; verifyCodexBinary (codex-protocol-manifest.ts:19-23) takes Pick<CodexExecutableManifestRow,...>.
4. Shared normalizer: PARTIAL. codex-home-path.ts (normalizeCodexHomeKey) used by usage client (:126,155,196,...), execution profile (:199,217) and registration. Still duplicated: codex-app-server-process.ts:185-190 `canonical` (trim, lowercase) is a fourth copy with slightly different rules (no NUL/absolute check). auth-providers codex-home-auth.service.ts:54/158 still uses plain resolve(home) and does not import the helper. See F-A, F-B.
5. Registration: RESOLVED. instanceCachingFactory for Runtime/ParityGate/usage client (registration.ts), duplicate guard via isRegistered, ParityGate token added and class aliased with useToken, resolveGatedCodexRuntime gates the raw Runtime token, null usage keeps useFactory: () => null. Identity check moved into CodexAccountUsageClient.fromProfiles.
6. Logger comment: RESOLVED (codex-runtime-ports.ts:1).
7. index.ts: MOSTLY RESOLVED. Explicit export lists, no `export type *`, Clock exported as CodexClock (:36), trailing experimentalApi block removed. Leftover: comment at index.ts:66-67 still mentions the deleted CodexProtocolManifest (F-C). normalizeCodexHomeKey is now public; fine if auth-providers adopts it (F-B), otherwise it is an unused export.
8. project.json externals: RESOLVED (["tsyringe"]). zod is imported but not external; acceptable (bundled) - confirm intent, matches other libs? not verified.
9. passWithNoTests: RESOLVED (removed).

## New / remaining findings
F-A (minor) codex-app-server-process.ts:185-190: replace local `canonical` with normalizeCodexHomeKey (handshake compare must use the same key as the profile).
F-B (minor) auth-providers/src/lib/providers/codex/codex-home-auth.service.ts:54,158: adopt normalizeCodexHomeKey so watcher keys equal usage-client keys; otherwise case/trailing-slash divergence on win32 persists. Out of codex-runtime scope but the port contract says homes are pre-normalized.
F-C (minor) index.ts:66-67: stale comment referencing removed type; reword to "CodexExecutableManifestRow is the canonical pin".
F-D (minor) codex-parity-gate.ts:14: evidence "Sources relative to .ptah/specs/TASK_2026_714_c8a2/" couples a library to a task folder; acceptable as documentation only.
New-file naming (codex-home-path, codex-protocol-schemas/-methods) follows kebab-case + role convention; no new leaked internals found in index.ts.
