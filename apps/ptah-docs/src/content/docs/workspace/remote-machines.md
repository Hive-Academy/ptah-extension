---
title: Remote Machines
description: What the PtahCode desktop app does with remote machines, and what you can control from the app.
---

# Remote Machines

The PtahCode desktop app has a service that connects to PtahCode workers on other computers over SSH. This page tells you what that service does on your computer.

:::note
The app has no screen to add, pair, or manage remote machines. You cannot start a remote session from the app.
:::

## What the desktop app does

- **Registry** — PtahCode keeps the list of registered machines in `~/.ptah/remote-machines.json`.
- **Connection at start** — when the app starts, PtahCode tries to connect to each registered machine. When a connection fails, PtahCode writes a warning to the log and continues to start.
- **SSH transport** — PtahCode connects with your `ssh` command and a host alias from `~/.ssh/config`. It uses SSH batch mode, so SSH does not ask for a password. The connection goes to the worker on port `41873` of the remote host.
- **Tokens** — PtahCode keeps the token of each machine in the secret storage of the app. When the platform keyring is not available, the tokens are stored in plain text.

When `~/.ptah/remote-machines.json` has no machines, PtahCode does not connect to a remote machine.

## Related

- [Opening a workspace](/workspace/opening-a-workspace/)
- [Logs and diagnostics](/troubleshooting/logs-and-diagnostics/)
