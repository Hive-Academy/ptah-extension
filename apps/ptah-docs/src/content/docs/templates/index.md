---
title: Templates
description: Reusable project scaffolds and prompt templates for accelerating new work.
---

**Templates** are reusable artifacts that kick-start new work. Ptah ships two flavors in one unified catalog:

- **Project scaffolds** — full folder layouts with files, configs, and starter code (e.g. a new Angular feature module).
- **Prompt templates** — structured prompts and agent definitions that can be applied to an existing workspace (e.g. the `frontend-developer` or `security-auditor` agent).

## Where templates come from

Like plugins, templates are **not bundled in the installer**. They are downloaded from the public GitHub repository via the same [`ContentDownloadService`](/plugins/plugin-storage/) and cached under:

```text
~/.ptah/templates/
```

This means the template catalog stays fresh without requiring a Ptah update.

## What's in the template catalog

| Category              | Examples                                                                         |
| --------------------- | -------------------------------------------------------------------------------- |
| **Agent definitions** | `frontend-developer`, `backend-developer`, `security-auditor`, `devops-engineer` |
| **Project scaffolds** | Angular feature module, Nx library, Express service                              |
| **Prompt recipes**    | Code review prompt, architecture review prompt, test generation                  |

## Next steps

- [Apply a template to a workspace](/templates/using-templates/)
- [Template storage internals](/templates/template-storage/)
- [Create your own template](/templates/creating-templates/)
