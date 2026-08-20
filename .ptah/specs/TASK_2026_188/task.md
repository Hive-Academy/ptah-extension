---
id: TASK_2026_188
status: done
type: BUGFIX
title: 59 @IsOptional() fields across libs/api accept an explicit null straight into service code
description: >-
  class-validator's @IsOptional() skips every validator on a property for null as well as undefined, so a client sending {"field": null} to a dtoPipe-bound endpoint passes validation untouched and the null reaches a service typed as though it cannot exist. Batch 6.1 swept twelve of these out of the forum after measuring live 500s, and TASK_2026_177 Batch 12 built the class-wide answer — IsOptionalNotNull() plus a nullable-dto.spec.ts census — but only wired it into forum, learning and live-sessions. A full re-count of libs/api finds 70 @IsOptional() decorators, of which 11 sit on genuinely nullable declared types and 59 do not. All 59 are on DTO classes bound to dtoPipe, so every one is reachable from unauthenticated or admin client input. Batch 12 named only three files and estimated ~30; the three files are exact at 30 defects but the tree holds 29 more in libs/api/admin, identity, licensing and marketing that nothing guards.
assignee:
depends_on: []
executor:
claim:
created: 2026-08-09T00:00:00.000Z
updated: 2026-08-09T00:00:00.000Z
---

## Description

Machine-owned metadata carrier. Prose lives in `./context.md`.
