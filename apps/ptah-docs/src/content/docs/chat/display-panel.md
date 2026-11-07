---
title: Display Panel
description: See the artifacts, files, and Ptah UI blocks that the agent sends to the Display panel, and open the panel in a separate window.
sidebar:
  order: 10
---

# Display Panel

The **Display** panel shows the visual output that the agent sends during a session. It is a sidebar at the right of the chat. Each session has its own Display items.

## What the panel shows

The panel can show these items:

- **Artifacts**: a self-contained visual page, for example a dashboard, a report, or a prototype. An artifact cannot use the network.
- **Files**: a Markdown file, an image, or a PDF file.
- **Ptah UI blocks**: short visual summaries that the agent writes in its message.

When the panel has no items, it shows **Nothing to show yet**.

## Open the panel

The panel shows only when the session has Display items. When the panel is collapsed, a vertical **Display · _N_** tab shows at the right edge. _N_ is the number of items.

1. Click the **Display · _N_** tab. The panel opens.
2. Select an item in the **Displays** tab strip. Use the **Left Arrow** and **Right Arrow** keys to move between items.
3. To close the panel, click **Collapse display**.

A dot on an item tab tells you that the item is new.

When the window is narrow, the panel opens over the chat.

## Keep the current view

When the agent sends a new or updated item, the panel can change to that item. To stop this, click **Keep current view**. New or updated items then do not change the selected item or scroll the panel. Click **Keep current view** again to turn it off.

## Artifacts in the transcript

Each artifact also shows as a card in the transcript. The card shows the title and the time that the agent made it.

- Click **Open** to select the artifact in the Display panel.
- Click **Full screen** to show the artifact in the full-screen viewer.

## Ptah UI blocks in the transcript

A Ptah UI block that the agent sends to the panel has a chip in the transcript. The chip shows the state of the block:

| State                    | Meaning                                                    |
| ------------------------ | ---------------------------------------------------------- |
| **Pending display**      | The block is not in the panel yet.                         |
| **In display**           | The block is in the panel.                                 |
| **Updated later**        | A newer version of the block is in the panel.              |
| **No longer in display** | The block left the panel.                                  |
| **Not in display**       | The block is not valid, so the panel cannot show it.       |

Click **Open in display** to select the block in the panel. For an updated block, click **Open latest**.

## Open the panel in a separate window

You can move the Display panel to its own window, **PtahCode - Display**.

1. Open the Display panel.
2. Click **Detach**. The panel opens in the **PtahCode - Display** window.

While the panel is in the separate window, the chat shows a narrow rail with **Display · _N_ (separate window)**:

- Click **Focus** to bring the **PtahCode - Display** window to the front.
- Click **Re-attach** to move the panel back into the chat.

The separate window shows the Display panel of the active session. When you close the Display window, the panel goes back into the chat. When you close the main window, the Display window also closes. PtahCode keeps the size and position of the Display window for the next time.

## Next steps

- [Sending messages](/chat/sending-messages/)
- [Composer and turn summary](/chat/composer-and-turn-summary/)
- [Orchestra Canvas](/canvas/)
