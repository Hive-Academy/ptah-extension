# Bell panel style changes

Source: `libs/frontend/notification-center/src/lib/notification-center.component.ts`.

| Line | Before | After |
| --- | --- | --- |
| 66 | `text-xs font-semibold` on “Needs you” | `text-xs font-semibold uppercase tracking-wide text-base-content-muted` |
| 67 | Count: `text-xs text-base-content-muted` | `ml-auto text-xs text-base-content-muted` |
| 70 | Needs you row: `border-warning` | `border-base-300`, matching the Recent row at line 104 |
| 100 | Recent heading: `flex-1 text-xs font-semibold` | `text-xs font-semibold uppercase tracking-wide text-base-content-muted` |
| 101 | No Recent count | `ml-auto text-xs text-base-content-muted` with `store.recentNotices().length` |

Matched `prototype/notifications.html` CSS: `.grouphead{display:flex;justify-content:space-between;align-items:center}`, `.grouphead h3{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}`, `.row{border:1px solid var(--line)}`, and `.row .glyph{color:var(--need)}`. Its markup includes a count beside both section labels. The existing `text-state-need` icon, focus-visible outline, `notification-row` hover behavior, heading IDs, `aria-labelledby`, and mixed-case text content remain.

## Decisions

| Decision | Options and evidence | Reversible |
| --- | --- | --- |
| Show a Recent count as well | The prototype renders counts for both sections, while the component had only a Needs you count; the request names both headers and right-aligned counts. | Yes |
| Leave the spec unchanged | `notification-center.component.spec.ts` asserts section text and Needs you count, but no changed CSS classes. The request permits spec edits only where it asserts changed classes. | Yes |

## Verification

`ptah_get_diagnostics` reported no diagnostics in the edited component. It reported five existing BigInt target errors in shared sibling files (`capability-id-codec.ts` and `attention-identity.ts`). No Nx, Jest, tsc, lint, or build command was run, as requested.
