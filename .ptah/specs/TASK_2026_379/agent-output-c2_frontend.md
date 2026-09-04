# Agent output — C2 frontend

Batch C2 is complete and accepted.

- Implemented connector-specific setup-step rendering with redirect URL substitution and null fallback wording.
- Cleared or replaced setup guidance when another connector is clicked and when the custom form closes.
- Added OAuth scope forwarding and setup-effort card hints.
- Updated connector documentation without introducing disallowed marketplace-scanner terms outside the existing permitted phrase.
- Added regression coverage for ordering, substitution, fallback, replacement, clearing, scope forwarding, and the no-steps browser-sign-in path.

Verification:

- `npx nx run-many -t typecheck lint test -p @ptah-extension/marketplace` — passed; 11 suites and 233 tests.
- `npx nx build ptah-docs` — passed; 157 pages built and 33 screenshot references resolved.
- Strict case-insensitive forbidden-word scan — zero disallowed matches.

Full evidence: `D:\projects\ptah-extension\.ptah\specs\TASK_2026_379\batch-report-C2.md`.
