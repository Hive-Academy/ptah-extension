# HANDOFF — Microsoft Store (MSIX) channel + SSL.com eSigner cancellation

Written 2026-10-20. Read this first, then `implementation-plan.md` (section "User answers"
overrides earlier plan text), `research-report.md` and `context.md` in this folder.

## Goal

1. Ship the Ptah Electron app on Windows only through the Microsoft Store (MSIX, re-signed by
   Microsoft), starting at v2.0.0. macOS/Linux keep publishing to the GitHub Release.
2. Stop paying SSL.com eSigner ($20/month Tier 1). The NSIS `.exe` and all eSigner signing are
   removed from CI.
3. The user does NOT want v2.0.0 published until they finish their own testing. The PR must stay
   a DRAFT and must NOT be merged until the user says v2 is ready.

## Where the work is

- Worktree: `D:/projects/ptah-extension/.claude-worktrees/microsoft-store`
- Branch: `feat/microsoft-store` (from `origin/main` at `79ad83bdb`). **Local only — not pushed,
  no PR yet.**
- `node_modules` in the worktree is a JUNCTION to `D:/projects/ptah-extension/node_modules`.
  Never run `npm install` in the worktree. Before `git worktree remove`, run
  `cmd /c rmdir D:\projects\ptah-extension\.claude-worktrees\microsoft-store\node_modules`.

### Commits on the branch (all done, all committed)

| SHA | Content |
|---|---|
| `8aec58cf3` | feat(electron): appx block in `electron-builder.yml` + 4 Store tiles + generator script |
| `34b4d7b4a` | feat(electron): `readDistributionChannel()`/`isMicrosoftStoreBuild()`; UpdateManager skips GitHub in Store builds |
| `0507f9378` | feat(chat-ui,chat): "Report AI response" flag button (mailto help@ptah.live), policy 11.16 |
| `04a2d8d5e` | ci(release): MSIX build in Windows leg, `store` job (msstore CLI, draft by default), `bump: none`, version guard, ONNX patch/verify, app version 2.0.0 |
| `bc4bb9dd3` | docs: research report and plan |
| `56eb00852` | ci(release): remove eSigner, SSL_COM_* secrets, NSIS and the Windows `.exe` from the release (step B) |

`HANDOFF.md` (this file) is not committed yet.

## Key files

- `.github/workflows/publish-electron.yml` — prepare (version + guard), build matrix (Windows:
  `--win --dir` → verifies → tile check → `--win appx --prepackaged` → artifact
  `ptah-msstore-<version>`), release (GitHub Release, macOS/Linux assets only), `store` job
  (publish mode only; `store-submission` input: `no-commit` default, `commit`, `skip`).
- `apps/ptah-electron/electron-builder.yml` — `appx:` block (identity values below); `win.target`
  stays `nsis` for local packaging; CI overrides the target.
- `apps/ptah-electron/scripts/generate-appx-assets.mjs`, `apps/ptah-electron/src/assets/appx/*.png`
- `apps/ptah-electron/src/config/build-identity.ts` (+ spec)
- `apps/ptah-electron/src/services/update/update-manager.ts` (+ spec)
- `libs/frontend/chat-ui/src/lib/atoms/report-response-button.component.ts`, `message-text.ts`
  (+ specs), `copy-button.component.ts`, `libs/frontend/chat-ui/src/index.ts`
- `libs/frontend/chat/src/lib/components/organisms/message-bubble.component.{ts,html,spec.ts}`
- `apps/ptah-electron/package.json` — version `2.0.0`

## External setup (all done)

- Partner Center product **Ptah**, MSIX or PWA app, In draft. Store ID `9N80K3HFX0JT`.
  Identity: Name `PtahOrchestra.Ptah`, Publisher `CN=4E52CB56-1E00-4214-9A22-F65A54BFF522`,
  PublisherDisplayName `Ptah Orchestra`, PFN `PtahOrchestra.Ptah_rwqmhy9dq1amj`.
  **Name reservation lapses ~2027-01-19 unless the first submission is made before then.**
- Partner Center account: Individual, Seller ID `96757110`.
- Entra tenant "Default Directory" `2163618d-9f83-4ef1-b829-84254d1f9e2d`
  (`abdallahkhalilnadagmail.onmicrosoft.com`), associated with Partner Center using work account
  `pcadmin@abdallahkhalilnadagmail.onmicrosoft.com` (Global Admin; the user can disable it).
- Entra app `ptah-msstore-ci`, client ID `1e347197-db51-41c3-82d6-bcd820c26473`, added in
  Partner Center with role **Manager**. (A duplicate app `4cd17394-…` was deleted.)
- GitHub (Hive-Academy/ptah-extension): repo variables `MSSTORE_TENANT_ID`, `MSSTORE_CLIENT_ID`,
  `MSSTORE_SELLER_ID`, `MSSTORE_PRODUCT_ID`; secret `MSSTORE_CLIENT_SECRET` (180-day secret,
  **expires ~2027-04-17**; rotate in Entra → Certificates & secrets, then
  `gh secret set MSSTORE_CLIENT_SECRET`).

## Verification status

- Done: Jest on build-identity + update-manager specs (45/45 pass); chat-ui specs (13/13 pass);
  YAML parse of workflow + electron-builder.yml; tile sizes; version-guard dry check.
- **Not done**: `nx test/typecheck/lint` for ptah-electron, chat-ui, chat; the message-bubble
  spec (failed before the node_modules junction existed); the pre-push gate; any CI run.
- Unverified assumptions (only a CI dry run / first submission settles them):
  A1 `--win appx --prepackaged` works; A6 `__appx-*` stage dir name; A7 `msstore publish` accepts
  `.appx`; unsigned appx passes Store upload validation.

