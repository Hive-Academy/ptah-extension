# Windows Code Signing — Implementation Tasks

## Status: Waiting on eSigner enrollment

Certificate: `co-cc1kso8ar11` (Personal ID Code Signing, 1 year)
Branch: `feature/windows-code-signing`

---

## Task 1 — Enroll certificate in eSigner (MANUAL)

**Do this first before anything else.**

1. Go to https://secure.ssl.com
2. Navigate to Orders → `co-cc1kso8ar11`
3. Click the **"eSigner cloud signing"** tab
4. Click **Enroll** and follow the steps
5. When prompted, scan the QR code with an authenticator app (Google Authenticator, Authy, etc.)
6. **Save the TOTP secret** (the raw base32 string — NOT the 6-digit code)

Credentials needed:

- `SSL_COM_USERNAME` = abdallah.khalil.nada@gmail.com
- `SSL_COM_PASSWORD` = your SSL.com account password
- `SSL_COM_TOTP_SECRET` = base32 TOTP secret from eSigner enrollment

---

## Task 2 — Add GitHub Secrets (MANUAL)

1. Go to https://github.com/Hive-Academy/ptah-extension/settings/secrets/actions
2. Add the following **Repository secrets**:

| Secret Name           | Value                          |
| --------------------- | ------------------------------ |
| `SSL_COM_USERNAME`    | abdallah.khalil.nada@gmail.com |
| `SSL_COM_PASSWORD`    | your SSL.com password          |
| `SSL_COM_TOTP_SECRET` | base32 TOTP secret from Task 1 |

---

## Task 3 — Wire up CodeSignTool in CI (CLAUDE DOES THIS)

Files to modify on branch `feature/windows-code-signing`:

- `.github/workflows/publish-electron.yml` — add signing step after Windows build
- `apps/ptah-electron/electron-builder.yml` — add win sign config if needed

What the signing step does:

1. Downloads SSL.com CodeSignTool CLI
2. Signs the built `*.exe` NSIS installer
3. Replaces unsigned artifact with signed one
4. Only runs on `windows-latest` runner

Reference: https://www.ssl.com/how-to/automate-ev-code-signing-with-signtool-or-certutil-esigner/

---

## Task 4 — Test Signed Release (VERIFY TOGETHER)

1. Trigger `publish-electron` workflow manually on `feature/windows-code-signing`
2. Check signing step passes in CI logs
3. Download the `.exe` from the release
4. Right-click → Properties → Digital Signatures → verify "Abdallah khalil" appears
5. Install it and confirm no "Unknown publisher" SmartScreen warning
6. If all good → merge `feature/windows-code-signing` into `main`

---

## Notes

- Linux (AppImage/deb) and macOS builds are NOT affected — signing is Windows-only
- OV cert = SmartScreen reputation builds over time with download volume (no instant trust like EV)
- Can upgrade to EV cert later when revenue justifies it (~$249-359/yr)
- eSigner is $20/mo (Tier 1, 20 signings) — cancel between releases if needed
