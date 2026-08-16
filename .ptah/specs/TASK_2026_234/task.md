---
id: TASK_2026_234
status: in_review
type: BUGFIX
title: 'Six TUI defects found by the TASK_2026_198 logic review'
description: >-
  Six defects in apps/ptah-tui carried forward from the 2026-08-11 handoff
  (section 3.1). Four are pure-logic and unit-testable: CRLF block parsing,
  the dead Ctrl+M binding, intraword `_` emphasis eating characters, and
  TERM=xterm-256color resolving as truecolor. Two are interaction defects:
  Escape closing two surfaces per press, and a mid-stream view switch
  leaking a running turn with no way to abort it.
---

# Six TUI defects

Source: logic review of TASK_2026_198, recorded in `.ptah/handoff-2026-08-11.md` §3.1.
Nothing here was filed as a carrier at the time; this allocates one.

## Scope

| #   | Defect                                        | Site                                                          |
| --- | --------------------------------------------- | ------------------------------------------------------------- |
| 1   | CRLF block parsing                            | `lib/markdown.ts:200`                                         |
| 2   | `Ctrl+M` is a dead binding — Ctrl+M _is_ CR   | `lib/keymap.ts:180`, `components/App.tsx:242`                 |
| 3   | Intraword `_` deletes characters              | `lib/markdown.ts:312-318`                                     |
| 4   | `TERM` containing `256` resolves as truecolor | `lib/palette.ts:97`                                           |
| 5   | Escape closes two surfaces per press          | `sidebar/SessionList.tsx:56`, `settings/AuthSection.tsx:1134` |
| 6   | Mid-stream view switch leaks a running turn   | `chat/ChatPanel.tsx:99-104`, `hooks/use-chat.ts:187-194`      |

## Verification limit — partly closed

Originally: no PTY, so keystrokes never reached `useInput`, and for items 2, 5
and 6 only the reducer underneath was provable.

`nx run ptah-cli:e2e-pty` now drives the built bundle on a real pseudo-terminal
(`tests/e2e/_harness/pty-runner.ts`). Covered end-to-end, mutation-checked
against a rebuilt bundle:

- **Item 2** — Ctrl+O opens the model selector; Ctrl+M does not, because it is
  the same byte as Enter.
- **Item 5 (AuthSection half)** — Escape backs out of the provider configurator
  and stays in Settings; only a second press leaves.

Still unit-level, and reachable only with a live provider:

- **Item 5 (SessionList half)** — needs a session to delete, and the list is
  empty until a turn has run. Covered by `escape-claims.spec.ts`.
- **Item 6** — needs a streaming turn. e2e strips every credential by design.
  Covered by `use-chat.spec.ts`.
