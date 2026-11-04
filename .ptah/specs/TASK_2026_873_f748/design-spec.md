# Review runs — Electron design specification

## Purpose

Give local operators a safe view of repository eligibility, review progress, publication, and findings. Identify each attempt by repository, PR number, effective head SHA, and attempt ID. Retain history after reruns and pushes.

## Placement and navigation

- Add **Review runs** as a sibling Electron destination to **Schedules**. Add a `btn btn-ghost btn-sm` link in the existing Schedules header. Preserve Schedules behavior. Pass repository context when available; otherwise open All repositories. Discovery scope is independent of the current workspace (FR-1).
- Match the Schedules header: `surface-1 rounded-xl p-5`, 40px icon tile on `bg-surface-2`, `text-xl font-semibold` title, `text-sm text-base-content-muted` description, right-aligned controls.
- At 900px and wider, show a 280px repository rail and flexible runs region. Below 900px, stack them. Use the existing `NativeDrawerComponent` pattern, `w-full max-w-xl`, for detail.

## Information architecture

1. Header: title, last refresh, refresh, global publication kill switch.
2. Repositories: configured scope, trust/allowlist, effective mode, last poll and config validity.
3. Runs: queue count, repository/state filters, newest attempts first.
4. Detail: identity, actions, five stages, coverage notices, findings, publication and latency timestamps.
5. Region-level empty/loading/error treatments retain the rest of the shell. GitHub outage retains cached history.
6. Settings drawer: identity, trust, runtime/budget, repo config status. Open from the repository rail or a stage's Review lane settings action; return focus to opener.

## Components

### Entry link

Purpose: bridge from Schedules and Electron navigation. Anatomy: label and ArrowUpRight icon. Classes: `btn btn-ghost btn-sm`, `focus-visible:outline`. State: Electron only, `aria-current="page"` on active route. Data: destination and optional repo ID (FR-1, FR-16).

### Header and safety bar

Purpose: show freshness and global safety. Anatomy: title, last refresh, Refresh, labelled global kill switch. Classes: `surface-1 rounded-xl p-5`, `btn btn-ghost btn-sm`, `toggle toggle-warning`. States: loading disables refresh; On says **Publication paused globally**; Off says **Publication allowed by global setting**. Keep the local kill switch usable during GitHub outage. Data: `globalKillSwitch`, `lastRefreshedAt` (FR-3, FR-13, FR-16).

### Repositories panel

Purpose: make scope and effective posting state clear. Anatomy: repo name, allowlisted authors/policy, forks excluded, live/dry-run/paused badge, last poll result/time, repo dry-run and repo kill switch. Classes: `surface-1 rounded-xl p-4`, `badge badge-outline`, `toggle toggle-sm`, `text-base-content-muted`. States: success, failed/never polled, invalid config with exact key, untrusted/disabled. Global kill switch overrides displayed effective mode. Data: repo ID/name, trust summary, publication mode, repo kill switch, dry-run, poll fields, config error (FR-1, FR-3, FR-13, AC-13.3/4).

### Review settings drawer

Purpose: configure one local review operator without losing run context. Use a wide drawer (`w-full max-w-2xl`) because the repo rail already owns selection and the cron UI establishes drawer behavior; a new top-level route would separate settings from the run it affects. Anatomy: four labelled sections and a sticky Save/Cancel footer. Open via **Review settings** in the repo rail; closing returns focus to that button. Classes: `surface-1 rounded-xl p-4`, `input input-bordered`, `select select-bordered`, `checkbox`, `alert alert-error`, `btn btn-primary` and `btn btn-ghost`.

1. **GitHub bot identity (D10):** show **Connected as <login>**, scope check result (PR read, PR/issue comment write), last verified time, Verify connection, Replace token, Remove connection. Token entry is password-masked and sent only to the host secret-storage port; never display the stored value, last four characters, or secret-derived text. Replacement and removal each require confirmation because they change future publication. Missing identity disables live publication, leaves dry-run available, and presents Connect bot. Verification error has a retry and a plain reason, no raw response.
2. **Trust policy (D11):** repository list model with v1 entry `Hive-Academy/PtahCode`; add/remove repository controls may be disabled under the v1 policy with an explicit reason. Editable maintainer GitHub login allowlist supports add/remove with case-insensitive deduplication and login-format validation. Empty allowlist means no PR is eligible and shows a blocking warning. **Fork PRs are always excluded** is read-only, never a toggle. Changes affect the next run, not historical provenance.
3. **Runtime and thresholds (D12, FR-10/13/14):** per-PR lane cap integer 1–6 (default 6: triage, four lenses, verifier); polling interval in minutes with validated bounds from backend contract; lens checkboxes; minimum severity select; confidence input 0–1 with default 0.8; fallback family order as numbered, keyboard-reorderable list. Show provider limit state beside each family; at-limit families are skipped, unknown-limit families carry **Capacity unverified**. No daily quota. If no family has room, next run is coverage-limited with no waiting. Validation is inline and Save remains disabled until valid.
4. **Repository config:** show `found` with validated version/effective settings, `invalid` with exact failing key and plain error (publication blocked), or `absent — defaults applied`. Excluded paths, path instructions and lens overrides are read-only effective settings; PR-branch config is marked untrusted until source trust is established. Provide Reload config and inline loading/error/empty states. Never show local file paths.

