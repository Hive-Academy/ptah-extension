---
id: TASK_2026_858_f7b9
status: in_progress
type: FEATURE
title: Remote workers and a mobile-first Ptah PWA
description: >-
  One interface controls Ptah on several machines (LAN fleet, VPS), plus an installable
  mobile-first PWA that users reach from anywhere to start, watch and approve sessions.
depends_on: []
created: 2026-11-01T01:35:00.000Z
updated: 2026-11-01T01:35:00.000Z
---

## Description

Worker-owned headless Ptah services on each machine, reached through a transport-independent
WebSocket RPC with pairing and scoped tokens. Electron is the first client (Machines view); an
installable mobile-first PWA is the second. Includes event log and replay, transcripts,
transports (SSH, Tailscale, Cloudflare Tunnel with Access), provisioning (`ptah fleet add`) and
the VPS case. Inputs: Council answers in `.ptah/specs/council-remote-machines/`.
