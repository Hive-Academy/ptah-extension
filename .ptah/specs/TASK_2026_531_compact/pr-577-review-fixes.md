# PR #577 Review Fixes

## Fix 1 — task frontmatter

**File**: `.ptah/specs/TASK_2026_531_compact/task.md`

Added YAML frontmatter at the very top, matching the shape of `.ptah/specs/TASK_2026_512_feaa/task.md`, with `id: TASK_2026_531_compact`, `status: in_review`, `type: feature`, the title and multi-line description. The existing body below the frontmatter is unchanged.

## Fix 2 — normalize the agent label

**File**: `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-activity.component.ts:631`

Changed `activeAgentName` to first strip markdown from `mark.label` using the already-imported `stripMarkdownToPlainText`, then run the `Agent (started|completed): ...` regex. This prevents agent names like `**backend-developer**` from leaking asterisks into the agent context box.

```ts
const label = stripMarkdownToPlainText(mark.label);
const match = label.match(/Agent (?:started|completed):\s*(.+)/i);
if (match) return match[1].trim();
return label || 'assistant';
```

## Fix 3 — do not cut markdown before conversion

**File**: `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-activity.component.ts:39-44, 609-615`

Added two module-level constants:

```ts
/** Input bound for conversion; tool output can be very large. */
const DETAIL_SOURCE_LIMIT = 4000;
/** The detail line is one visually truncated line, so 600 plain chars is plenty. */
const DETAIL_TEXT_LIMIT = 600;
```

Updated `feedRows` to convert a bounded markdown prefix first and then truncate the resulting plain text, instead of truncating raw markdown before conversion:

```ts
detail: mark.text
  ? stripMarkdownToPlainText(
      mark.text.slice(0, DETAIL_SOURCE_LIMIT),
    ).slice(0, DETAIL_TEXT_LIMIT)
  : null,
```

`compact-plain-text.ts` was not modified.

## Tests

**File**: `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-activity.component.spec.ts:467-512`

Added two test cases following the existing spec style:

1. **Agent label markdown stripping**: an agent mark with label `Agent started: **backend-developer**` renders `backend-developer` as the agent name, both via `componentInstance.activeAgentName()` and in the `.cs-agent-context` DOM, with no asterisks.
2. **Bounded markdown-to-plain conversion before truncation**: a tool mark whose `text` is a fenced TypeScript block longer than 600 characters (`\`\`\`ts\n` + 700 `x`s + `\n\`\`\``) produces a detail line with no backticks and at most 600 characters.

## Verification

- `npx nx test chat-ui --testPathPattern=compact --outputStyle=static` — **passed**, 246 tests across 30 suites.
- `npx nx lint chat-ui --outputStyle=static` — **passed**.
- `npx tsc -p libs/frontend/chat-ui/tsconfig.lib.json --noEmit` — **passed** (exit code 0, no diagnostics).

Prettier was run only on the three changed files; `git diff` confirmed no unintended changes outside the requested edits.
