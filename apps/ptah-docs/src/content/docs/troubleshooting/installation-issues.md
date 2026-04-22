---
title: Installation Issues
description: Resolving install and update failures per platform.
---

## Windows

**Symptom:** Installer shows "Windows protected your PC" SmartScreen warning.
**Likely cause:** SmartScreen has not seen enough downloads to trust the signed binary yet.
**Fix:** Click **More info → Run anyway**. The signature is valid; SmartScreen reputation builds over time.

---

**Symptom:** Installer fails with `0x80070005` (access denied).
**Likely cause:** Running from a write-protected location or a corporate policy blocking per-user installs.
**Fix:** Download to your Downloads folder and run as a normal user. If corporate policy prevents per-user installs, ask IT to deploy the MSI variant.

---

**Symptom:** App launches but crashes immediately with a missing `VCRUNTIME140.dll`.
**Likely cause:** Missing Visual C++ runtime.
**Fix:** Install the latest **Microsoft Visual C++ Redistributable (x64)** from Microsoft.

## macOS

**Symptom:** "Ptah is damaged and can't be opened."
**Likely cause:** Quarantine attribute after downloading via a browser.
**Fix:**

```bash
xattr -dr com.apple.quarantine /Applications/Ptah.app
```

Then launch normally.

---

**Symptom:** App opens but the dock icon bounces and then disappears.
**Likely cause:** Gatekeeper blocked an unsigned helper on first launch.
**Fix:** Open **System Settings → Privacy & Security** and click **Open Anyway** on the Ptah prompt. Relaunch.

## Linux

**Symptom:** AppImage won't run.
**Likely cause:** Missing executable bit, or `FUSE` is not available.
**Fix:**

```bash
chmod +x Ptah-*.AppImage
sudo apt install libfuse2     # Debian/Ubuntu
./Ptah-*.AppImage
```

---

**Symptom:** `.deb` install fails with unmet `libnss3` or `libatk1.0-0` dependencies.
**Likely cause:** Minimal install without Electron runtime libs.
**Fix:**

```bash
sudo apt install libnss3 libatk1.0-0 libatk-bridge2.0-0 libxkbcommon0 libgbm1
```

## Updates

**Symptom:** "Update available" toast appears but the update never downloads.
**Likely cause:** Release server unreachable (firewall or DNS).
**Fix:** Check connectivity to `https://releases.ptah.live`. If blocked, download the installer manually from GitHub releases and run it over the existing install.

---

**Symptom:** Update downloads but reports "checksum mismatch."
**Likely cause:** Proxy rewrote the binary.
**Fix:** Bypass the corporate proxy for `releases.ptah.live`, or download from GitHub releases directly.
