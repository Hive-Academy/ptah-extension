# Design revision 1

Resolved all 14 findings from `design-spec-review.md`. Final-look captures were regenerated at 1440px, 900px and 480px. The HTML is reproducible with `prototype/build-prototype.js`, which applies `prototype/revise-prototype.js`.

| # | Change made | Where |
| --- | --- | --- |
| 1 | Dock wraps into three rows at 900px and four rows at 720px and below; full-width command field and single-line title remain usable. Added dark and light 480px captures. | `design-spec.md` Layout; `prototype/command-center.html` dock CSS; `prototype/screenshots/*-narrow.png`, `*-480.png` |
| 2 | Stats occupy an opaque reserved stage-header band. The radial projection clamps center, axes and plates to the remaining scene rectangle at every density. | `design-spec.md` Layout and Canvas 2D scene grammar; prototype scene/CSS; 24-node and narrow captures |
| 3 | Current session appears once; recent grid excludes it. Current card now uses available cost, tokens and messages rather than blank space. | Start markup in prototype; `design-spec.md` Layout and parity row 8 |
| 4 | Replaced CC-2048 with an eight-character sample ID; new sessions show `new`. | Header/current card in prototype; `design-spec.md` Layout; `prototype/README.md` |
| 5 | Only API migration carries `Command Center`, as the sample matching recordedSessionId. | Start cards in prototype; `design-spec.md` parity rows 8–9; README |
| 6 | History unavailable is attached only to the Docs audit card. Retry appears only in Start list error preview. | Start cards/error state in prototype; spec Layout and parity rows 9–10; README |
| 7 | Recent cards use only supported Active and livePhase data; no Completed or Idle claim. | Start cards in prototype; spec Layout and parity row 9; README |
| 8 | Removed unsupported Vendor, Owned by, Ordinary Ptah chat session and Voice provider rail prose; rail now uses projection provider, task and phase fields. | Prototype selected-card renderer; `design-spec.md` parity row 20 |
| 9 | Known provider labels come from node fields. Unknown provider uses monogram and raw provider ID without a guessed vendor name. | Prototype lane fallback; spec Icon assignments and Layout; README |
| 10 | Measured composed root/lane plates, Off canvas chip, 9–10px labels and rail metadata in both themes; all text pairs pass 4.5:1. | `prototype/check-revision-contrast.js`; `design-spec.md` Contrast checks |
| 11 | Delegated list now has a bounded internal scroller, visible scrollbar and scroll cue; root-only guidance remains. | Prototype rail CSS; spec Layout and parity row 21; narrow/24-node captures |
| 12 | Identified the Lucide icons that require app icon-provider registration and those already used. | `design-spec.md` Icon assignments |
| 13 | Hid Preview and Demo controls in final-look captures while retaining them in HTML for inspection. | Prototype CSS; README |
| 14 | Applied secondary-focus to light small gold eyebrow labels and measured light Approve text on its fill at 6.15:1. | Prototype CSS; spec Contrast checks and token notes |

The measured dark/light ratios include root plate text 11.98/13.57, lane plate metadata 13.89/14.21, Off canvas chip 13.89/14.21, rail eyebrow 8.32/5.43, and Approve text 8.80/6.15. No production code was edited.
