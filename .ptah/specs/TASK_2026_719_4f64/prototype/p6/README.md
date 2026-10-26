# P6 prototype (TASK_2026_719_4f64, D52), revision 1

Open `index.html` (add `?theme=light` for ptah-glass-light). The LIVE frames at the bottom are interactive; all other frames are static fixtures for screenshots in `shots/`.
`?solo=<key>` renders one frame at the full viewport width (used for real-viewport captures).

Commands (no build): `node capture.mjs [--ids=M4a,A12]`, `node capture.mjs --solo`, `node contrast.mjs`, `node smoke.mjs`.

Spec: `../../design-spec-p6.md`. Cross-reference: `../../parity-inventory-p6.md`.

## Lane-introduced constraints

- [lane-proposed] Lane Account control is a `menu` of `menuitemradio` (arrows move focus, Enter/Space/click saves) instead of native radios.
- [lane-proposed] Named accounts that are not signed in appear as disabled "(sign in first)" options in the main select; a removed selection is derived (absent id) and shown as "Removed account".
- [lane-proposed] Main popover Save writes provider first, then account; a failed account write is a partial success with one alert toast.
- [lane-proposed] Detail panel is flat; Manage chevron on every named row; Add opens the new account's detail under B-2.
- [lane-proposed] Stale/loading/host-unavailable sentences are replaced by `Out of date`, `Loading…`, a disabled Add and toasts.

Project rules kept: [project-rule] D42 B-1 and B-2 (decisions.md); [project-rule] D52 low-noise direction.
