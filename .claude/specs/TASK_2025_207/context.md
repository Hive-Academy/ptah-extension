# Task Context - TASK_2025_207

## User Request

Remove 3 redundant MCP namespaces (`ptah.git`, `ptah.commands`, `ptah.symbols`) from the Ptah MCP tools system. These are subsumed by existing capabilities:

- `ptah.git` → CLI `git` commands are superior
- `ptah.commands` → `ptah.ide.actions` covers useful ops; no use case for CLI agents
- `ptah.symbols` → `ptah.ast` + `ptah.ide.lsp` provide better coverage

Must update every reference: namespace builders, API builder, help docs, tool descriptions, type definitions, system prompt, and any tests.

## Task Type

REFACTORING

## Complexity Assessment

Medium — well-scoped removal across known files, but must ensure no dangling references.

## Strategy Selected

Partial: Architect → Team-Leader → Backend Developer → Code Logic Reviewer

## Related Tasks

- TASK_2025_204: Added `ptah.ast` namespace (makes `ptah.symbols` redundant)
- TASK_2025_205: Enhanced `execute_code` tool description

## Created

2026-03-21
