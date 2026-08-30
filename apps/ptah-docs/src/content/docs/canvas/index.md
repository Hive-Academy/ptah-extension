---
title: Orchestra Canvas
description: Run up to nine chat sessions side by side on one drag-and-resize grid.
---

The **Orchestra Canvas** is a grid of live chat tiles. Each tile is a full chat
session with its own conversation, its own agent, and its own model. You can run
up to **nine** at once, drag them into any arrangement, and watch them all work
in parallel.

This is the surface Ptah opens on in the desktop app.

## Why a grid

One conversation is a bottleneck. A long refactor blocks the quick question you
wanted to ask, and a background research task blocks both.

The canvas removes that queue. Give each concern its own tile:

- One tile drives the feature you are building.
- One tile runs a review pass over the diff.
- One tile researches the library you are about to adopt.
- One tile watches the test suite.

Each tile keeps its own context window. Work in one never pollutes another.

## Layout modes

The chat area has two layout modes.

| Mode       | What you see                   |
| ---------- | ------------------------------ |
| **Single** | One conversation, full width.  |
| **Grid**   | The canvas — up to nine tiles. |

The desktop app starts in **grid** mode. Switch modes from the layout control in
the chat header.

## Adding a tile

Click **Add new session tile** in the canvas toolbar. You can give the session a
name, or leave the field empty and let Ptah name it.

You can also promote an existing session onto the canvas. A session already open
as a tab becomes a tile without losing its history.

:::note[Nine is the cap]
The **Add** control switches off at nine tiles. This is not an arbitrary number.
Below nine, each tile stays wide enough to host a usable chat surface. Above it,
they do not.
:::

If you add a session that is already on the canvas, Ptah focuses the existing
tile instead of creating a duplicate.

## Arranging tiles

Drag a tile by its header to move it. Drag an edge or a corner to resize it. The
grid reflows around what you move.

The layout is responsive. Ptah recomputes the grid at two breakpoints, so a
narrow window stacks tiles rather than shrinking them past legibility.

### Locking the layout

Click the **lock** control in the toolbar to freeze every tile in place. Locked
tiles cannot be dragged or resized. Use this once you have an arrangement you
like and you want to stop moving it by accident while you work.

## Focus

One tile is the **focused** tile at any moment. Keyboard input and the model
selector apply to it. Click a tile to focus it.

The focused tile stays in sync with the tab bar. Focusing a tile on the canvas
selects the same session in the tab list, and the reverse is also true.

## Per-tile agent status

Each tile carries an agent indicator in its header. It shows which agent is
active in that tile and whether the tile is currently streaming a response.

Click the indicator to open a mini panel with that tile's agent detail, without
leaving the canvas or losing your place in the other eight.

## Closing a tile

Close a tile from its header. Closing a tile removes it from the grid. The
session itself survives — it stays in your [session history](/sessions/session-history/)
and you can bring it back onto the canvas later.

## Per-workspace layouts

Canvas layouts are scoped to the workspace. Switching workspaces gives you that
workspace's own arrangement of tiles, not a shared one.

## Opening it in VS Code

The canvas is not Electron-only. In the VS Code extension, run **Ptah: Open
Orchestra Canvas** from the Command Palette. See the
[VS Code extension](/vscode-extension/) page.

## Next steps

- [Send your first message](/chat/sending-messages/) in a tile
- [Switch models](/chat/switching-models/) per tile
- [Spawn CLI agents](/agents/cli-agents/) for work that does not need a tile
- [Run a Tribunal](/tribunal/) when you want several vendors on one problem
