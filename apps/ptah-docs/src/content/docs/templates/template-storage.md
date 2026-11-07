---
title: Template Storage
description: How PtahCode downloads and caches the agent templates.
---

Templates use the same download as [plugins](/plugins/plugin-storage/). They are listed in the same `content-manifest.json`.

## Storage layout

```text
~/.ptah/
├── .content-cache.json
└── templates/
    └── agents/
        ├── _shared/
        ├── backend-developer.template.md
        ├── frontend-developer.template.md
        ├── software-architect.template.md
        └── …
```

| Path                          | Purpose                                      |
| ----------------------------- | -------------------------------------------- |
| `~/.ptah/templates/agents/`   | Downloaded agent templates (`*.template.md`) |
| `~/.ptah/.content-cache.json` | The hash of the content already downloaded   |

## The manifest entry

```json
{
  "templates": {
    "basePath": "libs/backend/agent-generation/templates/agents",
    "files": ["backend-developer.template.md", "frontend-developer.template.md"]
  }
}
```

`basePath` is the path in the PtahCode repository. `files` lists every template file.

## Download

1. PtahCode gets the manifest when it starts.
2. It compares the single `contentHash` with `~/.ptah/.content-cache.json`. If they are the same, it downloads nothing.
3. If they are different, it deletes local files that the manifest does not list. Then it downloads every listed file, 10 at a time.

Because of step 3, `~/.ptah/templates/agents/` always matches the manifest. A file that you add there is deleted at the next download.

## Offline use

When GitHub is not available, PtahCode uses the templates already in `~/.ptah/templates/agents/`. The download is not retried until the next content check.

## Next steps

- [Creating templates](/templates/creating-templates/)
- [Plugin storage](/plugins/plugin-storage/)
