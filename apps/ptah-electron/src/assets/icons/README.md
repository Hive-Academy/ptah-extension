# Ptah Electron App Icons

This directory contains the application icons for the Ptah Electron desktop app.

## Required Files

| File        | Platform       | Format | Minimum Size | Notes                                                                                  |
| ----------- | -------------- | ------ | ------------ | -------------------------------------------------------------------------------------- |
| `icon.png`  | Source / Linux | PNG    | 512x512      | Master source icon; electron-builder uses it to generate platform icons                |
| `icon.icns` | macOS          | ICNS   | 512x512      | Apple icon format; can be generated from `icon.png` via `iconutil` or electron-builder |
| `icon.ico`  | Windows        | ICO    | 256x256      | Windows icon format; can be generated from `icon.png` via electron-builder             |

## How electron-builder Uses These

The `electron-builder.yml` at the app root references these paths:

```yaml
mac:
  icon: src/assets/icons/icon.icns
win:
  icon: src/assets/icons/icon.ico
linux:
  icon: src/assets/icons # directory -- picks largest PNG
```

## Generating Platform Icons from Source PNG

If you only have `icon.png` (512x512 or 1024x1024), electron-builder can auto-generate `.icns` and `.ico` during packaging. Alternatively:

### macOS (.icns)

```bash
# Create iconset directory with required sizes
mkdir icon.iconset
sips -z 16 16     icon.png --out icon.iconset/icon_16x16.png
sips -z 32 32     icon.png --out icon.iconset/icon_16x16@2x.png
sips -z 32 32     icon.png --out icon.iconset/icon_32x32.png
sips -z 64 64     icon.png --out icon.iconset/icon_32x32@2x.png
sips -z 128 128   icon.png --out icon.iconset/icon_128x128.png
sips -z 256 256   icon.png --out icon.iconset/icon_128x128@2x.png
sips -z 256 256   icon.png --out icon.iconset/icon_256x256.png
sips -z 512 512   icon.png --out icon.iconset/icon_256x256@2x.png
sips -z 512 512   icon.png --out icon.iconset/icon_512x512.png
sips -z 1024 1024 icon.png --out icon.iconset/icon_512x512@2x.png
iconutil -c icns icon.iconset -o icon.icns
```

### Windows (.ico)

```bash
# Using ImageMagick
convert icon.png -define icon:auto-resize=256,128,64,48,32,16 icon.ico
```

## Design Guidelines

- Use a transparent background
- Keep the design simple and recognizable at 16x16
- Follow the Ptah brand guidelines for colors and style
- Test visibility on both light and dark OS themes
