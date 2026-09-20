# Context — orphaned MCP process trees

## Measured on the live host, 2026-09-19

14 `firecrawl` node processes alive, each with its own `cmd.exe` parent, and the
count was 10 twenty minutes earlier. Creation times come in pairs:

```
8820  / 29520   17:14:35 / 17:14:39
18228 / 31368   17:16:38 / 17:16:42
6232  / 17600   17:23:14 / 17:23:19
29888 / 23028   17:37:41 / 17:37:46
34752 / 28664   17:40:07 / 17:40:11
25876 / 22964   18:10:55 / 18:11:11
3824  / 37864   18:52:12 / 18:52:34
```

Parents are all `cmd.exe`, and all are themselves orphaned. Their command lines
are the npx wrapper and the resolved binary:

- `cmd.exe /d /s /c "npx -y firecrawl-mcp"` (quotes escaped by cmd)
- `cmd.exe /d /s /c firecrawl-mcp`

So each connection attempt costs roughly three processes (cmd.exe, then the
npx-cli node, then the firecrawl-mcp node) and none are reaped. 13 of the 14 sit
at 0 MB working set, meaning idle and abandoned.

## Cause

`.mcp.json` at the repo root declares:

```
firecrawl   npx -y firecrawl-mcp
```

Every `claude.EXE` subprocess Ptah spawns reads this and starts its own copy.
The session banner reports `firecrawl (CONNECT_TIMEOUT): connection timed out
after 30000ms`. On that timeout the client gives up, but the spawned process tree
is left running instead of being killed.

## Second defect, same area

`~/.claude.json` fails to parse as a plain dictionary because it contains
duplicate keys differing only in drive-letter case:

```
D:/projects/ptah-extension
d:/projects/ptah-extension
```

The workspace is registered twice. Confirm whether this doubles MCP server
spawns per session, and normalise the casing if Ptah is what writes these keys.

## Scope

1. On stdio MCP connect failure or timeout, kill the whole spawned process tree,
   not just the direct child. On Windows a `cmd.exe /c npx` wrapper means the
   grandchild survives a kill aimed at the child.
2. Do not re-spawn a server that has already failed, for every new session,
   without a back-off.
3. Normalise workspace-path casing if Ptah writes `~/.claude.json` keys.

## Investigation note — establish ownership first

Determine whether the spawning client is Ptah's own code or the `claude.EXE`
subprocess reading `.mcp.json`. If it is the latter, the reaping fix does not
belong in this repository, and the correct deliverable is the mitigation Ptah
DOES control: which servers it injects into spawned agents, and a back-off on a
server already known to fail. Report the finding either way — do not force a fix
into a layer that does not own the process.

## Constraint

Whatever reaping you add must itself be bounded. Do not introduce a sweeper that
scans all system processes on a timer.
