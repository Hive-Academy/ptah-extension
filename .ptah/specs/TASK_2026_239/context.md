# Context — TASK_2026_239

## Origin

Split out of **TASK_2026_237** by explicit recommendation (that task's
requirements §10, and the team-leader's B-batch breakdown). The reasoning was:
re-syncing the dev-side `.github/skills/tribunal/` copy is a file copy and
belonged inside 237, but the public docs site is a genuine writing job that would
have pulled `technical-content-writer` into a frontend feature task and risked
publishing docs for a UI that had not shipped.

The UI has now shipped — `06cf3ed68 feat(webview): launch Relay and Crucible from
the Tribunal panel`. So the docs can describe what exists rather than what was
planned.

## Current state on disk

| Location                                                                          | Tribunal content                                                        |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/tribunal/references/` | council, crucible, forge, race, relay, vendor-panel (6) — authoritative |
| `.github/skills/tribunal/references/`                                             | same 6, byte-identical (re-synced by TASK_2026_237 B0/B6)               |
| `apps/ptah-docs/src/content/docs/tribunal/`                                       | council, forge, race, relay, index — **no crucible, no vendor-panel**   |

## What is actually wrong with the docs today

1. **No Crucible page at all.** The move exists, ships in the skill, and is now
   launchable from the panel. The docs do not mention it.
2. **`index.md` says four moves.** It needs to say five and link the new page.
3. **Starlight sidebar wiring** — a new page is invisible until it is registered.
4. **Hardcoded vendor lists.** Commit `5cdb14d89` set out to replace hardcoded
   `codex | copilot | cursor` enumerations with discovery-driven language and only
   half-finished; the docs copies still carry the old lists. Any list written down
   is wrong on somebody's machine — adapters ship every release and every install
   configures different providers.
5. **No mention of the panel.** Every page describes the moves as chat-triggered.
   Council, Forge, Race, Relay and Crucible are now all launchable from the
   Tribunal panel, with role slots for Relay and Crucible, a rubric step and a
   round cap for Crucible, and live phase/round progress.

## Scope

**In scope**

- A Crucible page: the executor/judge asymmetry, the frozen rubric, the defect
  contract (`file:line` required), the mentor note, the round cap of 2, the
  regression stop, and "the judge's PASS is an opinion; the build is the fact".
- `index.md` updated to five moves.
- Starlight sidebar registration for the new page.
- Remove hardcoded vendor lists across the tribunal docs; describe selection as
  discovery-driven.
- Document the panel as a first-class entry point alongside the chat triggers.
- Consider whether a `vendor-panel` equivalent belongs on the docs site at all —
  it is conductor-protocol, arguably not user-facing. **Decide, do not default.**

**Out of scope**

- Changing the behaviour of any move. The shipped skill references are the
  authority; docs describe them.
- Editing `apps/ptah-extension-vscode/assets/plugins/**` or
  `.github/skills/tribunal/**` — those two are byte-identical and any edit must
  keep them so (see the warning below).

## Warning carried from TASK_2026_237

`.github/skills/` is **gitignored** (`.gitignore:190`). The byte-equality between
the shipped skill copy and the dev-side copy is enforceable **only** by an
explicit `cmp` — a diff review, `git status` or a PR will never reveal a
re-divergence. If this task touches either copy, mirror the edit and run:

```bash
for f in SKILL.md references/council.md references/crucible.md references/forge.md \
         references/race.md references/relay.md references/vendor-panel.md; do
  cmp "apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/tribunal/$f" \
      ".github/skills/tribunal/$f"
done
```

## Note on audience

The skill reference and the docs page are **not the same document with different
formatting**. The reference is protocol the conductor reads and follows; the docs
page explains to a human when to reach for the move and what it costs. Copying
the reference onto the docs site would be the easy wrong answer.

## Suggested executor

`technical-content-writer`, with a `visual-reviewer` pass if screenshots of the
panel are added.
