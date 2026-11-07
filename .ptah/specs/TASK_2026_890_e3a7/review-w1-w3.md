# Review — new PtahCode docs pages (W1 and W3)
Verdict: REVISE
Reviewer family: codex

## Defects
| # | Severity (Blocking/Serious/Minor) | Page file:line | Claim | Problem | Code evidence (path:line) | Fix |
|---|---|---|---|---|---|---|
| 1 | Serious | `apps/ptah-docs/src/content/docs/canvas/session-inspector.md:42` | “click **Show per-model breakdown**” | The visible button is **Models**. “Show per-model breakdown” is its `title` tooltip, so the named control is not visible until hover. | `libs/frontend/chat-ui/src/lib/molecules/session/inspector-stats/inspector-session-stats.component.ts:263-279` | Say “click **Models**” and optionally mention the tooltip. |

## Checked claims

The counts below use one writer evidence row as one claim group; each group can contain several labels or behaviors. “Confirmed” excludes the defect above.

| Page | Checked | Confirmed |
|---|---:|---:|
| `canvas/session-inspector.md` | 37 | 36 |
| `chat/display-panel.md` | 18 | 18 |
| `chat/composer-and-turn-summary.md` | 25 | 25 |
| `workspace/notifications-and-tray.md` | 21 | 21 |
| `reviews/index.md` | 37 | 37 |
| `git/branches-and-review-tools.md` | 34 | 34 |
| `mcp-and-skills/apps.md` | 17 | 17 |
| `automation/messaging/send-a-session.md` | 12 | 12 |
| `workspace/remote-machines.md` | 6 | 6 |
| **Total** | **207** | **206** |

## Notes

- Inspected Electron route and shell entries for Apps and Reviews (`apps/ptah-extension-webview/src/app/app.routes.ts:153-184`; `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts:264-298`). The remote machine startup path is in `apps/ptah-electron/src/activation/wire-runtime.ts:345-371`; its SSH command and default port are in `libs/backend/remote-machines/src/lib/ssh-stdio-transport.ts:5-29`.
- Checked the five added index cross-links in `git diff`. `node .ptah/specs/TASK_2026_889_d57a/_linkcheck.mjs` reported zero bad internal links, frontmatter issues, or component import issues. The page links and anchors pass that check.
- Reviewed the host wording rule. “GitHub CLI” on the Git page names a dependency, and “CLI agents” in a related link names an agent type; neither presents CLI as a PtahCode host. No prohibited host, roadmap, price, version, or date claim was found in the reviewed pages.
- No build or test target was run, as required by the review brief.
- No documentation-review skill was exposed through this lane's skill mechanism; I used the review brief and source directly.
