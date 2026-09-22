---
id: TASK_2026_528_5d1e
status: backlog
type: REFACTORING
title: >-
  Four backend libraries inherit strict false, so a Zod-inferred type from the
  libs/shared barrel cannot compile in them
description: >-
  tsconfig.base.json sets strict to false. Twenty-five of the twenty-nine
  backend libraries override it with strict true in their own tsconfig. Four do
  not, and those four inherit the loose setting: auth-providers-tokens,
  memory-contracts, settings-core and voice-contracts. A type that Zod infers
  and that the libs/shared main barrel exports does not compile under the loose
  setting, because Zod 4 relies on strict null checks to produce the inferred
  shape. TASK_2026_493 works around this today with a types and schemas split
  that keeps the inferred types out of the main barrel. The split contains the
  problem. It does not cure it, and every future contract pays the same tax.
  Turn strict on in those four libraries and measure what breaks.
---

# Four backend libraries inherit strict false

See `context.md`.
