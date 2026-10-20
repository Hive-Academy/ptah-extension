# Task description scope change 2

| Section | Change |
| --- | --- |
| Classification and scope | Replace Lightfall and GPU fallback with a locally ported Aurora CSS gradient background for the empty board in both themes. |
| Acceptance criteria 4?5 | Require theme-token tinting, text contrast of at least 4.5:1, a static gradient under reduced motion, and paused CSS animation while the board is hidden. Remove renderer fallback and GPU lifecycle criteria. |
| Acceptance criteria 10?11 | Treat Aurora as decorative; require a local CSS-only port with no new npm dependency and an Omnedia MIT `aurora-notices.txt` shipped through the existing host asset and Electron resource wiring. |
| Constraints, research, risks, decisions | Replace Lightfall and renderer references with Aurora source findings, CSS motion checks, and user decision #12 superseding #6. |
| Parity inventory | No edit: it contains no Lightfall requirement or reference. |
