# Implementation Plan Review (Revision 2): TASK_2026_580_9f77

VERDICT: APPROVED

Scope: only the r1 Major (the `bindRefused` object return) and the two
coordination questions. The rest of the plan was not re-reviewed.

## Answers

**1. The r1 defect is RESOLVED, and the claimed code facts hold.**

- `bindRefused` keeps its boolean signature and body, and both truthiness call
  sites stay untouched (plan :1085-1092). Code today is exactly that:
  `sdk-agent-adapter.ts:1017` (resume) and `:1130` (new chat) test
  `this.bindRefused(...)` for truthiness, and `:1187-1210` returns a boolean.
  The always-truthy-object break can no longer happen.
- `SessionLifecycleManager.find(idOrTabId)` delegates to the registry
  (`helpers/session-lifecycle-manager.ts:407-409`), and
  `SessionRegistry.find` is `byTabId.get(id) ?? bySessionId.get(id)`
  (`session-registry.service.ts:346-348`). Verified.
- The inference "defined `previousSessionId` + accepted bind ⇒ `'rebound'`"
  (plan :1104-1110) is sound. `bindRealSessionId` acts only on the record from
  `byTabId.get(tabId)` (`session-registry.service.ts:297`). Every accepted
  outcome therefore requires a `byTabId` hit — and then `find(tabId)`
  short-circuits to that SAME record, so the prior id read belongs to the
  record that was bound. The branch order closes the rest:
  - prior id null → `'bound'`; `readReboundSource` returns `undefined` (null
    check) — no false positive.
  - prior id equal to `realSessionId` → `'already-bound'`; the differs check
    returns `undefined`.
  - prior id different, owner token matches → `'rebound'`; the read returns
    the prior id. Correct rekey.
  - prior id different, token mismatch → `'stale-mismatch'` is REFUSED, so
    the callback returns at `:1130` and the payload is never sent
    (`session-registry.service.ts:310-324`). The plan says this (:1109-1110).
  - One case the plan does not name: `byTabId` miss with a `bySessionId` hit
    (the tab id string equals some session id). `find` then returns another
    record and `readReboundSource` can return an id — but the bind answers
    `'no-record'` (`:297-302`), is refused, and the payload is never sent. The
    wrong value is unreachable as a rekey. No defect.
- The read is placed BEFORE the `:1130` guard (plan :1101-1103). This order is
  required and correct: `'rebound'` mutates the record's id at
  `session-registry.service.ts:321`, so a read after the bind would return the
  new id and the differs check would yield `undefined`. Both statements are
  synchronous, so no race sits between them.
- The regression specs cover the defect directly: a resume with a `tabId` and
  an accepted bind still calls `metadataStore.touch` and fires both resolve
  notifications, and the spec fails if the `:1017` guard becomes always-truthy
  (plan :1136-1140). The `readReboundSource` case table (:1141-1145) matches
  the code semantics.

**2. The 584 merge point is still compatible (plan :1473-1488).**

584 Component 1 edits the `createSessionIdCallback` parameter list and the
`metadataStore.create(...)` call (584 plan :231-237). 580 Revision 2 adds one
statement before the `:1130` guard, the optional `previousSessionId` in the
`:1155-1159` payload, and one new private method. Neither task touches
`bindRefused` or `:1017`. The statements are different, and neither edit
changes the other's inputs. Verified against the current code layout:
the coordination section moved exactly +28 lines (:1445 → :1473), which
cross-checks the plan's own line-shift note (:1740-1742). Compatible in either
merge order.

**3. No new Blocker or Major was introduced by Revision 2.**

The Revision 2 approach is the lower-risk shape: the boolean contract stays,
the new method is read-only, and the soundness argument holds in every branch.
The only unlisted case (the `bySessionId` fallback of `find`) is unreachable
as a wrong rekey, as shown above. Nothing else in the changed text
(:1085-1145, :1473-1488, :1735-1765) contradicts the code.

## New defects

None.
