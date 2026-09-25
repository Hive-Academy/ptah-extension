# Code Logic Review — Batch 1, `TASK_2026_533`

Scope: Task 1.1 (shared contracts + catalogue `brandSlug`), Task 1.2 (backend
`removalFixCommand` quoting, R4), Task 1.3 (grouping carries the field). Files
reviewed in full, diffed against `main`:

- `libs/shared/src/lib/types/mcp-directory.types.ts`
- `libs/shared/src/lib/connectors/ptah-connectors.catalog.ts` (+ `.spec.ts`)
- `libs/backend/cli-agent-runtime/src/lib/mcp-directory/mcp-install.service.ts` (+ `.spec.ts`)
- `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/installed-mcp-groups.ts` (+ `.spec.ts`)
- `libs/frontend/marketplace/src/lib/connectors-surface.component.spec.ts` (fixture fix, landed)

Verification run: `npx nx run-many -t lint,typecheck,test -p @ptah-extension/shared @ptah-extension/cli-agent-runtime @ptah-extension/chat-ui` — green (9/9 tasks, 6 cache hits on current file hashes). `npx nx test @ptah-extension/marketplace` — green, 411/411 tests, including the `brandSlug` fixture fix.

## Summary

| Metric              | Value         |
| ------------------- | ------------- |
| Overall score       | 9/10          |
| Assessment          | APPROVED      |
| Blocking issues     | 0             |
| Serious issues      | 0             |
| Moderate issues     | 1             |
| Failure modes found | 1 (mitigated) |

## R4 focus: shell-safety of `removalFixCommand`

`libs/backend/cli-agent-runtime/src/lib/mcp-directory/mcp-install.service.ts:536-611`.

**Partition logic.**

