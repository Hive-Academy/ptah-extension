---
title: Template Storage
description: How templates are downloaded, cached, and resolved at runtime.
---

Templates use the exact same storage and download pipeline as [plugins](/plugins/plugin-storage/). They are listed in the same `content-manifest.json` and fetched on demand by the `ContentDownloadService`.

## Storage layout

```text
~/.ptah/
├── .content-cache.json
└── templates/
    └── agents/
        ├── backend-developer.template.md
        ├── frontend-developer.template.md
        ├── software-architect.template.md
        └── …
```

| Path                          | Purpose                                                     |
| ----------------------------- | ----------------------------------------------------------- |
| `~/.ptah/templates/agents/`   | Downloaded agent templates (`*.template.md`)                |
| `~/.ptah/.content-cache.json` | Cache metadata — the hash of the content already downloaded |

## The manifest entry

The `templates` section of `content-manifest.json` looks like:

```json
{
  "templates": {
    "basePath": "libs/backend/agent-generation/templates/agents",
    "files": ["backend-developer.template.md", "frontend-developer.template.md", "software-architect.template.md"]
  }
}
```

`basePath` is the path inside the Ptah repository; `files` is a flat list of every template artifact. Ptah rebuilds the tree under `~/.ptah/templates/agents/` preserving the relative paths.

## Download flow

1. On app launch (or when the Templates panel is first opened), Ptah fetches the manifest.
2. It compares the manifest's single `contentHash` against `~/.ptah/.content-cache.json`. If they match, nothing is downloaded.
3. If the hashes differ, Ptah deletes any local file no longer listed in the manifest, then re-downloads **every** listed file — up to 10 at a time. There is no per-file diff: the check is all-or-nothing for the whole manifest, plugins and templates together.
4. The Templates panel reads every `*.template.md` under `~/.ptah/templates/agents/` and indexes each one by its YAML frontmatter.

Because step 3 prunes, `~/.ptah/templates/agents/` mirrors the manifest exactly — anything you drop in there yourself is deleted on the next refresh.

## Offline behavior

If GitHub is unreachable, Ptah keeps using whatever is already in `~/.ptah/templates/agents/`. The fetch fails quietly and returns; it is not queued and not retried. The next refresh happens the next time Ptah asks for content.

## Next steps

- [Create your own template](/templates/creating-templates/)
- [Plugin storage](/plugins/plugin-storage/) (shares the same pipeline)
