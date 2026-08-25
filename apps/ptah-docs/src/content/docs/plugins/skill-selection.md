---
title: Per-Project Skill Selection
description: A new workspace starts with no skills until you choose which ones to hand it — how to select, the "all of them" escape hatch, and what an upgraded project keeps.
---

Plugin enablement and skill toggles (see [Skill Toggles](/plugins/skill-toggles/)) both live in the same workspace record, but neither answers a more basic question: should _this_ skill even be a candidate for _this_ project? Per-project selection is the outer gate that answers it.

## A new workspace starts with nothing selected

Ptah keeps one editable copy of every skill you've ever acquired — from any plugin, on any project — under `~/.ptah/user/skills`, one folder per machine. Without a per-project gate, every workspace you open would see the same pile: open a React project after enabling an Angular plugin somewhere else, and Ptah would hand your React agent Angular skills it has no use for.

So a workspace you open for the first time propagates **no skills at all** until you choose. This isn't silence — the Dashboard shows a card:

> **No skills selected for this project yet**
> Ptah keeps each project's skills separate, so a new one starts empty rather than inheriting the last one's. Pick what this project should hand to Claude, Codex, Copilot and Cursor.

Click **Choose skills…** to open the picker.

## Choosing skills

The picker lives inside the same **Configure Ptah Skills** modal used for [plugin enablement](/plugins/installing/), in a new **Skills for this project** section above the plugin list:

- **All of them** — propagate everything the user layer offers. This is the escape hatch: pick it and you're opted back out of the per-project gate, subject only to plugin enablement and any per-skill toggle you've set.
- **Only the ones I pick** — reveals a scrollable, flat list of every skill available across every plugin, with a live `N of M skills selected` count. Tick what this project should use.

Click **Save Configuration** to apply. The selection is saved together with your plugin config in one click.

## If you're upgrading

**An existing workspace keeps everything it already had.** The selection gate didn't exist before this feature shipped, so on the first reconcile afterward Ptah checks whether any of its own manifests already record a skill copy in this workspace. If they do, that's read as consent already given — this project resolves to **All of them**, and nothing is removed. You'll never see the "no skills selected" card on a project that was already using skills.

Only a genuinely new workspace — one with no prior skill copies to lose — starts with **Only the ones I pick**, empty, waiting for a choice.

## Headless and CI equivalents

The CLI mirrors the desktop picker exactly, going through the same RPC calls, so a headless machine and the desktop app never disagree about what a workspace propagates:

```bash
# Propagate everything (the "All of them" escape hatch)
ptah skill select --all

# Propagate only these
ptah skill select orchestration ui-ux-designer

# See the current mode, the recorded allowlist, and every candidate
ptah skill selection
```

`ptah skill select` requires either `--all` or at least one slug — there's no default, because both `'all'` and a narrowed selection are real decisions with real consequences (narrowing removes every skill copy not on the list).

## Next steps

- [Turn off individual skills](/plugins/skill-toggles/)
- [Enable and disable plugins](/plugins/installing/)
- [Change your selection later](/plugins/managing/)
