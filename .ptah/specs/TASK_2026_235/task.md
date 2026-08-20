---
id: TASK_2026_235
status: in_review
type: REFACTORING
title: 'Rebuild the TUI keymap on Gemini CLI conventions and seed a configured pty fixture'
description: >-
  Four TUI chords sat directly on readline line-editing defaults — Ctrl+E
  (end-of-line), Ctrl+K (kill-to-end), Ctrl+N/Ctrl+P (history) — so in a
  composer that is a text input, the documented shortcut stole the standard
  editing key. Rebound the app-level bindings onto Alt / Shift+Tab following
  Gemini CLI's table, added a RESERVED_CHORDS guard, and extended the pty
  harness to boot a configured workspace so authenticated surfaces are
  testable at all.
---

# Keymap on Gemini conventions + configured pty fixture

## Why

`TASK_2026_234` moved the model selector off the undeliverable `Ctrl+M` onto
`Ctrl+O`, chosen by scanning which letters were unused **in our own keymap**.
That method has no grounding: `Ctrl+O` is VDISCARD at the tty and
`app.showMoreLines` in Gemini CLI. The user asked for the chords to be derived
from a reference implementation instead.

Reading Gemini CLI 0.42.0's binding table showed the problem was wider than one
chord. Gemini reserves `Ctrl+<letter>` for readline and puts app features on
`Alt+<key>`, `Shift+Tab` and function keys. Four of our bindings were sitting on
line-editing defaults.

## Rebinding

| id                 | before | after     | why                                                           |
| ------------------ | ------ | --------- | ------------------------------------------------------------- |
| `nav.palette`      | Ctrl+K | Alt+K     | readline kill-to-end                                          |
| `session.new`      | Ctrl+N | Alt+N     | readline next-history                                         |
| `session.list`     | Ctrl+E | Alt+L     | readline end-of-line                                          |
| `agent.monitor`    | Ctrl+B | Alt+A     | readline backward-char                                        |
| `agent.model`      | Ctrl+O | Alt+M     | VDISCARD; Gemini `app.showMoreLines`                          |
| `agent.effort`     | Ctrl+R | Alt+E     | readline reverse-search                                       |
| `agent.permission` | Ctrl+P | Shift+Tab | readline prev-history; matches Gemini `app.cycleApprovalMode` |
| `app.settings`     | Ctrl+S | Alt+S     | XOFF flow control                                             |
| `app.thoth`        | Ctrl+T | Alt+T     | readline transpose-chars                                      |

`app.quit` stays on Ctrl+C twice — claimed deliberately, as Gemini claims it for
`basic.quit`, with Ink rendered `exitOnCtrlC: false`.

`RESERVED_CHORDS` + `findReservedChordConflicts` make this enforceable. It is the
third independent guard and catches what the other two structurally cannot:
`findKeymapConflicts` only sees collisions inside our table, and
`findControlCodeAliases` only sees undeliverable chords. A chord can be unique
and deliverable and still be wrong because readline got there first.

## Verified, not assumed

Ink's parsing was measured on a real pty before the scheme was chosen:
`Alt+M` → `{ meta: true, input: 'm' }`, `Shift+Tab` → `{ shift: true, tab: true }`,
bare Escape → `{ escape: true }` with **no** meta. The last one is what makes
Alt bindings safe alongside Escape-to-close.

`shouldRollBackChord` already covered `meta`, so Alt chords do not leak a letter
into the composer, and `ink-text-input` early-returns on shift+tab.

## Configured pty fixture

The pty harness stripped every credential and used an empty HOME, so it only
ever exercised the unauthenticated cold start — which is why the sidebar and
session surfaces were unreachable. `startTui({ configured, workspace })` now
seeds `~/.ptah/settings.json` with a provider and model, injects the same fake
key the JSON-RPC e2e specs use, and runs in a real project folder.

## Known limits

- Alt chords are ESC-prefixed. macOS Terminal.app does not send them by default
  unless "Use Option as Meta key" is on. Mitigated rather than ignored: every
  app feature is also reachable through `/` slash commands and the palette, so
  Alt is an accelerator and never the only path.
- A live streaming turn still needs a real provider, so `dispose()`'s abort
  remains unit-level.
