---
title: Plugin Storage
description: How PtahCode downloads, caches, and prunes the official plugins.
---

The PtahCode installer does not include the plugins. The content download gets the plugins from the public GitHub repository and keeps them in your home folder.

## Storage layout

```text
~/.ptah/
├── plugins/
│   ├── ptah-core/
│   │   ├── .claude-plugin/plugin.json
│   │   ├── commands/
│   │   └── skills/
│   ├── ptah-nx-saas/
│   ├── ptah-dotnet/
│   ├── ptah-angular/
│   └── ptah-react/
├── templates/
│   └── agents/
└── .content-cache.json
```

| Path                          | Purpose                                         |
| ----------------------------- | ----------------------------------------------- |
| `~/.ptah/plugins/`            | Downloaded plugin files                         |
| `~/.ptah/templates/agents/`   | Downloaded agent templates                      |
| `~/.ptah/.content-cache.json` | The last downloaded `contentHash` and counts    |

On Windows, `~` is `%USERPROFILE%`. On macOS and Linux, it is `$HOME`.

## The content manifest

The file `content-manifest.json` at the root of the [PtahCode repository](https://github.com/Hive-Academy/PtahCode) lists all downloadable files. It has a `plugins` list (base path `plugins`) and a `templates` list (base path `libs/backend/agent-generation/templates/agents`). The script `scripts/generate-content-manifest.js` makes the manifest. One `contentHash` covers the full manifest.

## The download

1. PtahCode gets `content-manifest.json` from GitHub.
2. It compares `contentHash` with `~/.ptah/.content-cache.json`. If they are the same, it downloads nothing.
3. It deletes local files that the manifest no longer lists. It prunes only inside the folders that the manifest populates, so your harness plugins stay.
4. It downloads every file in the manifest, 10 at a time.

Other rules:

- Each file is written to `<path>.tmp` and then renamed, so an interrupted download does not leave a half-written file.
- A destination path that is outside the target folder is rejected.
- A request can follow a maximum of 5 redirects.
- When one file fails, the other files still download. The result tells how many failed.

## Offline use

When there is no network, the manifest download fails and PtahCode continues. The plugins already on disk continue to work. There is no retry queue. The next content check starts again.

## Force a full download

1. Delete `~/.ptah/.content-cache.json`.
2. Restart PtahCode.

Your plugin selection is not in this file, so it stays.

## Next steps

- [Create your own plugin](/plugins/creating-plugins/)
- [Template storage](/templates/template-storage/)
