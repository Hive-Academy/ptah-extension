# Surface catalog reference

Every component of a `ptah_surface_update` surface, one JSON example per kind. Each example is a single component, valid inside an envelope with `schemaVersion` `"dashboard-spec/2"` and `catalogVersion` `"dashboard-catalog/3"`:

- `surfaceId` and every component `id` match `^[A-Za-z0-9][A-Za-z0-9._-]*$` (no colon) and are unique across the surface.
- `components` is a non-empty array. Layout kinds take `children`; input kinds bind a `path` into the optional `dataModel`; display kinds take no `children`.
- Text fields are RichText objects such as `{ "text": "..." }`, plain text only: no markdown, no HTML. No kind has a `class`, `style` or `html` field, and any unknown key rejects the whole document.
- Every string is at most 2,000 characters. A surface holds at most 200 components, nesting depth 8, 50 children per layout node, 100 inputs.
- `dashboard.select` marks a component the user can pick; `dashboard.open-url` is the only action that carries `url` (allowlisted scheme); `surface.submit` submits a form and takes no `params`. Action `params` values are scalars only. At most 8 actions per component.

## Layout kinds

### section

A titled container. Required: `id`, `title`, `children`. Optional: `description`, `actions`.

```json
{
  "kind": "section",
  "id": "summary",
  "title": { "text": "Build summary" },
  "description": { "text": "Latest pipeline run" },
  "children": [
    {
      "kind": "stat",
      "id": "summary-coverage",
      "title": { "text": "Coverage" },
      "value": 84.2,
      "unit": "%"
    }
  ]
}
```

### stack

A one-dimensional row or column. Required: `id`, `children`. Optional: `direction` (`vertical` or `horizontal`), `gap` (`none`, `small`, `medium` or `large`), `actions`.

```json
{
  "kind": "stack",
  "id": "status-row",
  "direction": "horizontal",
  "gap": "medium",
  "children": []
}
```

### grid

A column grid. Required: `id`, `columns` (integer 1 to 4), `children`. Optional: `gap`, `actions`.

```json
{
  "kind": "grid",
  "id": "metric-grid",
  "columns": 2,
  "gap": "small",
  "children": []
}
```

### card

A boxed container. Required: `id`, `children`. Optional: `title`, `description`, `actions`.

```json
{
  "kind": "card",
  "id": "release-card",
  "title": { "text": "Release 1.2" },
  "description": { "text": "Items before the freeze" },
  "children": []
}
```

## Input kinds

Input `label` fields are plain strings, not RichText objects. Each input reads and writes one `path` in the data model; `path` segments match `^[A-Za-z_][A-Za-z0-9_-]*$` and a path has at most 8 segments. Two inputs may share a path only with the same value type and the same option values, and no two inputs bind overlapping paths.

### text

Required: `id`, `label`, `path`. Optional: `description`, `placeholder`, `multiline`, `hints` (`required`, `minLength`, `maxLength`; `minLength` must not exceed `maxLength`).

```json
{
  "kind": "text",
  "id": "branch",
  "label": "Branch",
  "path": "form.branch",
  "placeholder": "main",
  "hints": { "required": true, "minLength": 1, "maxLength": 40 }
}
```

### select

Required: `id`, `label`, `path`, `options` (1 to 50 items, each `{ "value": ..., "label": ... }`; option values are unique, at most 200 characters). Optional: `hints.required`. A missing path reads `null`.

```json
{
  "kind": "select",
  "id": "environment",
  "label": "Environment",
  "path": "form.environment",
  "options": [
    { "value": "dev", "label": "Development" },
    { "value": "prod", "label": "Production" }
  ],
  "hints": { "required": true }
}
```

### radio-group

Same fields and rules as `select`; a missing path reads `null`.

```json
{
  "kind": "radio-group",
  "id": "strategy",
  "label": "Deploy strategy",
  "path": "form.strategy",
  "options": [
    { "value": "rolling", "label": "Rolling" },
    { "value": "blue-green", "label": "Blue-green" }
  ]
}
```

### checkbox

Required: `id`, `label`, `path`. Optional: `hints.required`. A missing path reads `false`.

```json
{
  "kind": "checkbox",
  "id": "notify",
  "label": "Notify on failure",
  "path": "form.notify",
  "hints": { "required": true }
}
```

## Display kinds

### stat

One number or short string with a label. Required: `id`, `value` (string or number). Optional: `title`, `description`, `actions`, `unit`, `delta`. The selection target of a selectable stat is `{ "kind": "stat" }`.

```json
{
  "kind": "stat",
  "id": "coverage",
  "title": { "text": "Coverage" },
  "value": 84.2,
  "unit": "%",
  "delta": 1.5,
  "actions": [
    {
      "id": "coverage-select",
      "action": "dashboard.select",
      "label": { "text": "Select" }
    }
  ]
}
```

### line-chart

Points joined over an ordered x axis. Required: `id`; exactly one of `series` or `data` (a `{ "resultId": ... }` reference the host resolves). Optional: `title`, `description`, `actions`, `xLabel`, `yLabel`. Each series has `name` and `points` of `{ "x": ..., "y": ... }`; at most 1,000 points summed across series. The selection target is `{ "kind": "chart-point", "seriesIndex": ..., "pointIndex": ... }`.

