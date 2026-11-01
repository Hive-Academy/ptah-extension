# Batch 10d.V fix 2 report

## Fixes

- V-1 and V-6: `apps/ptah-extension-vscode/src/di/codex-lane-runtime-composition.ts:68-78` delegates binary inspection to the shared `inspectCodexExecutable` helper. The host keeps native path resolution, the explicit path refusal at line 152, and the open path refusal at line 183. Both probe and open use the shared cache and pass its measured SHA-256 and version output into runtime ports at lines 186-188. Local streaming hash code was removed.
- V-2: `apps/ptah-extension-vscode/src/di/codex-lane-runtime-composition.ts:231-239` logs a cleanup failure with the injected Logger and a real Error, then rethrows the original open error. The swallowing catch has the required degradation audit comment.
- V-3: `apps/ptah-extension-vscode/src/di/codex-lane-runtime-composition.spec.ts:326-342` installs a gate stub and asserts `isEnabled('lane', platform)` was called by the gated resolver. A raw runtime lookup alone now fails the assertion.
- V-4: `apps/ptah-extension-vscode/src/di/codex-lane-runtime-composition.spec.ts:127-164` covers digest mismatch and unavailable pin error codes, `installed: false`, and refusal to start a lane. The existing missing binary case remains at line 107. Each case uses its own temporary fixture file. The spec mocks the public shared inspector to test host error propagation; hashing and cache behavior belong to the shared helper.
- V-2 spec: `apps/ptah-extension-vscode/src/di/codex-lane-runtime-composition.spec.ts:303-324` asserts a failed open whose dispose also fails rejects with the original Error object and logs the dispose Error object. The existing successful cleanup case remains.
- V-5: Information only. Per D27/D28, VS Code development mode on a platform without a reviewed pin can select a native lane that reports unavailable; no behavior changed.
- Runtime port assertions at `apps/ptah-extension-vscode/src/di/codex-lane-runtime-composition.spec.ts:215-235` cover the measured digest and version output from inspection.

## Decisions

- Use the shared inspector rather than a host cache. Options were a VS Code cache or the shared helper; the helper already caches by real path, file size, modification time, and reviewed pin and drops failed entries. Reversible by changing the host call.
- Keep the host's pin lookup after inspection because the adapter probe returns the pinned version. The shared inspector validates the pin first; the host lookup supplies that row to runtime ports. Reversible if the shared return contract later includes the pin.
- Mock the public inspector in host specs because its real implementation reads the immutable reviewed pin from its own module, while host fixtures use synthetic binaries. The host specs verify propagation and runtime port wiring; shared inspector coverage is outside this scope. Reversible by using an injected pin contract in a later change.

## Not done

- No tests, typecheck, lint, build, Nx, npm, verification, or `ptah_get_diagnostics` ran, as the task's hard rules require. AST structure and UTF-8/LF line endings were inspected only.
- No skill loader was listed for this lane; repository and task instructions governed the edits.
