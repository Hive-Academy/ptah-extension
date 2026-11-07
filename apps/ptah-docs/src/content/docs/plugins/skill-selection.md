---
title: Per-Project Skill Selection
description: Choose which of your skills each project gets.
---

PtahCode keeps one editable copy of each skill that you have under `~/.ptah/user/skills`. This folder is one for each computer. Per-project selection decides which of those skills a project gets.

## A new project starts with no skills selected

When you open a new project, PtahCode does not copy any of these skills into it. The Dashboard (**Analytics** in the tab bar) shows the card **No skills selected for this project yet**. Click **Choose skills…** to open the picker.

## Choose skills

The picker is the **Skills for this project** section of the **Configure Ptah Skills** panel:

- **All of them** — every skill installed for all workspaces, plus the skills installed for this workspace.
- **Only the ones I pick** — a list of all skills with a count of the skills that you selected. Select the skills for this project.

Skills installed for this workspace always reach it.

Include `agent-lanes` when you select `orchestration` for CLI work, or `tribunal`. The picker does not select required skills for you. See [skill dependencies](/mcp-and-skills/skills/#skill-dependencies).

Click **Save Configuration** to apply the selection.

## Existing projects

A project that already received skills before this choice existed keeps the skills that it had. You can change the selection at any time.

## Next steps

- [Turn off individual skills](/plugins/skill-toggles/)
- [Enable and disable plugins](/plugins/installing/)
