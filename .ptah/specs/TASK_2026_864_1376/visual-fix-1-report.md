# Visual review fixes 3 and 4

## Files changed (file:line)

- `libs/frontend/chat/src/lib/settings/providers/connection-drawer/codex-sign-in-block.component.ts:14,117`
- `libs/frontend/chat/src/lib/settings/providers/connection-drawer/codex-sign-in-block.component.spec.ts:19,53,60`
- `libs/frontend/chat/src/lib/settings/providers/connection-drawer/credentials-tab.component.ts:192`
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.html:157`
- `libs/frontend/onboarding/src/lib/ready/provider-panel.component.ts:246`
- `.ptah/specs/TASK_2026_864_1376/visual-fix-1-report.md:1`

## Finding 3

Renamed the sign-in block input from `role` to `connectionRole`, retaining its type and `chosen` default. Updated its template reads, all three call sites, and its spec harness. The inner alert/status `[attr.role]` remains intact. The new spec checks that the component host has no `role` attribute while the inner failure region has `role="alert"`.

## Finding 4

The bordered container now renders only when the phase has content, the panel layout is shown, or a copy message exists. Compact `ready` renders no container. The new spec checks for the absence of the bordered container in that state.

## Tests

No test, build, app, or browser command was run, as instructed. Ptah AST inspection parsed the changed component and spec without errors. Scoped Ptah diagnostics found no errors in the four changed TypeScript files; it also reported 330 errors in sibling files. The HTML template was outside that diagnostic coverage. Visual rendering was not checked because this task prohibits launching application and browser targets.

## Decisions

- Retained `ProviderPanelComponent.role` because it describes the panel's separate `main`/`information` contract; only its child binding changed. Evidence: the panel's existing template and spec use that contract. Reversible: yes.
- Included `copyMessage()` in the container guard so an existing copy result can remain visible if layout or phase changes. Evidence: the component renders copy feedback inside that container. Reversible: yes.
