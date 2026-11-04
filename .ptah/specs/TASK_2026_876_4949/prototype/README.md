# Prototype — TASK_2026_876_4949

## How to Open

Open `index.html` directly in any web browser:

```bash
file:///D:/projects/ptah-extension/.claude-worktrees/handoff-linked-sessions/.ptah/specs/TASK_2026_876_4949/prototype/index.html
```

Query flags (also on the controls): `?theme=anubis` or `?theme=anubis-light`, `?state=populated|predecessor|long|label|absent|missing|loading|error`, `?width=sidebar`, `?sheet=1`.

Automated capture can use the same file URL. A local server is only needed if the browser tool rejects `file://`.

## Deviations

- Local styling: the `<style>` block in `index.html`. It copies Anubis and anubis-light values from `apps/ptah-extension-webview/tailwind.config.js` and `apps/ptah-extension-webview/src/styles.css`. A Tailwind build was not run: the task forbids builds, and production CSS purges classes this file introduces.
- CDN fallback: Tailwind and DaisyUI 4 CDN links are included because the task allows them. The painted UI does not depend on them. Offline viewing uses the local style block.
- Product loading and error chrome is intentionally absent. Those two control-panel states show the same empty inspector as “No chain”, plus a caption in the prototype toolbar.
- The canvas rail and the previous-sessions list are not in this prototype. The scope change keeps them unchanged.
- Capture limitations: none for the file URL. Screenshots in `screenshots/` are exactly `dark-chain-of-three.png`, `light-chain-of-three.png`, `dark-long-chain.png`, `dark-absent.png`, `dark-missing-record.png`, and `dark-narrow-sheet.png`.

## Screens and states

- Expanded inspector, docked and sheet, one shared body: Linked sessions.
- Compact 56px inspector rail, docked only: unchanged, no list. Hidden in the sheet frame, matching the product (sheet replaces the rail presentation).
- Chain of three, root first, current marked.
- One predecessor.
- Long chain (6), scroll inside the section, current row in view.
- Long labels, truncated, full string on `title`.
- No chain (section absent).
- Missing record: untitled id renders as `Session 9f3c2a10` in muted text and stays a button.
- Loading and error: section absent.
- Themes: `anubis` (dark), `anubis-light`.
- Widths: wide stage, embedded 400px column (`.viewport-sidebar`), and a 400px browser viewport for the sheet shot.

## Interactive features

- Theme toggle.
- Embedded-width toggle (does not fire viewport media queries).
- State dropdown.
- Sheet frame toggle (same body, `role="dialog"` `aria-modal="true"`).
- Each linked-session button sets the current mark and announces an open. The current button announces the session that is already open.

## Project rules applied

- `[project-rule]` Status is not a button. “This session”, “Continued from”, and “Continued in” are text in the row. Source: `ui-ux-designer/SKILL.md`, Prototyping Rules.
- `[project-rule]` One control per row. The row itself opens the session. Source: `ui-ux-designer/SKILL.md`, Prototyping Rules.
- `[project-rule]` Reuse Anubis tokens, `text-base-content-muted`, and `outline-base-content`. Source: `design-spec.md`, Reused tokens.

## Lane-introduced constraints

| Constraint | Tag | Rationale |
| --- | --- | --- |
| Heading omits CSS `uppercase` so the words stay “Linked sessions” | `[lane-proposed]` | Agents renders all-caps; the section name is title case. Pending Gate 1.7. |
| List viewport caps at 10.5rem and scrolls | `[lane-proposed]` | Shows every session without a Show more control. Pending Gate 1.7. |

## Parity mapping

No `parity-inventory.md` in this task folder. Retained behavior from the binding scope change in `context.md` and from surface A:

| Capability | Prototype location | Treatment |
| --- | --- | --- |
| Full chain on every session | Inspector list | Root first, current marked |
| Open another session | Linked row button | Announces open |
| Section absent with no chain | State “No chain” | Heading not rendered |
| Compact rail unchanged | 56px strip, docked | Metrics only, no list |
| Missing session name | State “Missing record” | `Session 9f3c2a10`, muted, still a button |
| Canvas rail and sessions list | Not drawn | Unchanged by this task |
