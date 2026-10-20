# Task description revision 2

| ID | Severity | Fix | Status |
| --- | --- | --- | --- |
| R1 | Serious | Applied decision #12: bell badge counts only pending Needs you requests; failures and actionable git warnings use snackbar plus dismissible Recent notices; routine info/success stays out of bell. Decision #13 subsequently removes the chip and ticker, moves lane actions to the bell, and suppresses routine back-office progress. | Resolved |
| R2 | Moderate | Restored the event-to-surface matrix with snackbar persistence, OS/host eligibility, bell section, badge count, and sound/announcement; updated back-office rows for decision #13. | Resolved |
| R3 | Minor | Replaced superseded in-scope/out-of-scope lines and removed the old back-office pause, ActionBanner, and git stale parity rows. | Resolved |
| R4 | Minor | Corrected the ActionBanner chat-view path, repaired parity inventory mojibake, and saved both requirement files as UTF-8 without BOM. | Resolved |
| R5 | Minor | Specified that surfaceMode activation focuses its owning surface and request chrome; unresolved targets display a disabled Answer in <surface> row. | Resolved |
| R6 | Minor | Clarified that the failure host-notice setting gates only OS/host notices; failure snackbars and Recent notices rows remain active. | Resolved |

## Additional user decision #13

TASK_2026_702_594d removes the canvas dock, needs-you chip/popover, and back-office ticker. This task makes the bell the sole persistent attention place, including CLI-agent lane permission Allow/Deny/Open and double-answer protection, without editing the dock. The parity inventory marks the chip and ticker as `removed-user-approved`; routine back-office progress has no user-facing output, while back-office failures receive failure snackbars and bell Recent notices rows.
