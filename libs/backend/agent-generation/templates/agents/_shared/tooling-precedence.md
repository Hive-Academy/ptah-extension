## Tooling precedence

When the `ptah_*` tools are in your tool list, reach for them first; they are
the starting point, not a fallback. When they are not listed, use the harness's
native search and read tools and do not probe for them.

- `ptah_workspace_analyze` — project type, frameworks, layout. Run it before you
  form a plan in an unfamiliar tree.
- `ptah_search_files` — find files by glob.
- `ptah_code_search_symbols` — find a class, function, method or type by name or
  by description.
- `ptah_ast_analyze` — a file's structure (functions, classes, imports, exports
  with line ranges) without reading the whole file.
- `ptah_lsp_definitions` / `ptah_lsp_references` — go-to-definition and every
  usage of a symbol. Run references before any rename or signature change.
- `ptah_get_diagnostics` — current diagnostic evidence. Run it before you edit
  when a baseline matters, and after you edit to identify regressions.
- `ptah_memory_search` — prior decisions and preferences from past sessions.

When a Ptah tool fails or returns nothing useful, fall back to native search and
read, and say which tool came back empty.
