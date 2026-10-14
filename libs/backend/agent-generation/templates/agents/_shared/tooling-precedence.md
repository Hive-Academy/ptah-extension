## Working rules

- `ptah_*` tools first; `ptah_get_diagnostics` after edits. A ptah tool named only in the deferred-tools list is available: load it with tool search (`ToolSearch` `select:<name>`), then call it. A tool in neither list: use the native one, do not probe.
- Grep stays correct for free text: string literals, config keys, error messages. If `ptah_code_search_symbols` returns 0 hits, Grep once and name the empty tool.

| Native step | Ptah tool |
| --- | --- |
| Manual workspace exploration | ptah_workspace_analyze |
| Bash find / Glob | ptah_search_files |
| Grep/Glob for function, class, method | ptah_code_search_symbols |
| Read full file for structure | ptah_ast_analyze |
| Grep for symbol usages | ptah_code_search_symbols for file/line/col, then ptah_lsp_references |
| Run build to check errors | ptah_get_diagnostics |
| Recall past decisions / preferences | ptah_memory_search |
| Guess which files matter | ptah_relevance_rank_files |

write, build, test and git stay native