- `SHELL_BARE_ARGUMENT = /^[A-Za-z0-9_][A-Za-z0-9_./:+=-]*$/` (line 553) is the unquoted-safe set. Every character it allows (`.`, `/`, `:`, `+`, `=`, `-` mid-string, alnum, `_`) is inert, unquoted, in bash, zsh, PowerShell 5.1/7 and cmd — none of those characters are metacharacters in any of the four shells outside of specific leading-character contexts, and a leading `-` is rejected unconditionally one line earlier (`value.startsWith('-')`, line 596) regardless of quoting, because quoting cannot stop `claude`'s own option parser from reading a leading-dash argument as a flag. Correct call: shell-quoting and CLI-argument-parsing are different problems, and only the shell-facing one is this function's job — but leading `-` is a case where quoting cannot fix the CLI-parsing problem either, so it is excluded outright rather than silently mis-handled.
- `SHELL_UNQUOTABLE_PRINTABLE = {'"', '$', '`', '\\', '!', '%'}`(line 563) covers exactly the characters that remain live *inside* a double-quoted string in at least one of the four shells:`"`(closes the quote everywhere),`$`/`` ` `` (expansion in bash/zsh/PowerShell), `\` (escape in bash/zsh — banning it also sidesteps the well-known Win32/PowerShell "trailing backslash before closing quote" argv-splitting quirk, since no backslash can ever reach the closing quote), `!` (bash/zsh interactive history expansion), `%` (cmd.exe `%VAR%` expansion, which fires even inside double quotes).
- `hasUnquotableCharacter` (line 569) additionally rejects C0/C1 control characters and the Unicode line/paragraph separators (U+2028/U+2029) — sound, since these would corrupt a pasted single-line command regardless of shell.
- Everything else (space, `;&|<>(){}*?[]~#,@'^`) is safe once wrapped in `"..."`: none of these retain special meaning inside a double-quoted string in bash, zsh, PowerShell, or cmd (glob/brace/tilde expansion is disabled by quoting in bash/zsh; PowerShell array/splat/redirection tokens only apply to unquoted syntax positions, not string contents; cmd's `&|<>^()"` are neutralised by quotes, with `%` the sole quote-surviving exception, which is separately banned).
- I independently re-derived this partition from POSIX/bash/zsh/PowerShell/cmd quoting rules without relying on the code's own comments, and did not find a character that is classified as safe-bare or safe-quoted but is actually unsafe in any of the four target shells. This is careful, correct work.

**Test coverage matches the claim.** `mcp-install.service.spec.ts:149-283` exercises: bare-safe keys with `.`/`-`/`_`/`:`/`/` (including an `io.github/user:server`-shaped key), 12 metacharacter/whitespace cases that must be quoted (including the non-obvious ones: comma, `@`, parens, single quote, non-ASCII `café`), and 13 cases that must omit the command entirely (`"`, newline, CR, tab, ESC, C1 control `\u0085`, the real U+2028 byte sequence — verified with `cat -A`, not just a rendered space — `$`, backtick, backslash, `!`, `%`, and leading `-`). Every case in the spec matches my independent classification above.

**Scope-flag consistency.** `claudeUserScopeFlag` (line 536) is the single source both `claudeUserRemovalReason` (prose, line 542) and `claudeUserRemovalCommand` (copyable command, line 559) call — they cannot diverge. `ClaudeUserMcpScope = 'user' | 'project'` (`claude-user-mcp.reader.ts:45`) is a two-value union, so the `scope === 'user' ? ' --scope user' : ''` ternary is exhaustive; there is no third scope value that would silently fall through to the wrong flag.

**Omission on unquotable/unsafe keys.** `listInstalled` (lines 310-337) spreads `removalFixCommand` in conditionally: `...(fixCommand === null ? {} : { removalFixCommand: fixCommand })`. The property is genuinely absent, not `undefined`-valued, confirmed by the spec's `expect(row).not.toHaveProperty('removalFixCommand')` (line 194) rather than a weaker `toBeUndefined()`.

**Grouping (Task 1.3).** `installed-mcp-groups.ts:77-89`: `head = grouped[0]`, and `grouped` preserves insertion order from the flat input array (`groupInstalledServers:67-76` pushes onto a `Map` in iteration order). `removalFixCommand` is copied from `head` with the same conditional-spread omission pattern. The "takes the command from the head row, not a later one" spec (`installed-mcp-groups.spec.ts:191-198`) and the "leaves the field absent" spec (`:200-219`, covering both a connector row with no command at all and a claude-user row where the backend withheld it) both verify this directly.

## Five logic questions

### 1. How does this fail silently?

Not found in this batch's own logic. The one place a silent failure _could_ have crept in — a key with an unsafe character quietly getting a broken command instead of no command — is exactly what `hasUnquotableCharacter` exists to prevent, and it is exhaustively tested. If a _future_ edit added a new shell to the "may paste into" set (e.g. fish, nushell) without re-auditing `SHELL_UNQUOTABLE_PRINTABLE`, the omission would not be automatic; nothing in the code flags that the character set is scoped to exactly four shells other than the doc comment at `mcp-install.service.ts:565-567`. That is a documentation/process risk, not a present bug.

### 2. What user action produces unexpected behaviour?

A user with a `~/.claude.json` entry keyed by something outside typical CLI-generated names (an entry another tool wrote with a quote, `$`, backslash, or leading dash in the key) sees the removal reason but no copy button — this is the intended degraded behaviour per Task 1.2, not a defect. No action found that produces a broken/mismatched command.

### 3. What input data produces a wrong answer?

None found for the quoting function itself (see R4 analysis above — exhaustively re-derived and matches the tests). For grouping, if `head.removalFixCommand` were present but `head.removal !== 'none'` (a state the current single producer, `claude-user` origin, never creates, since only that origin sets the field and always with `removal: 'none'`), the group would still carry a command through — but the UI reads `removal`/`removalBlockedReason` to decide whether to show anything, so an inert unused field on a non-blocked row is not exploitable today. Noted as a moderate item below since it is an _implicit_ contract (removalFixCommand co-travels with `removal: 'none'`) that is not type-enforced.

### 4. What happens when a dependency fails?

`~/.claude.json` read failures are handled upstream of this batch (existing `readClaudeUserMcp` behaviour, unchanged by this diff). Nothing in Batch 1 introduces a new dependency.

### 5. What is missing that the requirements never mentioned?

The plan's edge case list (`batches.md:107`) explicitly covers "blocked row with no fix command (claude.ai connector rows)," which Task 1.3's spec (`installed-mcp-groups.spec.ts:200-207`) exercises. Nothing else in the risk/edge-case list for this batch is unaddressed.

## Failure modes

### Unscoped shell-safety character set (documentation only)

- Trigger: a future change extends "shells the user may paste into" beyond bash/zsh/PowerShell 5.1/7/cmd (the R4 scope given to this review) without revisiting `SHELL_UNQUOTABLE_PRINTABLE`.
- Symptom: a character safe in the original four shells but unsafe in a newly-added shell would pass through quoted.
- Evidence: `mcp-install.service.ts:558-567` — the comment scopes the rule to "at least one shell the user may paste into" without naming which shells, though the function-level doc at `:601-611` does.
- Current handling: correct for the four shells actually in scope.
- Recommendation: none needed now; flag for whoever next touches this function if the shell list changes.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

### `removalFixCommand` presence is not type-linked to `removal: 'none'`

- File: `libs/shared/src/lib/types/mcp-directory.types.ts:294-303`
- The field is a bare `removalFixCommand?: string` on `InstalledMcpServer`, not narrowed to only exist alongside `removal: 'none'`. Today only one producer (`claude-user` origin, always `removal: 'none'`) ever sets it, so there is no live path to a mismatched state, but the type does not prevent a future producer from setting `removalFixCommand` on a `direct`/`ptah-managed`/`smithery`/`oauth` row, which the UI is not designed to show a copy affordance for. Minor — the doc comment (`:292-302`) does explain the intended coupling in prose.

## Data flow

1. `PtahConnector.brandSlug` (shared catalogue) — static data, cross-checked by `ptah-connectors.catalog.spec.ts` for kebab-case and family-sharing correctness. OK.
2. `McpInstallService.listInstalled` reads `~/.claude.json` rows, computes `claudeUserRemovalCommand(serverKey, scope)` per row (`mcp-install.service.ts:310-337`). OK — quoting verified exhaustively against bash/zsh/PowerShell 5.1+7/cmd.
3. Conditional spread omits `removalFixCommand` when `null`. OK — confirmed absent via `toHaveProperty`, not `undefined`-valued.
4. `groupInstalledServers` collapses same-origin/same-key rows, head row (first by insertion order) donates `removalFixCommand`, later rows' commands are discarded. OK — matches the documented "head wins" contract and is spec-covered for both the override and the absence case.
5. Consumption by the UI component that renders the copy button is outside this batch's file list (not reviewed here — out of scope for Batch 1).

## Requirements fulfilment

| Requirement                                                                           | Status   | Gap                                                      |
| ------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------- |
| `PtahConnector.brandSlug: string` required, kebab-case, on all 63 entries             | COMPLETE | none                                                     |
| Shared-slug family rule (same brand only)                                             | COMPLETE | spec pins exact family list and order; matches catalogue |
| `InstalledMcpServer.removalFixCommand?: string`, optional                             | COMPLETE | none                                                     |
| Same flag logic as prose (`--scope user`)                                             | COMPLETE | single shared helper, exhaustive union                   |
| Whitespace/metacharacter keys double-quoted                                           | COMPLETE | 12 cases spec-covered, all correctly classified          |
| Command omitted when unquotable (`"`, newline, leading `-`, etc.)                     | COMPLETE | 13 cases spec-covered, all correctly classified          |
| `InstalledServerGroup.removalFixCommand?` copied from head, absent when head lacks it | COMPLETE | none                                                     |

Implicit requirements not addressed: none found beyond the moderate type-coupling note above.

## Edge cases

| Case                                                      | Handled                      | How                                                                    | Concern       |
| --------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------- | ------------- |
| Key with `"`                                              | YES                          | `hasUnquotableCharacter` rejects; command omitted                      | none          |
| Key with `$`, `` ` ``                                     | YES                          | rejected; omitted                                                      | none          |
| Key with `\`                                              | YES                          | rejected; omitted (also sidesteps Win32 trailing-backslash argv quirk) | none          |
| Key with `!`, `%`                                         | YES                          | rejected (bash history, cmd env expansion); omitted                    | none          |
| Key with newline/CR/tab/C1 control/U+2028                 | YES                          | control-code range check; omitted                                      | none          |
| Key with leading `-`                                      | YES                          | rejected unconditionally (CLI option-parsing risk, not just shell)     | none          |
| Key with whitespace, `;&                                  | <>(){}*?[]~#,@'^`, non-ASCII | YES                                                                    | double-quoted | none |
| Plain alnum/`.`/`-`/`_`/`:`/`/` key                       | YES                          | bare, unquoted                                                         | none          |
| User scope vs project scope                               | YES                          | shared `claudeUserScopeFlag`, exhaustive union                         | none          |
| Group with multiple rows, only head has a command         | YES                          | head-only copy, spec-covered                                           | none          |
| Group where head has no command (connector or unquotable) | YES                          | field omitted on the group too                                         | none          |
| Brand slug shared across unrelated products               | YES                          | spec asserts exact allowed family map                                  | none          |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: none blocking; the one moderate note (type doesn't statically couple `removalFixCommand` to `removal: 'none'`) is a latent-defect surface for a future producer, not a present bug.
- What a robust implementation would add: a discriminated-union refinement of `InstalledMcpServer` so `removalFixCommand` is only assignable when `removal: 'none'`, and a short in-code note pinning the "four shells" scope of `SHELL_UNQUOTABLE_PRINTABLE` so a future shell addition is a deliberate, reviewed decision rather than an assumed one.
