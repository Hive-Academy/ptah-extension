# A0 source follow-up

Coordinator-retained researcher findings; source evidence only. No runtime observation, app launch, checks, Git operations, production or settings edits.

## Assumption 4 — partial source PASS; visible/show timing UNAVAILABLE

BrowserWindow construction precedes heavy-body gate opening:
- apps/ptah-electron/src/main.ts:177-180,310-339 constructs the window, registers post-window services, then invokes wired.postWindow.
- apps/ptah-electron/src/activation/post-window.ts:86-99 obtains or constructs the window and starts loadFile.
- apps/ptah-electron/src/activation/wire-runtime.ts:382,495-504,519-532 creates/reserves the booter and opens its gate after registerPostWindow.
- apps/ptah-electron/src/activation/boot-heavy-services.ts:135-138,454-466 defers heavy execution until the gate opens.

No explicit initial show was established on this path. bootstrap.ts:316-322 is attention reveal, not initial display. Do not equate constructed with visibly rendered.

## Assumption 5 — source PASS; runtime unobserved

Workspace-specific inputs reach origin filtering:
- libs/backend/harness-sync/src/lib/reconciler.service.ts:170-176,386-391 resolves cwd to workspaceRoot and passes resolved source to builder.
- libs/backend/harness-sync/src/lib/sources/plugin-config-source-resolver.ts:205-206,242-259 forwards workspaceRoot to effective plugin config; successful reads alone establish known overlay state. Resolver path should be confirmed before future edits.
- apps/ptah-electron/src/activation/phase-2-libraries.ts:234-258 forwards the same root to PluginLoaderService.
- plugin-loader.service.ts:1114-1145 reads workspace layer and workspace-specific overlayPathsFor.
- harness-manifest.builder.ts:348-361 passes source to createPluginOriginGate and applies it to clones.
- plugin-origin-gate.ts:123-145 filters disabled/known overlays; unknown-overlay fail-open remains intentional existing behavior.

## Assumption 6 — FAIL: generic managed .ptah root coverage absent

- reconciler.service.ts:535-552 updates ignore rules only in full mode using detected target managedDirs.
- claude-target.ts:479-481 supplies skills/commands; workspace-target.ts:312-321 supplies skills/commands/agents, not .ptah.
- gitignore-writer.ts:104-214 writes supplied directories only.
- Repository .gitignore:258-262 managed block lists .github/skills/ only.
- Repository-specific .gitignore:135-139 excludes .ptah/** and re-includes .ptah/specs/**. This is not generic harness maintenance for arbitrary user workspaces.

Phase D workspace-root writing must account for this gap before installation is accepted. No fix or new scope decision is implemented by this report.

## Existing targeted test seams (not run)

- wire-runtime.boot-order.spec.ts:95-107 — source order.
- boot-order.spec.ts:168-185 — explicit boot gate.
- harness-reconciler.gitignore.spec.ts:128-145 — copied-directory ignore fixture.
- plugin-config-source-resolver.spec.ts:94-104 — workspace-root forwarding.

## Remaining gate

Assumptions 1–3 still require controlled SDK runtime transcripts. Electron before dark/light screenshots remain unavailable. Batch 1 is not accepted; no dependent implementation may begin.
