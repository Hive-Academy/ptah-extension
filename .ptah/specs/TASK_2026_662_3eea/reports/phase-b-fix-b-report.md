# Phase B fix lane B

## Changed files

- `libs/shared/src/lib/types/rpc/rpc-auth.types.ts:526`: registered the three new enhancement settings as global-only scope keys while retaining the old entries.
- `libs/frontend/core/src/lib/services/providers-settings-state.service.spec.ts:1381`: added a regression spec for requested enhancement keys, global scope entries, writable targets, and a non-mixed provider/model group.
- `libs/frontend/thoth-shell/src/lib/components/thoth-shell.component.ts:222`: made the tab panel wrapper full width with small side padding.
- `libs/frontend/thoth-shell/src/lib/components/thoth-shell.component.spec.ts:290`: asserted the panel wrapper has no `max-w-` class.

## Specs added

- Core: `requests global provenance for every enhancement setting` verifies all three keys are requested and resolve to global-only entries; the provider/model scope group resolves to `global`, so the Enhancement row does not show mixed provenance.
- Thoth shell: an assertion in the existing render spec checks that the panel wrapper has no width cap.
- Per task instruction, no Nx, Jest, lint, typecheck, build, or e2e commands were run. Scoped `ptah_get_diagnostics` reported no diagnostics in the four edited files; it reported 100 errors in sibling files outside this lane's scope. Edited files have LF line endings.

## Projects touched

- `@ptah-extension/shared`
- `@ptah-extension/core`
- `@ptah-extension/thoth-shell`

## Batch 65 note

Keep `skills.enhancement.provider`, `skills.enhancement.model`, and `skills.enhancement.timeoutMs` in `SCOPED_SETTING_KEYS` when removing the old `skillSynthesis` entries.

## Decisions

- Registered the new keys beside the old keys. Options: replace old entries now, or retain both until batch 65. Evidence: review S3 and batch 65 ownership; retaining both preserves old consumers. Reversible: yes.
- Tested Enhancement row provenance through the core store's provider/model scope group. Options: import the chat row builder into core tests, or verify the store's scope lookup. Evidence: `makeRow` uses `scopeEntry` for both keys and labels missing entries as mixed; importing chat into core would reverse the dependency. Reversible: yes.
