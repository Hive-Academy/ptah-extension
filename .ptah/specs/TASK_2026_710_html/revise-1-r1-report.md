# R1 Electron and store revision

## Changes and evidence

| Defect | Change | Test |
| --- | --- | --- |
| #3 | `libs/backend/platform-electron/src/artifacts/electron-artifact-store.ts:179` explicitly projects only `ArtifactRecord` fields; `savedPath` stays in publish results. | `publishes HTML to managed storage and lists only the owning session` checks strict `ArtifactListResponseSchema`. |
| #5 | `apps/ptah-electron/src/windows/main-window.ts:73` cancels non-artifact subframe navigations without external handoff. `artifact-frame-guard.ts:2` accepts only `ptah-artifact://<id>/index.html`; main-frame handling is unchanged. The e2e fixture at `fixtures/containment.html:46` attempts self-navigation, and `artifact-containment.spec.ts:95` checks that the frame URL stays put and no attacker request finishes. | `isAllowedArtifactFrameUrl` seven cases; e2e assertion added but not run. |
| #6 | `electron-artifact-store.ts:76-120` checks every source component with `lstat`, checks realpath containment, opens with `O_NOFOLLOW` where present, compares descriptor identity, size, and mtime with the pre-open stat, and reads through the descriptor. | `copies a workspace HTML file, preserving published bytes after source changes`; `rejects an in-workspace source symlink`; `rejects a symlink that escapes the workspace`. |
| #7 | `electron-artifact-store.ts:26` defines a stored-record Zod schema including `workspaceRoot` and `savedPath`; `:217` uses `safeParse` and skips invalid records. | `skips invalid metadata and sweeps stale temporary directories`. |
| #8 | `electron-artifact-store.ts:172,207,222` returns empty or skips a missing record only for `ENOENT`; other directory and metadata IO errors become `IO_ERROR`. `artifact-store.interface.ts:18` declares the code. | `reports store IO errors instead of empty lists`. |
| #10 | `electron-artifact-store.ts:46` serializes publishes with one promise queue; `:131` reports `QUOTA`; `:162` maps write failures to `IO_ERROR`. `artifact-store.interface.ts:17` declares `QUOTA`. | `serializes concurrent publishes at the workspace quota`; `does not expose an incomplete record after a metadata write failure`. |
| #11 | `electron-artifact-store.ts:83` rejects source symlinks; `:42,227` sweeps stale temporary directories with audited best-effort failures. `apps/ptah-electron/src/main.ts:123` permits the e2e fixture resolver only in unpackaged builds. | `rejects an in-workspace source symlink`; `skips invalid metadata and sweeps stale temporary directories`. |
| #13 | `apps/ptah-electron/src/windows/shell-csp.spec.ts:164` expects only `ptah-artifact:` for `frame-src`. | `emits the strict shell CSP` suite (7 tests). |
| #14 | `apps/ptah-electron/src/artifacts/artifact-protocol.ts:37` adds the requested degradation audit comment. | No behavior change; existing protocol tests were not changed. |

## Verification

- `platform-electron` store Jest spec: 10 passed.
- `ptah-electron` artifact frame guard Jest spec: 7 passed.
- `ptah-electron` shell CSP Jest spec: 7 passed (existing ts-jest `allowJs` warning).
- Scoped `ptah_get_diagnostics` was attempted after edits but its TypeScript compiler timed out with files unchecked. No typecheck/build was run per instruction.
- Electron e2e was not run per instruction.

## Decisions

- The shell's only permitted child-frame scheme is `ptah-artifact:` per its existing CSP and the fixed containment decision. Subframe navigations outside the exact artifact URL are cancelled; top-level navigation keeps its existing policy. Reversible.
- The local error-code union is additive. The tool/RPC handler owned by R2 may need explicit `QUOTA` and `IO_ERROR` mapping; that file was outside this lane's ownership.

## Not done

- No e2e execution or typecheck/build, as requested. The scoped diagnostics service returned unavailable after its timeout.