## Machine queue (other sessions)

Heavy jobs are coordinated with peer sessions. Agreed order: task 702 checks → task 662 Electron
build/visual review → **this task's checks + push** → task 702 Electron build. Wait for
"Electron: free" from session `ptah-ptah-extension-skills-epic-v6-…`
(`uds:\\.\pipe\LOCAL\cc-msg-d71580b98b069c028fef250989acbe0b`). After this task's checks and push,
send that session "checks: free". If the pipe is gone, ask the user before starting heavy checks.

## SSL.com eSigner cancellation (in progress, user action)

- Order `co-cc1kso8ar11`, 1 Year Personal ID Code Signing (IV+OV), Abdallah Khalil, expires
  2027-04-09, eSigner active, plan Tier 1 Monthly, 54 unused signings, serial
  `546d186a1df4eb6f7351f38e6ef9d0dc`. Order `co-bc1ku7f34df` is already refunded.
- Invoices: October `mi-7788-1lbu8d3` $20 PENDING (due 10/31). Cancelling before 11/01 stops
  November onward. Only support can void October.
- "Change Plan" has no cancel option; **Revoke** on the order page is the only self-service way and
  it revokes the certificate (key is cloud-only). Re-enrollment later: $39.
- The user is sending a support request (email support@ssl.com or chat at
  https://www.ssl.com/submit-a-ticket/) asking: revoke with reason cessationOfOperation and the
  current date (keep timestamped signatures valid), no charges from November, void the October
  invoice. If there is no reply by ~10/28, use Revoke before 11/01.
- Never click Revoke/Cancel without the user's explicit approval.
- **Status 2026-10-20:** the user revoked the certificate and is working with SSL.com support on
  the remaining billing items (no November charge, October invoice). Still open: the user's
  approval to delete the `SSL_COM_*` GitHub secrets (step 7).

## Next steps (in order)

1. Ask the user for the SSL.com support reply / cancellation status.
2. When "Electron: free" arrives, run checks ONE AT A TIME from the worktree:
   ```bash
   cd D:/projects/ptah-extension/.claude-worktrees/microsoft-store
   npx nx test ptah-electron --parallel=1 2>&1 | tail -20
   npx nx run-many -t test -p @ptah-extension/chat-ui @ptah-extension/chat --parallel=1 2>&1 | tail -25
   #   confirm the header says "Running target test for 2 projects"
   npx nx typecheck ptah-electron --parallel=1 2>&1 | tail -15
   npx nx typecheck @ptah-extension/chat-ui --parallel=1 2>&1 | tail -15
   npx nx typecheck @ptah-extension/chat --parallel=1 2>&1 | tail -15
   npx nx lint ptah-electron --parallel=1 2>&1 | tail -15
   npx nx lint @ptah-extension/chat-ui --parallel=1 2>&1 | tail -15
   npx nx lint @ptah-extension/chat --parallel=1 2>&1 | tail -15
   ```
   (Check the exact project names with `npx nx show projects | grep -E "chat|electron"`.)
   Fix failures with a new commit (commitlint: `.commitlintrc.json`, subject ≤ 72 chars).
3. Commit this HANDOFF.md (`docs: ...`), then push and open a **DRAFT** PR in one background
   command (pre-push runs di-lint + Electron validate-deps):
   ```bash
   git push -u origin feat/microsoft-store && gh pr create --draft --base main \
     --title "feat(electron): ship Windows through the Microsoft Store" --body-file <file>
   ```
   PR body: Summary + Test plan; state "DO NOT MERGE until v2 testing is done"; mention that
   merging sets version 2.0.0 and the major ≥ 1 guard (a normal 0.1.x release would fail), that
   old 0.1.x Windows users see v2.0.0 with no .exe and must be pointed to the Store, and the
   unverified assumptions. End with the Claude Code attribution line.
   Send "checks: free" to the peer session.
4. Dry run on the branch (publishes nothing, runs on GitHub):
   ```bash
   gh workflow run publish-electron.yml --ref feat/microsoft-store -f bump=none -f dry-run=true
   gh run list --workflow publish-electron.yml --branch feat/microsoft-store -L 1
   ```
   Check one time at completion. Confirm the Windows leg uploads `ptah-msstore-2.0.0`. If
   `--prepackaged` fails for appx, apply the fallback in the plan (D1) and re-run.
5. Give the user the local sideload/WACK recipe and the 11-point smoke checklist from the plan
   ("Local verification recipe") for the downloaded MSIX.
6. Later (user decides v2 is ready): rebase on main, merge, dispatch `bump: none`,
   `store-submission: skip`; first submission by hand in Partner Center with the artifact (listing
   text, runFullTrust justification, privacy URL https://ptah.live/privacy, AI disclosure — all
   drafted in the plan "Store compliance").
7. After eSigner is cancelled: delete GitHub secrets `SSL_COM_USERNAME`, `SSL_COM_PASSWORD`,
   `SSL_COM_CREDENTIAL_ID`, `SSL_COM_TOTP_SECRET` (`gh secret delete <name> -R Hive-Academy/ptah-extension`),
   after user approval.

## Out of scope / noted for later

- Landing page and docs download links (user does them); emails to old users (user).
- macOS Developer ID signing + notarization (user has an Apple account; later task).
- Wrong org name `HiveAcademy` in links: `memory-curator-tab.component.ts:89`,
  `skill-synthesis-tab.component.ts:108`, `cron-scheduler-tab.component.ts:106` (separate fix).
- Risk: Store and GitHub installs running together share `~/.ptah` (tell users to uninstall the old
  version). `npx skills` install flow kept and to be disclosed in the listing (policies 10.2.2/10.2.3).
