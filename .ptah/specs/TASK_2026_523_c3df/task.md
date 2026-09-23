---
status: done
type: feature
title: 'Providers & Auth: one settings surface, truthful active route, guided setup'
description: >-
  Replace the scattered provider/model settings (authMethod, ptahCliAgents,
  memory.curatorProvider, skillSynthesis.<lane>.provider,
  skillSynthesis.judgeModel) with one Providers surface. Show the EFFECTIVE auth
  route rather than the stored authMethod enum, surface global vs per-workspace
  scope, add a guided provider setup wizard with vendor marks, and land the
  three skill-enhancement fixes.
updated: '2026-09-23T14:41:52.495Z'
---

# Providers & Auth consolidation

One settings surface for every provider and model choice in Ptah, a truthful
display of what is actually authenticating, visible config scope, and a guided
setup flow.

Narrative and the originating diagnosis live in `context.md`.
Batch breakdown lands in `batches.md`.
