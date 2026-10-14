# Context
Source: HANDOFF.md follow-up 8.
- Keys declared but read by nothing: embeddingModel, searchTopK, searchAlpha, coalesceMs,
  codexAutoApprove. Confirm each with `git grep` before removal.
- A removal needs user approval (orchestration rule). List the evidence per key and ask
  before any code change. Check settings export/import and migration of stored user files.
