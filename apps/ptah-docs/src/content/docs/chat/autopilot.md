---
title: Autopilot
description: Set which agent actions run without an approval prompt.
sidebar:
  order: 5
---

# Autopilot

Autopilot sets the approval mode of the session. When Autopilot is off, the mode is **Manual** and the agent asks for approval before each action. When Autopilot is on, the agent approves actions automatically at the permission level that you select.

![Autopilot toggle in the chat header](/screenshots/chat-autopilot-toggle.png)

## Turn on Autopilot

1. Click the approval chip in the composer. The chip shows the current mode.
2. Select a permission level.
3. Click **Enable Autopilot**.

To go back to Manual, open the chip and click **Disable Autopilot**.

## Permission levels

| Level         | What it does                                                         |
| ------------- | -------------------------------------------------------------------- |
| **Full Auto** | Approves all actions automatically. It skips all permission prompts. |
| **Auto-edit** | Approves file edits automatically. Other actions still ask.          |
| **Plan Mode** | Read-only analysis. It blocks file changes and code execution.       |

When the agent enters plan mode by itself, the chip shows **Plan Mode**.

## Scope of the setting

The enabled state is the saved default for new and resumed sessions. A change applies to the live session at once.

:::caution
Full Auto lets the agent run commands and change files without a prompt. Use it only for trusted tasks in a workspace that you trust.
:::
