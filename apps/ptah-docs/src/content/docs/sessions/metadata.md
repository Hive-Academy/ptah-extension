---
title: Session Metadata
description: Every field Ptah tracks per session and how it's used.
---

# Session Metadata

Each session in Ptah carries a metadata record alongside its message transcript. Metadata drives search, filters, analytics, cost tracking, and resume behavior — so it's worth understanding exactly what's in there.

## The full schema

```json
{
  "id": "sess_01h8zabcxyz",
  "title": "Add dark mode toggle",
  "workspaceId": "ws_9a2f...",
  "source": "native",
  "createdAt": "2026-04-21T08:12:03.441Z",
  "updatedAt": "2026-04-21T10:46:17.882Z",
  "agent": "frontend-developer",
  "model": "claude-opus-4-7",
  "provider": "anthropic",
  "messageCount": 42,
  "cost": {
    "totalUsd": 0.8721,
    "inputTokens": 41250,
    "outputTokens": 3810,
    "cacheReadTokens": 18700,
    "cacheWriteTokens": 5120
  },
  "duration": {
    "wallClockMs": 9254000,
    "activeMs": 1830400
  },
  "quality": {
    "overall": 86,
    "style": 92,
    "logic": 84,
    "security": 80
  },
  "tags": ["feature", "ui"],
  "archived": false,
  "pinned": true,
  "resumeSessionIds": {
    "gemini": "sess_7a2f...",
    "codex": null
  }
}
```

## Field reference

### Identity

| Field         | Type   | Notes                                            |
| ------------- | ------ | ------------------------------------------------ |
| `id`          | string | Stable ULID; never reused                        |
| `title`       | string | Auto-generated or user-renamed                   |
| `workspaceId` | string | The Ptah workspace this session belongs to       |
| `source`      | enum   | `native`, `claude-cli`, `imported`, `duplicated` |

### Timing

| Field                  | Type     | Notes                           |
| ---------------------- | -------- | ------------------------------- |
| `createdAt`            | ISO 8601 | First message timestamp         |
| `updatedAt`            | ISO 8601 | Last activity timestamp         |
| `duration.wallClockMs` | number   | Last − first                    |
| `duration.activeMs`    | number   | Sum of per-turn generation time |

### Agent & model

| Field      | Type   | Notes                                                 |
| ---------- | ------ | ----------------------------------------------------- |
| `agent`    | string | Agent name active at session end                      |
| `model`    | string | Model active at session end (e.g., `claude-opus-4-7`) |
| `provider` | string | `anthropic`, `openai`, `google`, `github`, etc.       |

A session can change agent or model mid-conversation. The metadata stores the **current** value; per-turn history is preserved in the transcript itself.

### Cost

All cost numbers are USD and computed from provider-reported usage. See [Cost summary](/sessions/cost-summary/) for override mechanics.

### Quality

Populated only after a review-capable agent has run. See [Analytics](/sessions/analytics/#quality-scores) for the scoring protocol.

### Tags and state

| Field      | Type     | Notes                                       |
| ---------- | -------- | ------------------------------------------- |
| `tags`     | string[] | User-defined labels; local to workspace     |
| `archived` | boolean  | Hidden from default views when true         |
| `pinned`   | boolean  | Sticks to the left of the tab bar when true |

### Resume IDs

`resumeSessionIds` maps external CLI names to their session ID, letting you [resume the same conversation](/agents/cli-agents/#session-resume) in the corresponding CLI.

## Where metadata is stored

Session metadata lives in two places for performance:

- **Inline**, at the top of each session JSON file — the source of truth.
- **Indexed**, in `<workspace>/.ptah/sessions/index.json` — a compact copy optimized for list queries.

When the two disagree (rare, after a force-quit), the inline copy wins and the index is rebuilt on next launch or via **Ptah: Rebuild Session Index**.

## Using metadata in search

The search bar exposes metadata as field queries:

```text
agent:backend-developer model:claude-opus-4-7 after:2026-03-01 cost:>1
```

Quality and token ranges work the same way:

```text
quality:<70 outputTokens:>5000
```

See [Session history search](/sessions/session-history/#searching) for the full grammar.

## Extending metadata

Plugins can attach arbitrary key-value pairs under a namespaced prefix:

```json
{
  "metadata": {
    "x-my-plugin:ticket": "JIRA-4821",
    "x-my-plugin:branch": "feature/dark-mode"
  }
}
```

Prefixed fields are preserved verbatim by Ptah and surfaced in exports.

## Privacy

Metadata is local-only. No field is transmitted to any Ptah-operated service. Exported JSON contains everything above; strip fields before sharing externally if needed.
