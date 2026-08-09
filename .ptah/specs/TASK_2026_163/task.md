---
id: TASK_2026_163
status: in_review
type: REFACTORING
title: Purge premium feature gating (open-source move) + in-app Builders promotion
description: Remove isPremium/FeatureGate gating from all local single-user features across the app, repoint subscription surfaces to Builders membership/support, and add a tasteful in-app community/training promotion card. Keep license server + auth infra as membership identity.
assignee:
depends_on: []
executor:
claim:
created: 2026-07-18T00:00:00.000Z
updated: 2026-07-18T00:00:00.000Z
---

## Description

Product-side elevation for the open-source strategy approved 2026-07-18: Ptah goes fully open source with **no gated local features**. Monetization moves to Ptah Builders membership (training + community + support), with the hosted/team layer reserved as the future paid product (open-core boundary).

Scope:

1. Map and remove all premium gating on local single-user features: `FeatureGate` (vscode-core), `isPremium` filters, setup-wizard premium gating, trial-ended lockouts, license-check enforcement paths in extension/Electron/CLI runtimes.
2. Keep (do NOT delete): license server, WorkOS auth, Paddle billing, landing-page portal — repurposed as membership identity. Local app must be fully functional signed-out.
3. Repoint upsell/subscription surfaces (trial banners, upgrade CTAs, pricing links in-app) to Builders membership framing.
4. Add one tasteful in-app promotion surface: dashboard card promoting community/training (no modals, no nags).