```json
{
  "kind": "line-chart",
  "id": "build-duration",
  "title": { "text": "Build duration" },
  "xLabel": { "text": "Run" },
  "yLabel": { "text": "Minutes" },
  "series": [
    {
      "name": "main",
      "points": [
        { "x": "r1", "y": 3 },
        { "x": "r2", "y": 5 }
      ]
    }
  ]
}
```

### bar-chart

Same fields and rules as `line-chart`; points render as bars.

```json
{
  "kind": "bar-chart",
  "id": "flaky-suites",
  "title": { "text": "Flaky suites" },
  "xLabel": { "text": "Suite" },
  "yLabel": { "text": "Failed runs" },
  "series": [
    {
      "name": "flakes",
      "points": [
        { "x": "login", "y": 2 },
        { "x": "billing", "y": 5 }
      ]
    }
  ]
}
```

### table

Required: `id`, `columns` (1 to 50 items of `{ "key": ..., "label": ..., "align": ... }`, `align` is `left`, `center` or `right`). Exactly one of `rows` or `data`; each row has exactly one scalar cell per column, at most 1,000 rows. Optional: `title`, `description`, `actions`. The selection target is `{ "kind": "table-row", "rowIndex": ... }`.

```json
{
  "kind": "table",
  "id": "changed-files",
  "title": { "text": "Changed files" },
  "columns": [
    { "key": "path", "label": { "text": "Path" }, "align": "left" }
  ],
  "rows": [
    ["src/main.ts"],
    ["src/util.ts"]
  ],
  "actions": [
    {
      "id": "changed-files-select",
      "action": "dashboard.select",
      "label": { "text": "Select file" }
    }
  ]
}
```

### list

Required: `id`; exactly one of `items` or `data`. Each item is `{ "text": ..., "detail": ..., "url": ... }` with only `text` required; at most 1,000 items. Optional: `ordered`, `title`, `description`, `actions`. The selection target is `{ "kind": "list-item", "itemIndex": ... }`.

```json
{
  "kind": "list",
  "id": "open-checks",
  "title": { "text": "Open checks" },
  "ordered": true,
  "items": [
    { "text": { "text": "Lint" }, "detail": { "text": "Clean" } },
    { "text": { "text": "Docs" }, "url": "https://example.com/docs" }
  ]
}
```

### alert

A status message. Required: `id`, `tone`, `text`. `tone` is closed: `info`, `success`, `warning` or `error`. Optional: `title`. With only `tone` and `text` it reads as a short inline note. The host announces `warning` and `error` assertively. No other key is accepted: no `children`, no `actions`, no class or style.

```json
{
  "kind": "alert",
  "id": "deploy-queued",
  "tone": "info",
  "text": { "text": "The release pipeline starts within two minutes." }
}
```

### badge

A short status label. Required: `id`, `tone`, `text`. `tone` is closed: `neutral`, `primary`, `info`, `success`, `warning` or `error`. Optional: `actions`, at most 8, and the only allowed action is `dashboard.select` (no `url` on a badge action). A badge with a `dashboard.select` action is the only interactive one; the selection target is `{ "kind": "badge" }`.

```json
{
  "kind": "badge",
  "id": "build-status",
  "tone": "success",
  "text": { "text": "Passing" },
  "actions": [
    {
      "id": "build-status-select",
      "action": "dashboard.select",
      "label": { "text": "Select" }
    }
  ]
}
```

### progress

A linear share of a whole. Required: `id`, `value`, `tone`, `label`. `value` is a finite number from 0 to 100; decimals are allowed. `tone` is closed: `neutral`, `primary`, `info`, `success`, `warning` or `error`. `label` is RichText and is the accessible name. No other key is accepted.

```json
{
  "kind": "progress",
  "id": "upload",
  "value": 42.5,
  "tone": "info",
  "label": { "text": "Uploading artifacts" }
}
```

### radial-progress

The same fields and rules as `progress`; the value drives the arc.

```json
{
  "kind": "radial-progress",
  "id": "disk-usage",
  "value": 73,
  "tone": "warning",
  "label": { "text": "Disk usage" }
}
```

### divider

A rule between content. Required: `id`, `direction`, closed as `horizontal` or `vertical`: `horizontal` separates content stacked vertically, `vertical` separates content laid side by side. Optional: `text`, plain RichText rendered on the rule. No other key is accepted.

```json
{
  "kind": "divider",
  "id": "header-rule",
  "direction": "horizontal",
  "text": { "text": "Details" }
}
```

### text-block

Static text. Required: `id`, `text`, `role`. `role` is closed: `heading` or `body`; `heading` renders as a heading element, `body` as a paragraph. `text` is non-empty, at most 2,000 characters, plain text only. No other key is accepted.

```json
{
  "kind": "text-block",
  "id": "release-heading",
  "text": { "text": "Release 1.2 readiness" },
  "role": "heading"
}
```