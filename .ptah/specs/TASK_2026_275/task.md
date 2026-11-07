---
id: TASK_2026_275
status: backlog
type: refactoring
title: >-
  Extract an injectable store from external-marketplaces.component.ts
updated: 2026-11-07T00:00:00.000Z
description: >-
  `external-marketplaces.component.ts` (1055 lines) runs five state machines in one class.
  Move its RPC orchestration into an injectable store so each concern can be tested alone.
---

# Split the external-marketplace surface

Machine-owned metadata carrier. Prose lives in `./context.md`.

## Description

`libs/frontend/marketplace/src/lib/external-marketplaces.component.ts` owns five concerns:
marketplace list CRUD, add-form validation, per-source browse expansion, the two-call
consent/install state machine, and uninstall. The Angular mechanics are correct (OnPush,
signals, `inject()`), so this is structure, not a defect. Remaining work:

- Extract the RPC orchestration into an injectable store, following the stores in
  `libs/frontend/marketplace/src/lib/data/` (for example `connector-links.store.ts`).
- Keep the component as a thin view. Split the spec so browse tests no longer load the install
  state machine.

## Current state (2026-11-07)

- Not started. The component grew from 961 to 1055 lines, and its spec from 706 to 1035 lines
  (`external-marketplaces.component.spec.ts`).
- Child pieces already exist as separate components (`external-plugin-row.component.ts`,
  `external-installed-row.component.ts`, `external-consent-dialog.component.ts`), but no store
  holds the state.
