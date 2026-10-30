Verdict: APPROVED

## Round-1 findings

| # | Status | Evidence |
|---|---|---|
| 1 | Resolved | Spec lines 129–134 add a separate, deduplicated `{onDisk}` count and details for retained global skills.sh roots and home-folder MCP entries. Prototype notice lines 225–235 shows the fourth count and both retained-source details. This covers the skipped/left-on-disk category in Phase D migration AC3–AC4 and AC6. |
| 2 | Resolved | Spec lines 106–107 explicitly preserve each home target choice. Prototype `homeMemo` array and `sync()` (lines 245–252) do so: browser interaction showed global defaults `[true,true,true]`, an edited `[false,true,true]`, and the same `[false,true,true]` after switching workspace → global. |
| 3 | Resolved | Spec line 35 defines a live sum of unchecked tool and skill costs and gives the correct 3,730 → 3,700 example. Prototype `#sum-n` (line 79) and `total()`/checkbox handlers (lines 253–256) show 3,700 initially; toggling Workflow on changed it to 2,300. |
| 4 | Resolved | Spec line 117 defines the MCP conversion picker. Prototype `#mcp-convert-state` (lines 201–214) shows the note, three unchecked home targets, help, Make global, and Cancel. |

## New findings

1. **Minor — prototype line 235, illustrative retained skills.sh path.** The detail names `~/.agents/skills (skills.sh folder)`, while Phase D migration AC1 and AC3 identify the legacy Ptah skills.sh roots as `~/.ptah/plugins/ptah-skillssh-*`. Use a hypothetical path under that actual root so the example does not suggest migration scans or retires an unrelated directory.

The unchecked home targets in **Make global** are an acceptable conversion-specific choice. Decision #15 preserves seven checked targets for an explicit **new global MCP install** (spec lines 16, 101–104; browser interaction confirmed the prototype starts all three home targets checked when All workspaces is selected). Conversion starts from an existing workspace install and its separate picker is explicitly described in spec line 117 and prototype lines 201–213. Phase D AC2 still requires the converted item to become available in every reconciled Ptah workspace; the optional checkboxes govern additional home-config writes. This distinction should remain explicit in implementation.

I inspected the revised dark and light prototype renders at 1100×900 against the changed spec elements. No other contradiction was introduced by these edits. Real DaisyUI behavior and axe were outside this review; no build, test, or state-changing git action was run.
