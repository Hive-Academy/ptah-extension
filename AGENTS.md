# AGENTS.md

Project instructions for Codex. See [`CLAUDE.md`](./CLAUDE.md) for the full
architecture, tech stack, and coding standards — they apply to Codex too.

## Subagents

Specialist subagents are defined as native Codex subagents under
[`.codex/agents/`](./.codex/agents) (one `.toml` per agent). Codex spawns them
only when explicitly asked. Reviewer agents run in the read-only sandbox.

These files are generated from `.claude/agents/*.md` by the Ptah sync pipeline —
edit the source agents, not the generated TOML.
