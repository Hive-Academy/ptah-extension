# Batch D-i Connection Card Report — TASK_2026_523_c3df

Implementation of `ProviderConnectionCardComponent` and its colocated specification for Batch D-i, part 3.

## Files changed

- **CREATED** [`libs/frontend/chat/src/lib/settings/providers/provider-connection-card.component.ts`](file:///D:/projects/ptah-extension/libs/frontend/chat/src/lib/settings/providers/provider-connection-card.component.ts) — Presentational Angular 22 OnPush card projecting vendor mark, provider identity, auth modality, status badge, exact copy, timestamps, actions, and scope provenance strip.
- **CREATED** [`libs/frontend/chat/src/lib/settings/providers/provider-connection-card.component.spec.ts`](file:///D:/projects/ptah-extension/libs/frontend/chat/src/lib/settings/providers/provider-connection-card.component.spec.ts) — 32 unit test cases covering all 10 states of the design spec's state table, confirmed positive probe enforcement, blocked main route invariants, layout non-truncation, accessibility, and scope forwarding.

## Component API

### Selector & Architecture
- Selector: `ptah-provider-connection-card`
- Architecture: Standalone Angular 22 component, `ChangeDetectionStrategy.OnPush`, signal inputs and outputs, pure presentational component with no RPC calls or persistent side-effects.

### Inputs

| Input | Type | Default | Description |
| --- | --- | --- | --- |
| `providerId` | `string` | `''` | Registry/connection id (e.g. `'anthropic'`, `'openai'`, `'claude-cli'`). |
| `providerName` | `string` | `''` | Human-readable provider name (defaults to `providerId`). |
| `authModality` | `string \| null` | `null` | Modality identifier (`'api-key'`, `'cli'`, `'oauth'`, `'local'`, etc.). |
| `authModalityText` | `string \| null` | `null` | Preformatted auth modality label override. |
| `status` | `ProviderConnectionCardStatus` | `'not-configured'` | Connection status (canonical or wire `EffectiveRouteProvider['status']`). |
| `positiveProbeEvidence` | `boolean \| null` | `null` | Required explicit evidence for confirmed success. When `false`, candidate connected states downgrade to `'not-checked'`. |
| `isActive` | `boolean` | `false` | True when this route is selected for the main agent. |
| `isBlocked` | `boolean` | `false` | True when the active route has blockers or failure. |
| `canActivateMain` | `boolean` | `true` | When `false`, hides "Use for main agent" (for CLI-only integrations). |
| `canManage` | `boolean` | `true` | When `true`, renders Manage button for configured connections. |
| `cliName` | `string \| null` | `null` | CLI executable name for not-installed copy (e.g. `'Claude CLI'`). |
| `unauthenticatedVariant` | `'sign-in' \| 'credential-rejected' \| null` | `null` | Overrides unauthenticated badge and action selection. |
| `lastConnectedAt` | `string \| null` | `null` | Timestamp of last successful probe. |
| `lastConnectedText` | `string \| null` | `null` | Human-formatted last connected time (e.g. `"2 hours ago"`). |
| `lastFailedText` | `string \| null` | `null` | Human-formatted last check failure time. |
| `fallbackMark` | `'Bot' \| 'Server' \| 'Terminal' \| null` | `null` | Fallback glyph for `ProviderMarkComponent`. Auto-derived if null. |
| `sourceLabel` | `string \| null` | `null` | Simple source string when `SettingScopeRowComponent` is not used. |
| `scope` | `SettingScopeDisplay \| null` | `null` | Scope for embedding `SettingScopeRowComponent`. |
| `hasOverride` | `boolean` | `false` | Indicates whether the winning scope is an override. |
| `supportedTargets` | `readonly SettingScope[]` | `[]` | Write targets supported for scope overrides. |
| `workspaceName` | `string \| null` | `null` | Current workspace name for scope display. |
| `workspaceCrossApp` | `boolean` | `false` | True if workspace source is cross-app. |

### Outputs

| Output | Type | Trigger / Purpose |
| --- | --- | --- |
| `changeMainProviderRequested` | `void` | User clicked "Change main provider" on active card. |
| `activateMainRequested` | `void` | User clicked "Use for main agent" on connected card. |
| `manageRequested` | `void` | User clicked "Manage" to open drawer details. |
| `addKeyRequested` | `void` | User clicked "Add API key" on needs-key card. |
| `signInRequested` | `void` | User clicked "Sign in" on unauthenticated CLI/OAuth card. |
| `replaceKeyRequested` | `void` | User clicked "Replace key" on unauthenticated API-key card. |
| `retryRequested` | `void` | User clicked "Retry" on unreachable or check-unavailable card. |
| `editConnectionRequested` | `void` | User clicked "Edit connection" on unreachable card. |
| `installInstructionsRequested` | `void` | User clicked "Installation instructions" on not-installed card. |
| `checkAgainRequested` | `void` | User clicked "Check again" on not-installed card. |
| `setupRequested` | `void` | User clicked "Set up" on not-configured card. |
| `checkConnectionRequested` | `void` | User clicked "Check connection" on not-checked card. |
| `scopeOverrideRequested` | `void` | Forwarded from embedded `SettingScopeRowComponent`. |
| `scopeClearRequested` | `void` | Forwarded from embedded `SettingScopeRowComponent`. |
| `scopeUseGlobalRequested` | `void` | Forwarded from embedded `SettingScopeRowComponent`. |
| `scopeCopyGlobalRequested` | `void` | Forwarded from embedded `SettingScopeRowComponent`. |

## State table

| State | Visual treatment | Exact copy rendered | Action buttons | Spec test case |
| --- | --- | --- | --- | --- |
| `active` | `tone="secondary"`, `spine=true`, `CheckCircle`, badge **Active for main agent** | `Used for new main-agent requests.` | `Change main provider` (primary), `Manage` | `row 1 [active]: renders secondary spine, CheckCircle, Active for main agent badge, exact copy, and Change main provider button` |
| `connected` | `tone="neutral"`, `spine=false`, `CheckCircle`, badge **Connected · Available** | `Connected and available to use.` | `Use for main agent`, `Manage` | `row 2 [connected]: renders neutral card, CheckCircle, Connected · Available badge, exact copy, and Use for main agent / Manage buttons` |
| `needs-key` | `tone="warning"`, `spine=true`, `Key`, badge **Needs API key** | `Add an API key to connect {provider}.` | `Add API key`, `Manage` | `row 3 [needs-key]: renders warning spine, Key, Needs API key badge, exact copy, and Add API key button` |
| `unauthenticated` (sign-in) | `tone="error"`, `spine=false`, `LogOut`, badge **Sign-in required** | `Your credential is missing or expired; authenticate again.` | `Sign in`, `Manage` | `row 4a [unauthenticated - sign-in]: renders LogOut, Sign-in required badge, exact copy, and Sign in button for CLI/OAuth` |
| `unauthenticated` (rejected) | `tone="error"`, `spine=false`, `LogOut`, badge **Credential rejected** | `Your credential is missing or expired; authenticate again.` | `Replace key`, `Manage` | `row 4b [unauthenticated - credential rejected]: renders LogOut, Credential rejected badge, exact copy, and Replace key button for API key` |
| `unreachable` | `tone="warning"`, `spine=true`, `AlertTriangle`, badge **Unreachable** | `Could not reach {provider}; check the connection and retry.` | `Retry`, `Edit connection` | `row 5 [unreachable]: renders warning spine, AlertTriangle, Unreachable badge, exact copy, and Retry / Edit connection buttons` |
| `not-installed` | `tone="neutral"`, `spine=false`, `Terminal`, badge **Not installed** | `Install {CLI} to use this connection.` | `Installation instructions`, `Check again` | `row 6 [not-installed]: renders Terminal, Not installed badge, exact copy, and Installation instructions / Check again buttons` |
| `not-configured` | `tone="neutral"`, `spine=false`, `Plus`, badge **Not configured** | `Set up {provider} when you are ready.` | `Set up` | `row 7 [not-configured]: renders neutral card, Plus, Not configured badge, exact copy, and Set up button` |
| `checking` | `tone="neutral"`, `spine=false`, `Loader2` (animate-spin), badge **Checking…** | `Checking {provider}…` | (None while checking) | `row 8 [checking]: renders Loader2 icon, Checking… badge, exact copy, and no interactive buttons` |
| `not-checked` (also `unknown`) | `tone="neutral"`, `spine=false`, `HelpCircle`, badge **Not checked** | `Connection has not been verified.` | `Check connection`, `Manage` | `row 9 [not-checked]: renders HelpCircle, Not checked badge, exact copy, and Check connection button` |
| `check-unavailable` (also `skipped`) | `tone="neutral"`, `spine=false`, `AlertCircle`, badge **Check unavailable** | `Could not check this connection. Retry.` | `Retry`, `Manage` | `row 10 [check-unavailable]: renders AlertCircle, Check unavailable badge, exact copy, and Retry button` |

### Core Safety Rules Pinned by Specs
- **Status resolution and probe evidence rules**:
  - Raw status `'unknown'` maps to `'not-checked'` ("Connection has not been verified.").
  - Raw status `'skipped'` maps to `'check-unavailable'` ("Could not check this connection. Retry.").
  - Raw status `'missing'` maps to `'not-configured'`.
  - Candidate status `'connected'` with `positiveProbeEvidence: false` downgrades to `'not-checked'` (explicit `false` rejects; `null`/unspecified preserves raw connected status).
  - Candidate status `'reachable'` requires explicit positive probe evidence (`positiveProbeEvidence === true`), otherwise downgrading to `'not-checked'`.
- **Blocked main route invariant**:
  - An active route that is blocked or failing displays **Main agent · Needs attention** and its failure badge, with a warning spine. It is NEVER shown with the healthy **Active for main agent** badge.
- **Diagnostic secrecy**:
  - `storedAuthMethodDiagnostic` is never accepted as an input and never rendered.

## Accessibility

- **Control height & target size**: All buttons enforce `min-h-9` (36 px minimum control height) and ≥24 px touch targets.
- **Focus appearance**: Every action button applies `focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content`.
- **Accessible names**: All action buttons provide explicit, disambiguated `aria-label`s including the provider name or CLI name (e.g. `"Use Anthropic for main agent"`, `"Manage Anthropic"`, `"Installation instructions for Claude CLI"`).
- **Non-truncation**: Neither provider name nor auth modality contains CSS `truncate` or `overflow-hidden text-ellipsis`.
- **Decorative visual indicators**: Vendor marks and status icons carry `aria-hidden="true"`; states are fully communicated via high-contrast text badges (`base-content` on `bg-base-100`).
- **Reduced motion**: Animated spinner includes `motion-reduce:animate-none`.

## Verification

All verification commands executed with `NX_DAEMON=false` and `NX_CACHE_DIRECTORY=D:\projects\ptah-extension\.nx\verify-cache`:

### 1. Test Suite (`@ptah-extension/chat`)
```
> nx run @ptah-extension/chat:test --testFile=provider-connection-card.component.spec.ts

PASS chat libs/frontend/chat/src/lib/settings/providers/provider-connection-card.component.spec.ts
  ProviderConnectionCardComponent
    State Table (one spec case per row of design-spec.md)
      √ row 1 [active]: renders secondary spine, CheckCircle, Active for main agent badge, exact copy, and Change main provider button
      √ row 2 [connected]: renders neutral card, CheckCircle, Connected · Available badge, exact copy, and Use for main agent / Manage buttons
      √ row 3 [needs-key]: renders warning spine, Key, Needs API key badge, exact copy, and Add API key button
      √ row 4a [unauthenticated - sign-in]: renders LogOut, Sign-in required badge, exact copy, and Sign in button for CLI/OAuth
      √ row 4b [unauthenticated - credential rejected]: renders LogOut, Credential rejected badge, exact copy, and Replace key button for API key
      √ row 5 [unreachable]: renders warning spine, AlertTriangle, Unreachable badge, exact copy, and Retry / Edit connection buttons
      √ row 6 [not-installed]: renders Terminal, Not installed badge, exact copy, and Installation instructions / Check again buttons
      √ row 7 [not-configured]: renders neutral card, Plus, Not configured badge, exact copy, and Set up button
      √ row 8 [checking]: renders Loader2 icon, Checking… badge, exact copy, and no interactive buttons
      √ row 9 [not-checked]: renders HelpCircle, Not checked badge, exact copy, and Check connection button
      √ row 10 [check-unavailable]: renders AlertCircle, Check unavailable badge, exact copy, and Retry button
    Enforcement rule: A status that is not confirmed success is NEVER shown as Connected
      √ maps "unknown" directly to Not checked (Connection has not been verified.), NEVER Connected
      √ maps "skipped" directly to Check unavailable (Could not check this connection. Retry.), NEVER Connected
      √ maps "missing" directly to Not configured, NEVER Connected
      √ downgrades status "connected" to "Not checked" if positiveProbeEvidence is explicitly false
      √ downgrades candidate "active" to "Not checked" if positiveProbeEvidence is explicitly false
      √ downgrades status "reachable" to "Not checked" when positive probe evidence is absent
      √ promotes status "reachable" to "Connected · Available" only when positive probe evidence is explicitly confirmed
    Main Agent Blocked State Invariant
      √ displays "Main agent · Needs attention" and failure badge when active route is blocked/unreachable
      √ displays "Main agent · Needs attention" when isBlocked flag is explicitly set
    Identity, Auth Modality and Layout Non-truncation
      √ renders provider name and explicit auth modality label without truncation classes
      √ formats recognized auth modalities accurately
      √ renders preformatted authModalityText verbatim when supplied
      √ suppresses "Use for main agent" when canActivateMain is false (CLI-only integration)
    Timestamps and Diagnostics
      √ renders prior success "Last connected {time}" alongside failure status
      √ renders last failed check timestamp when supplied
    Scope Row Embedding and Provenance
      √ embeds SettingScopeRowComponent when scope input is provided
      √ forwards scope actions to component outputs
      √ renders simple source-strip when sourceLabel is supplied without scope
    Accessibility Requirements
      √ enforces min-h-9 (36 px) and 2 px focus outline classes on every action button
      √ includes provider name in all action button aria-labels
      √ includes CLI name in not-installed button aria-labels

Test Suites: 1 passed, 1 total
Tests:       32 passed, 32 total
Snapshots:   0 total
Time:        6.158 s
```

### 2. Typecheck (`@ptah-extension/chat`)
```
> nx run @ptah-extension/chat:typecheck
> npx ngc --noEmit --project libs/frontend/chat/tsconfig.lib.json

NX Successfully ran target typecheck for project @ptah-extension/chat
Run duration: 32.7s
```

### 3. Lint (`@ptah-extension/chat`)
```
> nx run @ptah-extension/chat:lint
NX Successfully ran target lint for project @ptah-extension/chat
0 errors, 0 warnings in newly created files.
```

## Deviations

None. The implementation adheres strictly to `design-spec.md` and `implementation-plan.md`.

## Not done

- Not mounted into `SettingsComponent` or `ProvidersSettingsComponent` (as intended per Batch D-i assignment; card is presentational and will be composed in subsequent integration phases).
- No `index.ts` barrel file created or modified (orchestrator writes the barrel after all batch components exist).

## Clarifications Needed

None. All requirements, state table mappings, and accessibility tokens were fully specified and satisfied.
