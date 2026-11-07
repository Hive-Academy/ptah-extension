# Ptah Electron App Icons

Application icons for the Ptah Electron desktop app.

| Path        | Used for                                                              |
| ----------- | --------------------------------------------------------------------- |
| `icon.png`  | Source icon. `electron-builder.yml` points its top-level `icon:` at it |
| `mac/`      | `icon.icns`                                                           |
| `win/`      | `icon.ico`                                                            |
| `png/`      | Square PNGs, one per size (16 to 1024)                                |

## Microsoft Store Tiles

The MSIX (appx) target reads its tiles from `../appx/` (`src/assets/appx/`). They are
generated from `icon.png` and committed. Regenerate them after changing the icon:

```bash
node apps/ptah-electron/scripts/generate-appx-assets.mjs
```