Data: identity login/scope check/verification time/secret-storage status; allowed repositories and logins; poll interval, lane cap, lens flags, severity/confidence, fallback order and family limit state; config validation/version/effective snapshot (FR-1/3/10/13/14, AC-13.3–5). The settings form is an operator configuration view, not a repository config file editor.

### Runs list and filters

Purpose: triage current and historic attempts. Anatomy: queue count, `select select-bordered select-sm` repo/state filters; row shows repo, PR #/title, 7–12 digit short SHA, poll/manual/replay trigger, labelled state, elapsed, posted/suppressed counts. Classes: `surface-1 rounded-xl`, `table table-zebra table-sm`; stacked compact cards below 700px. A row is one focusable action opening detail. States: queued, running, partial, failed, published, dry-run, skipped-untrusted, superseded. Filter empty state offers Clear filters. Data: repo, PR, SHA, attempt ID, trigger, queue/start/end times, result, counts (FR-2, FR-10, FR-14, FR-16, AC-2.5).

### Run detail drawer

Purpose: explain an attempt and permit safe next steps. Anatomy: PR identity, attempt ID, status, actions, stage timeline, coverage notices, findings and links. Classes: existing `ptah-native-drawer`, `badge`, `alert`, `table table-sm`, `btn btn-ghost btn-sm`. Stages: Discovery, Context & checks, Lenses, Verification, Publication. Each shows waiting/running/succeeded/partial/failed/skipped, time, and plain-language failure reason. Lenses show chosen family, fallback and skipped families with reasons. Context shows unavailable checks. Publication distinguishes live posted, dry-run preview, paused, skipped, failed. **Coverage limited** marks oversized PRs; **Capacity unverified** marks unknown-limit lanes. Never show raw logs, secrets, local paths, or untrusted instructions. Data: stage records, lane/check availability, coverage, safe failure reason, GitHub URLs/IDs, timestamps, effective config snapshot (FR-2/3/13/14/16, NFR-6/11).

### Findings table

Purpose: show posted and withheld candidates. Anatomy: severity, category, sanitized repo-relative file:line or **Outside diff**, status, suppression reason. Classes: `table table-zebra table-sm`, `badge badge-outline`, `font-mono` location. States: posted, suppressed with reason, addressed, reopened, below threshold. Empty copy distinguishes no findings from incomplete verification. Data: finding ID, severity, category, location, status, reason, optional review link (FR-10/11/16, NFR-6).

### Confirmation dialog

Purpose: make GitHub consequences explicit. Classes: `modal modal-open`, `modal-box`, `btn btn-primary`, `btn btn-ghost`. Live rerun asks **Rerun and allow GitHub publication?**, naming repo, PR, current SHA, effective mode and deduplication. Primary action **Rerun and allow posting**. Dry-run rerun queues locally without posting confirmation. Changing a repo to live and turning the global kill switch Off require confirmation; switching to the safer state applies immediately. Data: effective controls/current head (FR-3/11, AC-3.1/4, AC-11.4).

## Interaction and confirmations

- Repo selection sets the repo filter; state filter is independent. Keep a selected drawer open as filters change.
- Rerun creates a distinct attempt for the selected head. Refresh current head first; if changed, explain supersession and link to latest. Never suggest the old head may publish.
- Rerun as dry-run creates a local preview and announces the new attempt ID in a polite live region.
- Effective live publication requires both kill switches Off, repo mode live, valid trust/config, and current head. Backend rechecks before every mutation; UI state is advisory.
- Open PR and Open published review use validated GitHub HTTPS URLs, external-link icon and new-window announcement. Dry-run offers View publication preview instead of a review link.
- Failed poll offers Retry poll; unavailable lanes offer Review lane settings. Disabled controls have adjacent reasons.
- The prototype's **Preview state** select exists only to expose static review examples. Do not implement it in Angular.

## States

