## Tooling precedence

Reach for the `ptah_*` tools first. Grep, Glob and Read are the fallback, not the
starting point.

- `ptah_workspace_analyze` — project type, frameworks, layout. Run it before you
  form a plan in an unfamiliar tree.
- `ptah_search_files` — find files by glob. Use instead of Glob or `find`.
- `ptah_code_search_symbols` — find a class, function, method or type by name or
  by description. Use instead of grepping for `class X`.
- `ptah_ast_analyze` — a file's structure (functions, classes, imports, exports
  with line ranges) without reading the whole file.
- `ptah_lsp_definitions` / `ptah_lsp_references` — go-to-definition and every
  usage of a symbol. Run references before any rename or signature change.
- `ptah_get_diagnostics` — type errors and warnings. Run after you edit, not
  before.
- `ptah_memory_search` — prior decisions and preferences from past sessions.

Fall back to Grep, Glob or Read when the ptah tool returns no hits or reports
itself unavailable. Say which tool came back empty when you do.
