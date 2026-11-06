# Batch 9 implementation report

## Components added

- `cli-capability-cells.component.ts`: compact live manifest summary for each system CLI row.
- `cli-capability-detail.component.ts`: expanded one-line-per-capability list with unsupported reasons.
- `cli-capability-view.ts`: pure manifest projection, covered by `cli-capability-view.spec.ts`.

## Mapper rules (manifest ? copy)

- Missing manifest ? “Capabilities: Unverified” and an explicit explanation in detail.
- Messaging steer, interrupt, continuation, resume; permission plan, ask, auto-edit, yolo; network allow, deny; MCP; limit reader; and role delivery are read from the manifest. Missing permission declarations show Unverified. Unsupported capabilities show the adapter's reason, with a fallback if omitted. The limit reader shows Tracked or No reliable source and its source/reason.
- System Status labels are Installed, Not installed, or Disabled; Cursor without a key remains actionable through its existing credential action and reads Not installed in Status.

## Matrix mount and preserved features

- `cli-matrix-rows.ts` forwards `detected.manifest` without changing the core state service, which already retains `agent:detectClis` rows.
- The matrix mounts summary and an accessible button/detail row; the button uses `aria-expanded` and `aria-controls`, and a Lucide chevron. Claude's account cell remains directly under the name.
- Existing enable checkbox and save path, install guide and re-detect, model/effort popovers, permission controls, provider and version display, credential action, test, add/edit/delete instance actions, ordering, uninstalled disclosure, and narrow status layout remain mounted.

## Verification

- Opened the supplied `prototype/lane-control.html` in the Ptah browser and captured `batch9-prototype.png` for reference. Compared the compact row summary, install-only Status, and expanded capability detail structure with the reference. The actual Angular view was not rendered because this lane is prohibited from running serve/dev/build/e2e targets; dark/light Electron visual review remains unmet.
- `npm run verify -- -p @ptah-extension/chat,@ptah-extension/core -- --output-style=static`: confirmed two named projects. Failed before lint/typecheck and test execution because Nx ESLint and Jest plugin workers exited while building the project graph (exit 1).
- Focused Jest through the requested verify slot: 3 suites passed, 106 tests passed, exit 0. Jest reported a worker forced exit after completion.
- `ptah_get_diagnostics` was called after edits and retried; TypeScript checks remained unavailable after each 45-second timeout, with edited files unchecked.

## Decisions

- Reused the existing settings service detection data and system enable checkbox. Evidence: `ProvidersSettingsStateService` copies the typed `agent:detectClis` result into orchestration state, and the matrix already persists `disabledClis`. Reversible.
- Mounted capability details as a per-row disclosure in the existing matrix. Evidence: the plan calls for an expandable row and the current matrix already owns row state and actions. Reversible.
- Kept the compact summary in the Agent cell to preserve the matrix's existing controls and narrow layout. Evidence: the current table has eight tightly used columns. Reversible.

## Limitations

- Skill-loading tool was unavailable; read the requested `angular-frontend-patterns` and `frontend-design` files directly.
- Typecheck/lint and rendered Electron visual review remain unverified due the failures and lane restrictions above.
- No git command was run.

## Design revision 1

- Summary now renders five labelled DaisyUI badges from the live manifest. Supported and tracked badges use neutral outlines; unsupported and no-source badges use muted outlines with a CircleSlash icon; unverified badges use a warning tint and CircleHelp icon. Badge text uses `text-base-content` in all states.
- Expanded detail is a grouped definition list (Messaging, Permissions, Network, Integration) with Check, Minus, or CircleHelp state icons and secondary reasons beneath each value. The mapper preserves unsupported reasons and now supplies display groups and badge state.
- Human copy maps continuation to “Continue session”, resume to “Resume saved session”, role channels to readable labels (including Preamble through the copy helper), and known limit source ids to provider names. Unknown source ids remain visible.
- Added the design deck legend beneath the matrix header: “These are CLI capabilities. A running lane may offer fewer actions.”
- Wrote `prototype/cli-capability-preview.html` with Codex, OpenCode, and a no-manifest adapter; opened it through `ptah_browser_navigate` and captured `batch9-revision-light.png` and `batch9-revision-dark.png` through `ptah_browser_screenshot`. Checked grouping, icon meanings, wrapping, and text readability in both themes. Canvas sampling of rendered badge text/background colors gave minimum contrast of 10.74:1 in dark and 16.19:1 in light, above the 4.5:1 target for the preview. The preview is a static illustration of the Angular markup; it is not a running Electron screen.
- Focused Jest passed 3 suites and 110 tests before the final Preamble copy test. `npm run verify -- -t typecheck,lint -p @ptah-extension/chat` passed 2/2 tasks (exit 0) before that small copy helper. `ptah_get_diagnostics` remained unavailable after its 45-second timeout.
- The final focused Jest rerun was queued behind other lanes' memory reservations; its final result follows below when available.
- Final focused Jest rerun after the Preamble helper: 3 suites, 111 tests passed, exit 0. Jest reported a worker forced exit after test completion.
