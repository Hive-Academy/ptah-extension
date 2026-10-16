# Batch 41b report: ptah_outcome_report P5 final-review fixes

Scope: defect 1 (Serious) of `reviews/p5-final-code-logic-review.md` and defect D1 (Moderate) of
`reviews/p5-final-code-style-review.md`. Paths are relative to
`libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/`.

## Changes

### Defect 1: VS Code "not found" codes

- `tools/outcome-report.tool.ts:61-75`: `isNotFound` now accepts `ENOENT`, `ENOTDIR`, `FileNotFound` and
  `FileNotADirectory` through a `NOT_FOUND_CODES` set. The comment names the source of each pair (Node
  `fs` and `vscode.workspace.fs` `FileSystemError`). Any other code still logs `Deliverable stat failed`
  and returns `recorded: false` with `deliverable stat failed for <entry>`.
- No shared helper exists in a lib that vscode-lm-tools may import. The two existing checks
  (`lane-routing/.../capability-matrix.store.ts:629`, `task-specs/.../task-scanner.service.ts:80`) are
  private to their libs. The helper therefore stays local.

### Defect D1: published schema

- `tools/outcome-report.tool.ts:38-59`: the hand-written flattener and the `stringArray` helper are
  gone. `outcomeInputSchema` generates the whole `OutcomeReportArgsSchema` with `z.toJSONSchema`
  (draft-7, input), strips `$schema` as `surface-tools.ts` does, and calls the exported
  `flattenOperationUnion(fragment, 'kind')` (import at `:13`). It still throws at tool-build time when
  the published `kind` enum does not have one value per zod option (`:51-57`). Runtime validation is
  still `OutcomeReportArgsSchema.parse` in `runOutcomeReport`.
- `surface-tools.ts:64-145`: a small generalization of `flattenOperationUnion`, needed because the outcome
  union has two shapes the surface union lacks:
  - A field that every branch requires (`target`) now joins the top-level `required` (`:105-110`, `:143`)
    and gets no note. Before, it would have dropped out of `required` and got a note saying it was not
    allowed for any other kind.
  - A field that is optional in its branch (`taskKind`, `taskId`, `routingSource`) now says
    `Optional for kind deliverables`. Before, the note would have read `Required for kind ; ...`.
  - The `not allowed for any other <discriminator>` clause is added only when some branch lacks the
    field. Branch membership is tracked in `presentIn` (`:82`, `:100`).
  - Surface output does not change. Every surface field is required by some operations and missing
    from the rest, so each note is still `Required for operation X; not allowed for any other
    operation.` and `required` is still `['operation']`. The existing surface spec pins this.
- `route-tools.ts` still has its own private `flattenStageUnion`. It is outside this batch's files and
  is not touched (see the out-of-scope note below).

## Published schema, before and after

Before (`required: ['kind', 'target']`; no per-kind information):

```json
{
  "type": "object",
  "required": ["kind", "target"],
  "additionalProperties": false,
  "properties": {
    "kind": { "type": "string", "enum": ["deliverables", "review"] },
    "target": { "anyOf": [ ... ] },
    "paths": { "type": "array", "maxItems": 20, "items": { ... } },
    "taskKind": { "type": "string", "enum": [ ...OUTCOME_TASK_KINDS ] },
    "taskId": { "type": "string", "minLength": 1, "maxLength": 200 },
    "routingSource": { "type": "string", "enum": [ ...OUTCOME_ROUTING_SOURCES ] },
    "verdict": { "type": "string", "enum": ["approved", "rejected", "revise"] }
  }
}
```

After (same field schemas, same `required`; each per-kind field names its kind):

```json
{
  "type": "object",
  "required": ["kind", "target"],
  "additionalProperties": false,
  "properties": {
    "kind": { "type": "string", "enum": ["deliverables", "review"] },
    "target": { "anyOf": [ ... ] },
    "paths": { "type": "array", "maxItems": 20, "items": { ... },
      "description": "Required for kind deliverables; not allowed for any other kind." },
    "taskKind": { "type": "string", "enum": [ ... ],
      "description": "Optional for kind deliverables; not allowed for any other kind." },
    "taskId": { "type": "string", "minLength": 1, "maxLength": 200,
      "description": "Optional for kind deliverables; not allowed for any other kind." },
    "routingSource": { "type": "string", "enum": [ ... ],
      "description": "Optional for kind deliverables; not allowed for any other kind." },
    "verdict": { "type": "string", "enum": ["approved", "rejected", "revise"],
      "description": "Required for kind review; not allowed for any other kind." }
  }
}
```

The schema is still one closed top-level object with no `oneOf` and no `$schema`, the shape the sibling
tools publish.

## Spec cases

`tools/outcome-report.tool.spec.ts`:

- `:128` publishes one closed object that names the kind requiring each field. It checks: no `$schema`
  and no `oneOf`; `type: 'object'`; `additionalProperties: false`; `required` is `['kind', 'target']`;
  the `kind` enum; the exact property set; `target` has no description; the exact `paths` and `verdict`
  notes; and the `Optional for kind deliverables` note on `taskKind`, `taskId` and `routingSource`.
- `:118` (existing) checks the `taskKind` and `routingSource` enums. It still passes unchanged.
- `:205` `it.each(['FileNotFound', 'FileNotADirectory'])` stores a VS Code not-found deliverable as
  missing. A `FileSystemError`-shaped rejection is recorded as `held` with
  `checks: [{ exists: false, bytes: 0, mtimeMs: null }]`.
- `:229` returns `recorded: false` for another VS Code `FileSystemError` code. `NoPermissions` returns
  exactly `deliverable stat failed for plan.md`, with no submit and no held report.
- `:166` (ENOENT) and `:180` (EACCES): the existing cases are unchanged.

`surface-tools.spec.ts`:

- `:100` new `describe('flattenOperationUnion')` built on a hand-written two-branch fragment:
  - `:133` a field every branch requires goes into `required` and keeps its schema with no note.
  - `:138` exact notes for three cases: required in one branch only, optional in one branch only
    (appended after an existing description), and required in one branch while optional in the other
    (no "not allowed" clause).
- The existing surface cases (`required` equals `['operation']`, the `Required for operation ...;`
  notes, the growth guard) still hold, because the surface output is unchanged.

## Verification

- `ptah_get_diagnostics` on the four changed files (severity error): 0 errors, coverage clean.
- `npx prettier --write` on the four changed files: both specs were reformatted, both sources were
  already formatted.
- Not run, as the brief instructs: nx, jest and tsc. The orchestrator runs the scoped
  `npx nx test vscode-lm-tools --parallel=1`.

## Decisions

- Import `flattenOperationUnion` from `../surface-tools` rather than moving it to a new shared file.
  Options were (a) import it as it is, with a small generalization, or (b) extract it to a new file. The
  brief limits changes to these four files. The lib barrel (`src/index.ts:146`) already loads
  `surface-tools`, so the stdio tool builders gain no new dependency in practice. The choice is
  reversible.
- The `$schema` stripping (two lines) stays local, and the private `generate` in `surface-tools` is not
  exported. This keeps the surface-tools change limited to the flattener.

## Out-of-scope observations

- `route-tools.ts:49` `flattenStageUnion` is still a private copy of the same merge, with its own
  `isJsonObject` helper. It could now call `flattenOperationUnion(fragment, 'stage')`. Not touched
  because that file is outside this batch.
