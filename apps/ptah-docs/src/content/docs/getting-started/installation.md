---
title: Installation
description: Download and install the Ptah Electron desktop app on Windows, macOS, or Linux.
---

Ptah is distributed as a native desktop app for Windows, macOS, and Linux. This page covers system requirements, where to download installers, and per-platform installation steps.

## System requirements

| Platform | Minimum version                                     | Recommended   |
| -------- | --------------------------------------------------- | ------------- |
| Windows  | Windows 10 (64-bit)                                 | Windows 11    |
| macOS    | macOS 11 Big Sur (Intel or Apple Silicon)           | macOS 13+     |
| Linux    | Ubuntu 20.04+, Debian 11+, Fedora 36+ (glibc 2.31+) | Ubuntu 22.04+ |

Additional requirements for all platforms:

- **Memory**: 4 GB RAM minimum, 8 GB recommended
- **Disk**: 500 MB for the app, plus space for workspace caches and downloaded plugins
- **Network**: Internet connection for license verification, provider APIs, and plugin downloads
- **Node.js** (optional): Required only if you plan to run local MCP servers or the built-in ptah-cli

:::note[Apple Silicon]
Ptah ships a universal macOS build that runs natively on both Intel and Apple Silicon. No Rosetta required.
:::

## Download

All releases are published to GitHub:

**[github.com/ptah-extensions/ptah-extension/releases](https://github.com/ptah-extensions/ptah-extension/releases)**

Download the installer that matches your platform from the latest release assets.

| Platform | File                                                    |
| -------- | ------------------------------------------------------- |
| Windows  | `Ptah-Setup-<version>.exe`                              |
| macOS    | `Ptah-<version>.dmg`                                    |
| Linux    | `Ptah-<version>.AppImage` or `ptah_<version>_amd64.deb` |

## Install on Windows

1. Double-click `Ptah-Setup-<version>.exe`.
2. If SmartScreen shows a warning, click **More info** then **Run anyway**. The installer is signed, but the marketplace reputation for new releases takes time to build.
3. Choose an install scope (per-user or machine-wide) and complete the wizard.
4. Ptah launches automatically when installation finishes.

:::caution[SmartScreen warning]
If you see "Windows protected your PC," verify the publisher is **Ptah Extensions** before proceeding. Do not run installers from any other source.
:::

## Install on macOS

1. Open `Ptah-<version>.dmg`.
2. Drag the **Ptah** icon into the **Applications** folder.
3. Eject the DMG.
4. Open **Applications** and double-click **Ptah**. On first launch, macOS asks you to confirm the app was downloaded from the internet — click **Open**.

If macOS blocks the app with a Gatekeeper message, go to **System Settings → Privacy & Security**, scroll to the Security section, and click **Open Anyway** next to the Ptah notice.

## Install on Linux

### AppImage (portable)

```bash
chmod +x Ptah-<version>.AppImage
./Ptah-<version>.AppImage
```

The AppImage is self-contained and runs without installation. To integrate it with your desktop environment, use a tool like [AppImageLauncher](https://github.com/TheAssassin/AppImageLauncher).

### Debian / Ubuntu (.deb)

```bash
sudo dpkg -i ptah_<version>_amd64.deb
sudo apt-get install -f   # resolve any missing dependencies
```

Launch Ptah from your application menu or run `ptah` from a terminal.

:::note[Sandbox / FUSE]
AppImages on some distributions require FUSE. If the AppImage fails to start, install `libfuse2` (`sudo apt install libfuse2`).
:::

## First-run permissions

On the first launch, your operating system may ask Ptah to grant a few permissions:

- **Firewall / network access** — required to reach provider APIs (Claude, Copilot, Codex, Gemini, etc.), the license server, and the plugin registry. Allow access on both private and public networks if prompted.
- **Clipboard access** (macOS) — used by copy/paste actions inside the chat and terminal panels.
- **Keychain / Credential Manager** — Ptah stores your license key and provider credentials in the OS secure store via Electron's `safeStorage` API.
- **File-system access** — macOS may prompt the first time you open a workspace folder. Grant access to the parent folder where your projects live.

Deny any of these and the corresponding feature will be disabled until you grant access again in your OS settings.

## Verify the install

Open Ptah and check:

1. The title bar shows **Ptah — The Coding Orchestra**.
2. **Help → About** displays a version number that matches the release you downloaded.
3. The status bar at the bottom shows **Ready** with no error badges.

You can also verify from a terminal (Linux/macOS) or PowerShell (Windows):

```bash
# macOS / Linux
ls -la /Applications/Ptah.app 2>/dev/null || which ptah

# Windows PowerShell
Get-AppxPackage *ptah* -ErrorAction SilentlyContinue ; `
  Get-ItemProperty "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*" `
    | Where-Object DisplayName -like "*Ptah*"
```

## Next step

Continue to [First launch](/getting-started/first-launch/) to open your first workspace and run the setup wizard.
