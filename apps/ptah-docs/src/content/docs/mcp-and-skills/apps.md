---
title: Apps
description: Ask an agent to build interactive apps, such as dashboards and forms, and use them next to the conversation.
---

# Apps

The **Apps** tab is a page where an agent builds interactive apps for you, for example a dashboard or a form. You talk to the agent in a conversation column. The app shows in a panel next to the conversation.

The Apps conversation is for this page only. Your coding chat is not changed.

## Open the page

Click the **Apps** tab in the tab bar.

## Page layout

| Area                    | What it shows                                                        |
| ----------------------- | -------------------------------------------------------------------- |
| Conversation column     | The **Apps** heading, the conversation, and the message box          |
| Divider                 | A handle that changes the width of the conversation column           |
| App panel               | The apps that the agent built                                        |

When the page is narrow, the columns show one above the other and the divider is hidden.

When you leave the tab and come back, the page shows the same conversation and apps for the workspace.

## Build an app

1. Click the **Apps** tab.
2. Type a request in the message box, for example a dashboard of open tasks.
3. Push Enter, or click **Send**. Push Shift+Enter to add a new line.
4. Wait for the agent. The agent builds the app with the `ptah_surface_update` tool, and the app shows in the app panel.
5. Send more messages to change the app.

Before you send the first message, the app panel shows **No app yet**.

While the agent works, click **Stop** to stop the turn. When no turn runs, **Stop** is disabled.

When the agent asks for permission to use a tool, or asks you a question, a card shows in the conversation. Reply in the card.

To start again, click **New conversation**.

## Use an app

- **Forms** — fill in the fields and submit the form. The submitted values go to the agent as a message. The panel then shows **Last submitted at** and the time.
- **Selection** — click an item, for example a table row, a list item, or a chart point. When you then write "this row" or "the selected item", the agent reads your selection from the app.

When the agent built more than one app, a row of tabs (**Open apps**) shows above the panel. Click a tab to show that app. You can also use the Left and Right arrow keys, Home, and End.

When an app cannot show, the panel shows **This app could not be shown.**

## Change the column width

- Drag the divider between the conversation and the app panel.
- Or focus the divider and push the Left or Right arrow key. Hold Shift to move it in larger steps.

PtahCode keeps the app panel at a minimum width of 360 pixels. PtahCode saves the width with your other panel widths.

## Related

- [MCP & Skills](/mcp-and-skills/)
- [Ptah tools](/mcp-and-skills/ptah-tools/)
