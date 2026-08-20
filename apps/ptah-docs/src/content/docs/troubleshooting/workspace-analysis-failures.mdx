---
title: Workspace Analysis Failures
description: Permissions, symlinks, and large-repo edge cases.
---

import { Aside } from '@astrojs/starlight/components';

When you open a workspace, Ptah runs an initial analysis pass to index files, detect the stack, and suggest agents. A few environments trip this up.

## Permissions

**Symptom:** "Permission denied" errors during analysis on macOS or Linux.
**Likely cause:** The workspace contains files you can't read (e.g. `node_modules` owned by another user).
**Fix:** Fix ownership (`chown -R $USER .`) or add the offending paths to your workspace ignore list via `.gitignore` or `.claudeignore`.

---

**Symptom:** Windows "Access is denied" for files under `System Volume Information` or recycle-bin folders.
**Likely cause:** Workspace root is at a drive root (`D:\`) and includes system folders.
**Fix:** Point the workspace at a real project folder, not a drive root.

## Symlinks

**Symptom:** Analysis hangs or loops on large projects.
**Likely cause:** Circular symlinks inside the workspace.
**Fix:** Ptah detects and skips cycles, but poorly-formed ones can slow things down. Add the linked path to `.claudeignore`:

```
# .claudeignore
my-broken-symlink/
```

---

**Symptom:** Files inside a symlinked folder don't appear in search.
**Likely cause:** The symlink target lives outside the workspace root.
**Fix:** Open the target folder as its own workspace, or move it inside the workspace tree.

## Large repositories

**Symptom:** Analysis takes minutes on a monorepo.
**Likely cause:** Hundreds of thousands of files under `node_modules`, `.git/objects`, `dist/`, etc.
**Fix:** Ptah already ignores standard build artefacts. For additional pruning, add entries to `.claudeignore`:

```
packages/*/node_modules
vendor/
build/
coverage/
```

Workspaces above roughly 250k files typically benefit from splitting into sub-workspaces.

---

**Symptom:** "Out of memory" during analysis on a laptop.
**Likely cause:** File tree too deep or too many large binary files being scanned.
**Fix:** Exclude binary folders (images, videos, data dumps) via `.claudeignore`. Binary files contribute nothing useful to semantic analysis.

<Aside type="tip">
`.claudeignore` uses the same syntax as `.gitignore`. Rules apply to both initial analysis and ongoing file-search tools.
</Aside>

## Network drives

**Symptom:** Analysis is slow or inconsistent on a SMB / NFS mount.
**Likely cause:** File-system events don't fire reliably over network mounts.
**Fix:** Work on a local copy of the project. File watching is inherently flaky across network file systems on all three platforms.

## Antivirus

**Symptom:** Analysis pauses for seconds at a time on Windows.
**Likely cause:** Real-time antivirus scanning every file read.
**Fix:** Add the workspace folder and the Ptah executable to your antivirus exclusions.
