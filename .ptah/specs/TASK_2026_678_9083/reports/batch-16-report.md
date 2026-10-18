# Batch 16 report

## Requirements

| Requirement | Implementation |
| --- | --- |
| Electron keyboard reachable Command Center tab, selected state, view switch | `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts:145` native button, `:150` selection binding, `:529` switch method |
| Composer ownership banner and Open Command Center action | `libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.ts:152` banner and `:635` view switch |
| Signal driven send hold; draft remains in the textarea and Stop remains available | `chat-input.component.ts:247` placeholder, `:418` send button gate, `:629` lock signal, `:1495` Enter gate, `:1507` send handler gate. The lock does not make the textarea readonly, clear drafts, or alter Stop and pending answer controls. |
| Optional persona in rewind RPC, absent when undefined | `libs/frontend/core/src/lib/services/claude-rpc.service.ts:356` parameter and `:366` conditional property |
| Marked tab persona on both rewind calls | `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:1684` originating tab lookup, `:1686` persona, `:1694` dry run and `:1775` commit |

## Spec cases

| Case | Location |
| --- | --- |
| Native tab and selection binding | `libs/frontend/chat/src/lib/components/templates/electron-shell.command-center-tab.spec.ts:10` |
| Command Center view switch | `electron-shell.command-center-tab.spec.ts:16` |
| Lock signal and send gates | `libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.command-center-lock.spec.ts:11` |
| Ownership link and retained input | `chat-input.command-center-lock.spec.ts:24` |
| Release clears the lock | `chat-input.command-center-lock.spec.ts:34` |
| Unmarked rewind omits systemPrompt key | `libs/frontend/core/src/lib/services/claude-rpc.rewind-persona.spec.ts:18` |
| Persona forwarded on dry run and commit | `claude-rpc.rewind-persona.spec.ts:26` |
| Persona derivation for marked tab | `libs/frontend/chat/src/lib/components/templates/chat-view.rewind-persona.spec.ts:11` |
| Same persona at both rewind call sites | `chat-view.rewind-persona.spec.ts:18` |

The Electron shell, composer, and chat view specs inspect source wiring; the core RPC spec exercises the service wrapper. Runtime component behavior remains for the orchestrator's project suites. The chat view spec checks the unmarked persona function and the marked call-site derivation.

## Verification

- `npx eslint <eight changed files>`: exit 0; two existing file-length warnings in `chat-input.component.ts` and `chat-view.component.ts`, no errors.
- `npx prettier --write <eight changed files>`: exit 0.
- `npx prettier --check <eight changed files>`: exit 0, all matched files formatted.
- `ptah_get_diagnostics` scoped to the eight files: unavailable twice because its TypeScript check was still running after 45 seconds; all eight files unchecked.
- Nx, Jest, TypeScript CLI, and git were not run, per lane rules.

## Degradation audit

No new non-spec catch or `.catch` was introduced. The two edited rewind calls stay within existing handling.

## Needed changes outside the batch

- `libs/frontend/chat/src/lib/components/templates/electron-shell.apps-tab.spec.ts:137` asserts the former six-tab order and will fail with the new Command Center tab. This file is outside the allowed eight-file scope and needs its expected order and count updated by the orchestrator.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Place Command Center after Chat in Electron tabs | After Chat or elsewhere in nav | Direct access from the root chat session; existing nav uses native tab buttons | Yes |
| Keep the textarea editable while held | Readonly or editable with send gate | Queued text must stay visible and sendable after release; both Enter and click are gated | Yes |
| Resolve `AppStateManager` on link activation | Eager or lazy injection | Existing composer specs instantiate the component without a router provider | Yes |
| Pass `undefined` for unmarked rewinds and omit the RPC key | Always include an undefined key or conditionally include the property | Requirement explicitly says no `systemPrompt` key for unmarked sessions | Yes |

## Not done

Runtime component suites and typecheck were not run in this lane. The existing Apps tab spec update requires an out-of-scope edit.

## Correction round

The correction replaces the Electron shell and composer source inspections with rendered TestBed behavior tests. The Apps tab expectations now include Command Center in the seven-tab row. This section supersedes the earlier source-level spec and Apps-tab notes above.

| Spec case | Location |
| --- | --- |
| `renders a native, keyboard reachable tab` | `libs/frontend/chat/src/lib/components/templates/electron-shell.command-center-tab.spec.ts:111` |
| `selects only the Command Center tab when its view is current` | `electron-shell.command-center-tab.spec.ts:119` |
| `requests the Command Center view on click` | `electron-shell.command-center-tab.spec.ts:136` |
| `shows ownership, disables Send, and opens Command Center while held` | `libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.command-center-lock.spec.ts:191` |
| `holds button, direct, and keyboard sends; release sends the same draft once` | `chat-input.command-center-lock.spec.ts:207` |
| `keeps Stop available for a held streaming tab` | `chat-input.command-center-lock.spec.ts:231` |
| `does not show the ownership banner for an unlocked tab` | `chat-input.command-center-lock.spec.ts:241` |
| `orders the tab row Chat, Command Center, Apps, Tasks, Tribunal, Analytics, Setup hub when folders exist` | `libs/frontend/chat/src/lib/components/templates/electron-shell.apps-tab.spec.ts:137` |
| `binds aria-selected and tab-active to currentView() === "apps"` (seven-tab expectation) | `electron-shell.apps-tab.spec.ts:184` |

- Scoped Jest: `Test Suites: 3 passed, 3 total`; `Tests: 12 passed, 12 total`. The first run had one composer harness failure because its draft store stub lacked `save`; the corrected run passed.
- `npx eslint` on the three changed specs: exit 0, zero errors. Nine preexisting non-null assertion warnings remain in the Apps spec; only its pinned count and order expectations were edited.
- `npx prettier --write` and `npx prettier --check` on the three changed specs: exit 0; all files formatted.
- The composer has no pending-answer control or handler; that path cannot be exercised by a ChatInputComponent TestBed spec within this correction's file scope. The held state does not gate the Stop control, which is verified above. No production files were changed in this round.
