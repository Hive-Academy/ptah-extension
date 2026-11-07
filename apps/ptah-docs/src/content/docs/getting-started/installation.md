---
title: Installation
description: Install the PtahCode desktop app on Windows, macOS, or Linux.
---

PtahCode is a desktop app for Windows, macOS, and Linux. Windows builds come from the Microsoft Store. macOS and Linux builds come from GitHub releases.

<video controls preload="metadata" playsinline style="width:100%;border-radius:0.5rem;border:1px solid var(--sl-color-gray-5);margin:1rem 0;">
  <source src="/assets/videos/install.mp4" type="video/mp4" />
</video>

## Supported platforms

| Platform | Build                         | Where to get it                                                                  |
| -------- | ----------------------------- | -------------------------------------------------------------------------------- |
| Windows  | x64, Microsoft Store package  | [Microsoft Store](https://apps.microsoft.com/detail/9N80K3HFX0JT)                |
| macOS    | Apple Silicon, `.dmg` or `.zip` | [GitHub releases](https://github.com/Hive-Academy/PtahCode/releases)           |
| Linux    | x64, `.AppImage` or `.deb`    | [GitHub releases](https://github.com/Hive-Academy/PtahCode/releases)             |

No Intel macOS build and no Windows ARM build are published.

You can also start from the [download page](https://ptah.live/download).

## Install on Windows

1. Open the [PtahCode page in the Microsoft Store](https://apps.microsoft.com/detail/9N80K3HFX0JT).
2. Click **Get** or **Install**.
3. Start Ptah from the Start menu.

The Microsoft Store installs updates for you.

:::note[Older Windows installs]
GitHub releases contain no Windows `.exe` installer. If you have an older Ptah that you installed from an `.exe`, uninstall it first. Then install Ptah from the Microsoft Store. Your data in `~/.ptah` stays.
:::

## Install on macOS

1. Download the `.dmg` file from the latest GitHub release.
2. Open the `.dmg` file.
3. Drag **Ptah** into the **Applications** folder.
4. Open **Ptah** from **Applications**.

The macOS build is not signed. If macOS blocks the app, go to **System Settings → Privacy & Security** and click **Open Anyway** next to the Ptah message. See [Installation issues](/troubleshooting/installation-issues/) for other fixes.

## Install on Linux

### AppImage

```bash
chmod +x Ptah-*.AppImage
./Ptah-*.AppImage
```

The AppImage runs without installation. Some distributions need FUSE. If the AppImage does not start, install `libfuse2` (`sudo apt install libfuse2`).

### Debian / Ubuntu (.deb)

```bash
sudo apt install ./<downloaded-file>.deb
```

Start **PtahCode** from your application menu.

## Updates

On macOS and Linux, Ptah compares your version with the latest GitHub release. When a newer release is available, Ptah shows an update dialog. Its **Download** action opens the release file in your browser. Install the new version over the old one.

## Where your data goes

Ptah keeps its settings and data in `~/.ptah` in your home folder. See [File locations](/reference/file-locations/).

## Next step

Continue to [First launch](/getting-started/first-launch/).
