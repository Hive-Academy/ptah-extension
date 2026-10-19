# Command Center Voice prototype

Open `command-center.html` in a browser. The theme button switches dark and light. Preview state and Demo are prototype-only controls: they remain usable in the HTML and are hidden in final-look screenshots. Preview includes Start view, Start list error, Idle, Speaking, Failed + approval, Pending question, Tribunal confirm and 24 nodes. Start list error alone shows `Retry session list`.

The sample session pill uses an eight-character ID (`a4e91c20`) and switches to `new` for a new session. The current card appears once; recent cards exclude it. Only the sample API migration card matches `recordedSessionId` and carries `Command Center`. `History unavailable` belongs only to the Docs audit card with `hasTranscript === false`. Recent cards show `Active` and the literal `livePhase` wording (generating, awaiting background, sleeping, idle, failed) only when their summary provides `isActive` and `livePhase`; absence of either field produces no substitute status. The current card cost comes from currentStats().totalCost or its known subtotal; tokens and provider values are sample values shaped like available app fields. Recent cards have no age bars. Known lane labels come from the node provider field. Unknown provider IDs display a monogram plus the raw ID, with no guessed vendor label. The child-session preview uses projected fields: a live child with `tabId` and its owned lane, and a persisted child with no `tabId`, name or provider. Its selected card reports tab availability but has no tab-opening action, matching current Command Center controls. The child-owned orbit and nested rail are proposed presentation of existing parentSessionId ownership. The prototype does not connect to Ptah services.

## Screenshots

Captures use a 900px viewport height and full-page output. Wide captures are 1440px, narrow captures 900px and compact captures 480px.

| State | Dark | Light |
| --- | --- | --- |
| Start view | `screenshots/dark-start.png` | `screenshots/light-start.png` |
| Idle | `screenshots/dark-idle.png` | `screenshots/light-idle.png` |
| Speaking | `screenshots/dark-speaking.png` | `screenshots/light-speaking.png` |
| Failed lane + tool approval | `screenshots/dark-approval.png` | `screenshots/light-approval.png` |
| Pending question | `screenshots/dark-question.png` | `screenshots/light-question.png` |
| 24 nodes | `screenshots/dark-24-nodes.png` | `screenshots/light-24-nodes.png` |
| Child session owning a lane, plus persisted unknown child | `screenshots/dark-child-session.png` | `screenshots/light-child-session.png` |
| 900px approval | `screenshots/dark-narrow.png` | `screenshots/light-narrow.png` |
| 480px approval | `screenshots/dark-480.png` | `screenshots/light-480.png` |
| Tribunal confirm | `screenshots/dark-tribunal-confirm.png` | — |

`command-center.html` is the revision 2 prototype source. Run `node capture-screenshots.js` to refresh the captures; it waits for fonts and checks rendered font signatures and viewport-group image dimensions across all 19 PNGs. Run `node check-revision-contrast.js` for the composed plate, rail and Approve contrast pairs. The design spec maps all 39 parity items and defines the 72px wide stage header, stretched rail, one-source context cue and responsive dock. `build-prototype.js` still regenerates the older base and would overwrite this revision; do not use it to refresh these captures.
