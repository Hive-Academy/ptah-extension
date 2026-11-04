# CodeRabbit analysis

## Data

Sample: 200 closed/merged PRs, numbers 709–908, from four GraphQL pages. Ranked by CodeRabbit root inline review threads; follow-up replies were excluded. Resolved is a proxy for acted on, not proof of a code change.

| PR | Title | Inline | Resolved |
| --- | --- | ---: | ---: |
| [730](https://github.com/Hive-Academy/PtahCode/pull/730) | Rail board with split focus | 12 | 12 |
| [735](https://github.com/Hive-Academy/PtahCode/pull/735) | Voice Command Center | 11 | 0 |
| [889](https://github.com/Hive-Academy/PtahCode/pull/889) | Group session rail and cap agent dock | 8 | 8 |
| [763](https://github.com/Hive-Academy/PtahCode/pull/763) | Setup wizard agent and guidance in chat tabs | 8 | 8 |
| [879](https://github.com/Hive-Academy/PtahCode/pull/879) | Workspace default skill and MCP installs | 7 | 7 |
| [844](https://github.com/Hive-Academy/PtahCode/pull/844) | Lane reports and prompts in order | 7 | 7 |
| [808](https://github.com/Hive-Academy/PtahCode/pull/808) | Claude multi-account, Electron first | 7 | 7 |
| [803](https://github.com/Hive-Academy/PtahCode/pull/803) | Lane policy and workspace browser files | 7 | 7 |
| [795](https://github.com/Hive-Academy/PtahCode/pull/795) | Attention row session names | 7 | 6 |
| [900](https://github.com/Hive-Academy/PtahCode/pull/900) | Installed Codex on every OS | 6 | 6 |
| [780](https://github.com/Hive-Academy/PtahCode/pull/780) | Attention-first notifications | 6 | 5 |
| [751](https://github.com/Hive-Academy/PtahCode/pull/751) | One execution stream for lanes | 6 | 6 |
| [720](https://github.com/Hive-Academy/PtahCode/pull/720) | MCP OAuth refresh and Electron context | 6 | 6 |
| [871](https://github.com/Hive-Academy/PtahCode/pull/871) | PtahCode rebrand | 5 | 5 |
| [835](https://github.com/Hive-Academy/PtahCode/pull/835) | Background handoff | 5 | 5 |
| **Total** | | **108** | **95** |

## Taxonomy

The following is CodeRabbit's own category labels, rather than a researcher-imposed subcategory. A narrower logic/error/contract taxonomy remains to be coded. Severity across all root comments: 77 Minor, 31 Major, zero Critical. The acted-on column cannot safely be allocated by category from PR-level resolution counts.

| Category | Count | Share | Acted-on rate | Examples |
| --- | ---: | ---: | ---: | --- |
| Functional Correctness | 72 | 66.7% | unverified | “[Map bg: lane keys to sub: keys](https://github.com/Hive-Academy/PtahCode/pull/730#discussion_r4277283797)”; “[voice chip shows Voice unavailable after voice starts](https://github.com/Hive-Academy/PtahCode/pull/735#discussion_r4299377620)” |
| Stability & Availability | 16 | 14.8% | unverified | “[confirm retry waits for a turn-end signal that never comes](https://github.com/Hive-Academy/PtahCode/pull/735#discussion_r4299377677)”; “[do not await iterator.return while an SDK read is pending](https://github.com/Hive-Academy/PtahCode/pull/844#discussion_r4408188332)” |
| Security & Privacy | 8 | 7.4% | unverified | “[Redact credentials before writing structured context](https://github.com/Hive-Academy/PtahCode/pull/720#discussion_r4262189863)”; “[apply the 16 KiB limit to chat:start options](https://github.com/Hive-Academy/PtahCode/pull/735#discussion_r4299377552)” |
| Data Integrity & Integration | 7 | 6.5% | unverified | “[Clear the draft for the tab that sent the message](https://github.com/Hive-Academy/PtahCode/pull/730#discussion_r4277283912)”; “[complete the repository rename before using the new publish target](https://github.com/Hive-Academy/PtahCode/pull/871#discussion_r4440311816)” |
| Maintainability & Code Quality | 3 | 2.8% | unverified | “[Raise the anubis idle ink to at least 4.5:1](https://github.com/Hive-Academy/PtahCode/pull/730#discussion_r4277283760)”; “[Document provider-scoped session handling](https://github.com/Hive-Academy/PtahCode/pull/720#discussion_r4262189935)” |
| Performance & Scalability | 2 | 1.9% | unverified | “[Stop screen capture before discarding recorder](https://github.com/Hive-Academy/PtahCode/pull/803#discussion_r4332578901)”; “[Record successful status responses as completed](https://github.com/Hive-Academy/PtahCode/pull/844#discussion_r4408188360)” |

## How CodeRabbit reviews

- A walkthrough issue comment summarizes changes and often includes a Mermaid sequence diagram; see [PR730 walkthrough](https://github.com/Hive-Academy/PtahCode/pull/730#issuecomment-6180502831).
- Inline comments carry explicit issue-domain and severity labels, a proposed diff, committable suggestion, and a Prompt for AI Agents block; see [PR730 lane-key finding](https://github.com/Hive-Academy/PtahCode/pull/730#discussion_r4277283797).
- Comments sometimes show “Supported by static analysis”; see [PR735 input limit](https://github.com/Hive-Academy/PtahCode/pull/735#discussion_r4299377552). A specific external tool name was not verified.
- The bot follows up on fixes: [PR730 reply](https://github.com/Hive-Academy/PtahCode/pull/730#discussion_r4277962896) names the changed behavior and tests. Twelve PR730 roots have “Confirmed as addressed” appended; 44 of 108 roots have that marker overall.
- Review summaries mention learnings in PR730, 763, 795, 808, 844, 879, 900; see [PR730](https://github.com/Hive-Academy/PtahCode/pull/730).
- PR763, 803 and 900 review text mentions findings outside the diff. [PR900 walkthrough](https://github.com/Hive-Academy/PtahCode/pull/900#issuecomment-6596486187) also contains a CodeRabbit Verify section.
- This repository's [.coderabbit.yaml](D:/projects/ptah-extension/.coderabbit.yaml) filters task specs and unit specs, so CodeRabbit's PR review concentrates on production source. No named actionlint, gitleaks, markdownlint or shellcheck run was verified in the sample exports.

## Gap vs our workflow

| Category | Covered? | Likely reason still missed |
| --- | --- | --- |
| Functional correctness | yes: code-logic-reviewer.md:87-129 | Combined phase-diff review is one pass, whereas CodeRabbit comments span updates and revisit fixes. |
| Stability and races | yes: code-logic-reviewer.md:93-115 | Complex async state transitions need explicit trace and follow-up; a checklist alone is insufficient. |
| Security and privacy | partial: review-security.md and code-logic-reviewer.md:91-92 | Orchestration mandates code-logic review per phase, but does not mandate a separate security review per phase. |
| Data integration and contracts | yes: code-logic-reviewer.md:91-129; code-style-reviewer.md:143-156 | Style review is conditional on new public API, so cross-file drift in existing APIs can miss a specialist pass. |
| Accessibility and UX details | partial: visual reviewer and code-logic reviewer | The logic review's five failure questions emphasize runtime behavior; PR730 found focus/contrast and PR889 menu semantics. |
| Maintainability and documentation | partial: code-style-reviewer.md:109-137 | Style review runs only for new public APIs under orchestration line 195. |
| Performance | yes: code-logic-reviewer.md:108-114 | Session-growth costs require a scenario beyond a changed-line reading. |
| Config and CI | partial: review-code.md:235-238 | PR871 caught a publish target rename spanning config and product naming. |

The orchestration skill lines 191–198 require one independent code-logic review on the combined phase diff, style review only for new public API, and scoped checks before commit. It does not prescribe an automated post-push review against the final PR state. The code-logic reviewer's instructions are already strong; the measurable gap appears to be timing and independent follow-up rather than missing hunt-list topics.

## Highest-value signals

Provisional order based on observed recurrence and severity; a formal frequency × acted-on × severity ranking needs per-comment acted-on coding:
1. Async lifecycle and retry deadlocks (PR735, 763, 844).
2. Cross-session state routing and stale identity (PR730, 808, 889).
3. Error paths that report success or hide failures (PR763, 879).
4. Credential retention, redaction and boundary limits (PR720, 735, 900).
5. Producer/consumer key and contract mismatch (PR730, 751, 900).
6. Host parity and missing path registration (PR763, 803).
7. Persisted state and migration integrity (PR808, 879).
8. Accessibility interaction semantics (PR730, 889).
9. Event ordering and dropped messages (PR735, 844).
10. Configuration and publish target drift (PR871).

## Decisions

- Count root CodeRabbit inline findings, not bot replies; the PR730 inline export has 24 entries but 12 roots.
- Report resolved threads as a proxy, separately from confirmed fixes. PR735 has 11 findings and zero resolved threads.
- Do not infer a particular linter ran from “Supported by static analysis.”

## Open questions

- Which of the 95 resolved threads were fixed in commits, disputed, or merely closed?
- Which exact named tools ran, if any, and how are their findings represented in review bodies?
- Do issue comments and incremental review runs create duplicate roots beyond the 108 counted here?

