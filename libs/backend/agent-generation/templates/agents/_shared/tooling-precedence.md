## Working rules

- `ptah_*` tools first; `ptah_get_diagnostics` after edits. A deferred ptah tool counts as listed: if your client defers tool schemas, load it with its tool-search tool (Claude Code: `ToolSearch` `select:<name>`), otherwise call it directly. A tool that is not listed at all: use the native one, do not probe.
- Native read/search only for free-text search (string literals, config keys, error messages), or after a ptah error or zero hits; then Grep once and name the empty tool.

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

## Skill use

- An assignment is a skill the task, this role's own instructions, or an already loaded skill names as work to do. This role loads each assigned skill that the host currently lists and that this role is allowed to use, before that work. Assignment of a primary skill does not stop this role from loading other relevant supporting skills that this role is allowed to use, through the same host mechanism. A catalogue name is not an assignment and is not loaded instructions. Seeing or repeating a name is not loading the skill.
- When the task assigns none, this role selects from the host's catalogue only skills whose descriptions match the task and the repository's own evidence, and that this role is allowed to use. That selection is only the unassigned entry. This role does not load a skill because the catalogue lists it, because this product's repository uses that stack, or because the role recognises the name.
- This role loads a skill through the host's skill-loading tool when that tool is listed for this role. This role does not recite an unloaded skill from memory and does not reconstruct its steps.
- Access policy still applies after a match. A denied load is not another path and is not permission to perform the denied action, and it is not reconstructed steps. An action this role's instructions forbid is treated the same way. This role reports the skill name and the denial. This role continues only work that does not depend on that skill and that this role is still allowed to do.
- When an optional skill is absent, or its load fails for a reason other than denial, this role says so. An optional miss continues independent permitted work that the repository's instruction files already allow. This role does not invent that skill's steps.
- When the task, or a skill already loaded, makes a missing skill mandatory for a piece of work, a required miss stops the dependent work. This role reports the skill name and the limitation through the channel this role already uses for a blocked step. This role does not improvise the missing skill's rules. Independent permitted work may continue.
- The skill body remains the home of its rules. This role does not copy those rules into the role file.
