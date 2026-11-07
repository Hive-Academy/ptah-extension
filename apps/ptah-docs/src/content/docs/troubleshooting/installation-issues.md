---
title: Installation Issues
description: Fix install and update problems on each platform.
---

## Windows

**Symptom:** You cannot find a Windows `.exe` installer in the GitHub release.
**Likely cause:** Windows builds come only from the Microsoft Store.
**Fix:** Install Ptah from the [Microsoft Store](https://apps.microsoft.com/detail/9N80K3HFX0JT). If you have an older Ptah from an `.exe`, uninstall it first. Your data in `~/.ptah` stays.

---

**Symptom:** Ptah does not update on Windows.
**Likely cause:** The Microsoft Store controls updates of Store installs. Ptah does not check GitHub for them.
**Fix:** Look for updates in the Microsoft Store.

## macOS

**Symptom:** "Ptah is damaged and can't be opened."
**Likely cause:** The macOS build is not signed, and the browser added a quarantine attribute.
**Fix:**

```bash
xattr -dr com.apple.quarantine /Applications/Ptah.app
```

Then start Ptah.

---

**Symptom:** macOS blocks the app on the first start.
**Likely cause:** Gatekeeper blocks unsigned apps.
**Fix:** Open **System Settings → Privacy & Security** and click **Open Anyway** next to the Ptah message. Start Ptah again.

---

**Symptom:** The app does not start on an Intel Mac.
**Likely cause:** Only an Apple Silicon build is published.
**Fix:** Use a Mac with Apple Silicon.

## Linux

**Symptom:** The AppImage does not run.
**Likely cause:** The file is not executable, or FUSE is missing.
**Fix:**

```bash
chmod +x Ptah-*.AppImage
sudo apt install libfuse2     # Debian/Ubuntu
./Ptah-*.AppImage
```

---

**Symptom:** The `.deb` install fails with missing dependencies.
**Likely cause:** `dpkg -i` does not install dependencies.
**Fix:** Install the file with `apt`, which resolves dependencies:

```bash
sudo apt install ./<downloaded-file>.deb
```

## Updates on macOS and Linux

**Symptom:** The **Update available** dialog does not show, but a newer release exists.
**Likely cause:** Ptah could not reach the GitHub Releases API.
**Fix:** Make sure that your network can reach `api.github.com`. Or download the new release from [GitHub releases](https://github.com/Hive-Academy/PtahCode/releases) and install it over the old version.
