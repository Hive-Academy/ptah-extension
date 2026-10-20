# Batch A1 report

| Requirement | Result | File:line | Test |
| --- | --- | --- | --- |
| Header branding, session, voice, context, settings and theme | Added standalone OnPush header with signal inputs and narrow outputs | `libs/frontend/command-center/src/lib/components/command-center-header.component.ts:42` | `command-center-header.component.spec.ts:7` |
| Mic recovery and context threshold | Recovery link emits settings; warning starts at 70% | `libs/frontend/command-center/src/lib/components/command-center-header.component.ts:21` | `command-center-header.component.spec.ts:24` |
| Start hero, current card and recent grid | Responsive layout; current excluded from recent; real figures, provider marks, live state and restore controls retained | `libs/frontend/command-center/src/lib/components/command-center-start.component.ts:29` | `command-center-start.component.spec.ts:32` |
| Remove age bars | Removed function and six decorative bars; kept valid relative time | `libs/frontend/command-center/src/lib/components/command-center-start.component.ts:151` | `command-center-start.component.spec.ts:84` |
| Reserved stats cells | Four Lucide cells show only known values, preserving provisional and known subtotal copy | `libs/frontend/command-center/src/lib/components/command-session-stats.component.ts:24` | `command-session-stats.component.spec.ts:15` |

## Checks

| Check | Result |
| --- | --- |
| `nx typecheck command-center` | Passed |
| `nx lint command-center` | Passed; 0 errors, 0 warnings |
| `nx test command-center` | Passed; 47 suites, 534 tests |
| `jest no-alpha-base-content.spec.ts` | Passed; 11 tests |

## Header inputs

| Input/output | A2b page binding |
| --- | --- |
| `sessionId` | `page.store.sessionId()` |
| `sessionStatus` | `page.shownSessionStatus()` |
| `voiceProviderText` | `voiceChipText()` |
| `voiceAriaStatus` | `voiceChipAriaLabel()` |
| `voiceReady` | `voiceChipReady()` |
| `contextLabel` | `contextCue().known ? contextCue().label : 'unknown'` |
| `contextPercent` | `contextCue().percent` |
| `showContext` | `!!page.store.markedTabId()` |
| `darkMode` | Current theme dark state from page/controller theme service |
| `micError` | `page.store.voiceError()?.kind === 'mic-denied'` |
| `voiceSettings` output | `page.openVoiceSettings()` |
| `themeToggle` output | Page controller theme toggle |

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Keep existing start action wording | Existing text / prototype wording | Gate 2 N1 requires asserted strings; existing specs pass | Yes |
| Keep unknown current-session values hidden when no figures exist | Show placeholders / hide figures | Existing data contract and current spec | Yes |
| Keep header unmounted until A2b | Edit page / leave page for A2b | Batch A1 file ownership | Yes |

## Conflicts

None found with N1 asserted text contracts. Existing `7 messages` and `~12.3k tokens` copy is unchanged.

