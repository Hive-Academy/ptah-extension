---
title: Notifications and Tray
description: See what needs you in the notification center, get desktop notifications, and pause memory from the tray icon.
---

# Notifications and Tray

PtahCode tells you when an agent needs you. It uses the notification center in the title bar, short pop-up notices in the window, and desktop notifications of your operating system. The tray icon lets you pause memory and quit the app.

## The notification center

The **Notifications** bell is in the title bar. When requests wait for you, the bell shows the count, for example "Notifications, 2 need your response".

Click the bell to open the **Notifications** panel. The panel has two lists.

### Needs you

**Needs you** lists the requests that wait for your response. Each item shows the type of request, the session name, and the workspace name. The types are:

- **Question needs an answer**
- **Permission required**
- **Lane permission required**

Use the buttons on the item to respond:

- For a question, click **Answer**.
- For a permission request, click **Allow** or **Deny**.

If the session is not available, the button is disabled and shows **Session unavailable**. When no request waits, the list shows **Nothing needs your response**.

### Recent notices

**Recent notices** lists recent events, for example "Session failed: _session name_". Click **Show in canvas** to go to the session. Click the dismiss button to remove one notice.

When there are no notices, the list shows **No recent notices**.

### Panel actions

- Click **Clear all notices** to remove all recent notices.
- Click **Mute notification sounds** to turn off the sounds. Click **Unmute notification sounds** to turn them on again.

When nothing needs you and there are no notices, the panel shows **All clear**.

## Pop-up notices

When the panel is closed, new items also show as pop-up notices in the window. Each notice has the same buttons as the item in the panel. Click the dismiss button to hide a notice. When there are more notices than the window can show, click **+_N_ more** to open the panel.

## Desktop notifications

When an agent needs you and the PtahCode window is not focused, PtahCode also sends a notification through your operating system. The notification shows the request and the session name. When more than one request arrives at the same time, one notification shows the count, for example "3 requests need you".

Click the notification to show the PtahCode window and go to the request.

PtahCode sends desktop notifications only when your operating system supports them.

## The tray icon

PtahCode always adds an icon to the system tray. Its menu has these items:

| Item              | What it does                                                                         |
| ----------------- | ------------------------------------------------------------------------------------ |
| **Pause memory**  | A check box. When it is checked, memory is paused. It sets `memory.enabled` to `false`. |
| **Quit PtahCode** | Closes the app.                                                                      |

The tooltip of the icon shows **PtahCode**. When memory is paused, it shows **PtahCode — memory paused**.

The **Pause memory** setting is saved in `~/.ptah/settings.json`. It also pauses memory in other PtahCode processes that use the same file. When the setting changes in that file, the tray menu updates.

For the memory settings, refer to [Memory settings](/memory/settings/).

## Next steps

- [Orchestra Canvas](/canvas/)
- [Session details](/canvas/session-inspector/)
- [Autopilot](/chat/autopilot/)
