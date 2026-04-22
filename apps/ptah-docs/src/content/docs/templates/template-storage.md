---
title: Template Storage
description: How templates are downloaded, cached, and resolved at runtime.
---

Templates use the exact same storage and download pipeline as [plugins](/plugins/plugin-storage/). They are listed in the same `content-manifest.json` and fetched on demand by the `ContentDownloadService`.

## Storage layout

```text
~/.ptah/
└── templates/
    └── agents/
        ├── frontend-developer.md
        ├── backend-developer.md
        ├── security-auditor.md
        └── devops-engineer.md
```

| Path                                  | Purpose                               |
| ------------------------------------- | ------------------------------------- |
| `~/.ptah/templates/`                  | Downloaded template tree              |
| `~/.ptah/cache/content-manifest.json` | Shared manifest (plugins + templates) |

## The manifest entry

The `templates` section of `content-manifest.json` looks like:

```json
{
  "templates": {
    "basePath": "libs/backend/agent-generation/templates",
    "files": ["agents/frontend-developer.md", "agents/backend-developer.md", "agents/security-auditor.md", "agents/devops-engineer.md"]
  }
}
```

`basePath` is the path inside the Ptah repository; `files` is a flat list of every template artifact. Ptah rebuilds the tree under `~/.ptah/templates/` preserving the relative paths.

## Download flow

1. On app launch (or when the Templates panel is first opened), Ptah fetches the manifest.
2. It diffs the `templates.files` list against `~/.ptah/templates/` using content hashes.
3. Missing or changed files are downloaded in parallel.
4. The Templates panel reads `~/.ptah/templates/` and indexes each entry by its frontmatter.

## Offline behavior

If GitHub is unreachable, Ptah falls back to whatever is already in `~/.ptah/templates/`. The Templates panel displays an **Offline** banner, and template installs queue for retry.

## Inspecting the cache

| Command                            | Effect                                                  |
| ---------------------------------- | ------------------------------------------------------- |
| `Ptah: Open Template Cache Folder` | Opens `~/.ptah/templates/` in your file manager         |
| `Ptah: Refresh Templates`          | Re-reads the manifest and re-downloads changed files    |
| `Ptah: Clear Template Cache`       | Deletes `~/.ptah/templates/` (re-downloads on next use) |

## Next steps

- [Create your own template](/templates/creating-templates/)
- [Plugin storage](/plugins/plugin-storage/) (shares the same pipeline)
