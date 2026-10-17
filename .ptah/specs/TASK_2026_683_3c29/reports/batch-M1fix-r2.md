# M1 fix, run 2

## Change

- `apps/ptah-extension-webview/src/styles.css:758-761`: when an active transition has an Electron `.ptah-vt-surface`, set the document root's `view-transition-name` to `none`. The named content surface still transitions; the navbar, rail and git dock remain live for pointer hit testing. VS Code has no named surface and retains the root cross-fade.

## Specificity check

- Searched all `view-transition-name` declarations in `styles.css`. The only other declaration is `html.ptah-vt-active .ptah-vt-surface` at line 754, which targets the content surface. No `html` or `:root` declaration competes with the new rule.

## Verification

- Inspected the edited CSS and all `view-transition-name` declarations. Tests, diagnostics, lint, build and runtime checks were intentionally not run, per the request while another session runs Electron.

## Decisions

- Applied `html.ptah-vt-active:has(.ptah-vt-surface)` to disable the root capture only for Electron. Alternatives were disabling root capture for both hosts or changing the transition animations. The task evidence and implementation plan identify the named Electron surface and the required VS Code root cross-fade. This CSS choice is reversible.