| State | Treatment | Action |
| --- | --- | --- |
| No repositories | Explain adding an allowed repo | Open repository settings |
| No runs | “No review runs yet”; explain next poll | Refresh |
| Loading | Skeleton rows, `aria-busy`; retain content on refresh | Wait |
| Error | Inline `alert alert-error`, plain reason | Retry |
| GitHub offline | `alert alert-warning`, cached timestamp; disable live posting | Retry connection; dry-run when local inputs exist |
| No lanes available | `alert alert-warning`; no false clean result | Review lane settings |
| Failed poll | Repo card shows failure time; cursor unchanged | Retry poll |
| Superseded | Labelled row; publication blocked | Open latest head |
| Settings: no bot | Connect bot panel; live publication blocked | Connect bot |
| Settings: no maintainers | Blocking trust warning; no eligible PRs | Add login |
| Settings: invalid config | Exact key and error; publication blocked | Reload config |
| Settings: verification/load error | Plain error with retained form values | Retry |

## Accessibility

- WCAG AA: full `base-content` or measured `text-base-content-muted`; no text opacity for hierarchy. Pair every status color with icon and text. `--state-ink-*` colors may accent icons only.
- Focus order: navigation, header, repositories, filters, rows, drawer close/actions, stages/findings, links. Opening drawer focuses title; closing returns to row. Escape closes drawer/dialog; dialog traps focus. Do not autofocus a posting action.
- Label every toggle and expose `aria-checked`; safety changes use a polite live region. Errors use `role="alert"`, loading `aria-busy`, tables captions/headers. Compact controls retain 44×44px hit areas. Respect reduced motion.

## Tokens used

- Existing `apps/ptah-extension-webview/tailwind.config.js` themes: `ptah-glass` dark and `ptah-glass-light` light. Other renderer themes inherit semantic DaisyUI classes.
- Dark: `base-100 #17191d`, `base-200 #202329`, `base-300 #2a2e35`, `base-content #f2f2f1`, `primary #e4b94a`. Light: `base-100 #f7f3fd`, `base-200 #eee8f8`, `base-300 #e2daf1`, `base-content #1e1936`, `primary #7c5700`.
- Existing `surface-1`, `surface-2`, `border-surface-border`, `text-base-content-muted`; Inter/system `font-sans`, JetBrains Mono fallback `font-mono`. Heading `text-xl`, body `text-sm`, metadata `text-xs`; header `p-5`, cards `p-4`, gaps `gap-6`, `rounded-xl`.

## Mapping to requirements

| Requirement | Component / behavior |
| --- | --- |
| FR-1, AC-1.5 | Repository scope, poll state and retry |
| FR-2, AC-2.5 | Attempt identity, trigger, timestamps |
| FR-3, AC-3.1–4 | Rerun, dry-run, kill switches, pre-post recheck |
| FR-10, AC-10.1–4 | Posted/suppressed counts and reasons |
| FR-11, AC-11.4–7 | Publication state, links, deduplication, head guard |
| FR-13, AC-13.3–5 | Effective settings, exact config error, provenance |
| FR-14, AC-14.1–7 | Stage/lane history, unavailable checks, coverage/capacity labels |
| FR-16, AC-16.1–4 | Electron navigation, distinguishable states and safe retry |
| NFR-6 | Partial coverage never shown as clean success |
| NFR-11 | Discovery/queue/walkthrough/review times and target-miss cause |

## Decisions

- **Drawer rather than page.** Existing cron details use `NativeDrawerComponent`; drawer preserves list context. Reversible.
- **Repository rail and run table.** Repositories are persistent filters and safety summaries; attempts need dense comparison. Reversible.
- **Existing glass themes.** The webview's theme source is authoritative. Reversible.
- **Confirm posting-capable reruns.** GitHub mutation is the meaningful confirmation boundary in FR-3/11. Reversible.
- **Local single operator in v1.** The Electron app user is the operator; there is no additional authorization layer or authorization flag. Options: separate role check or local operator. D10–D12 assume local settings and FR-16 specifies Electron; reversible if multi-user operation is later introduced.
- **CodeRabbit coexistence and comment-only output.** D13 keeps CodeRabbit enabled; D14 fixes review tone. These affect publication copy, not additional settings. Reversible.

## Open questions

- Confirm Electron navigation registration and whether the Schedules link can pass repository context; All repositories is the fallback.
- Confirm replay visibility; replay remains a read-only trigger label until the backend contract defines its exposure.

## Revision log

| Gate 1.7 finding | Addressed in |
| --- | --- |
| 1 Settings missing | Review settings drawer component, settings states and interactive prototype drawer |
| 2 Light evidence missing | Dark/light screenshots of detail, confirmation, settings, no lanes and offline states |
| 3 Preview control ambiguous | Interaction note marks Preview state prototype-only |
| 4 Badge legibility | Wider state column, plain Skipped-untrusted text and warning icon in prototype |
| 5 Repository sample | `Hive-Academy/PtahCode` throughout prototype |
| 6 Authorization open question | Decisions: local single operator in v1 |
