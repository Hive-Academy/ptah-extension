---
id: TASK_2026_240
status: done
type: DEVOPS
title: Enforce content-manifest.json regeneration in CI
description: >-
  scripts/generate-content-manifest.js exists, works, and says "Run before each
  release" — but it is referenced by no npm script and by none of the 16
  workflows in .github/workflows, including publish-extension.yml. Nothing
  enforces it. The manifest silently went stale for five days, and because
  pruneStaleFiles deletes any local file the manifest omits, a stale manifest
  does not merely withhold new content — it removes content users already have.
updated: '2026-08-25T21:11:05.147Z'
---

# Enforce content-manifest.json regeneration in CI

Fixes the **class** of defect that TASK_2026_237 hit an instance of. That task
regenerated the manifest by hand; nothing stops the next skill edit from
reproducing the same silent failure.

Prose lives in `context.md`.
