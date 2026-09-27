---
id: TASK_2026_575_fee7
status: in_progress
type: FEATURE
title: Bilingual English and Arabic i18n for the landing page
description: >-
  Add Transloco-based English/Arabic (RTL) i18n to ptah-landing-page via a shared Nx i18n library reusable later by the Electron/webview app.
depends_on: []
created: 2026-09-27T11:35:00.000Z
updated: 2026-09-27T11:35:00.000Z
---

## Description

Make ptah-landing-page bilingual (English + Arabic with right-to-left layout) using @jsverse/transloco,
with a shared, framework-level Nx i18n library (per-lib translation scopes) that the Electron renderer
(ptah-extension-webview) can adopt in a follow-up task. Landing page first; Electron later.
