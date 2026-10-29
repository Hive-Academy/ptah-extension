# HANDOFF — Microsoft Store (MSIX) channel for Ptah Electron v2.0.0

Updated 2026-10-20 (second session). Read this first, then `implementation-plan.md` (section
"User answers" overrides earlier plan text). `research-report.md` and `context.md` are background.

## Goal

1. Ship the Ptah Electron app on Windows only through the Microsoft Store (MSIX, re-signed by
   Microsoft), starting at v2.0.0. macOS/Linux keep publishing to the GitHub Release.
2. SSL.com eSigner, NSIS `.exe` and all eSigner signing are retired (done, see below).
3. The user does NOT want v2.0.0 published until they finish their own testing. PR #778 must stay
   a DRAFT and must NOT be merged until the user says v2 is ready.

## Where the work is

- Worktree: `D:/projects/ptah-extension/.claude-worktrees/microsoft-store`
- Branch: `feat/microsoft-store` (from `origin/main` at `79ad83bdb`), pushed.
- **Draft PR #778**: https://github.com/Hive-Academy/ptah-extension/pull/778 (DO NOT MERGE).
- `node_modules` in the worktree is a JUNCTION to `D:/projects/ptah-extension/node_modules`.
  Never run `npm install` in the worktree. Before `git worktree remove`, run
  `cmd /c rmdir D:\projects\ptah-extension\.claude-worktrees\microsoft-store\node_modules`.

### Commits on the branch

| SHA | Pushed | Content |
|---|---|---|
| `8aec58cf3` | yes | feat(electron): appx block in `electron-builder.yml` + 4 Store tiles + generator script |
| `34b4d7b4a` | yes | feat(electron): `readDistributionChannel()`/`isMicrosoftStoreBuild()`; UpdateManager skips GitHub in Store builds |
| `0507f9378` | yes | feat(chat-ui,chat): "Report AI response" flag button (mailto help@ptah.live), policy 11.16 |
| `04a2d8d5e` | yes | ci(release): MSIX build in Windows leg, `store` job, `bump: none`, version guard, ONNX patch/verify, version 2.0.0 |
| `bc4bb9dd3` | yes | docs: research report and plan |
| `56eb00852` | yes | ci(release): remove eSigner, SSL_COM_* secrets, NSIS and the Windows `.exe` from the release |
| `1af8a1a76` | yes | fix(chat-ui): report link used `new Date()` at render time (non-deterministic render); now the message's own time ("Response time") |
| `7f9a55130` | yes | docs(task-specs): first HANDOFF |
| `4e98f64b3` | **NO** | feat(electron,landing,release): send Windows users to the Store (see below) |
| (this file) | **NO** | docs(task-specs): handoff update |

`4e98f64b3` contents:
- `publish-electron.yml` release step: `body:` with a Windows → Microsoft Store notice before the
  generated notes. Old 0.1.x installs show the release body in their update dialog and their
  "Download" opens the release page (no `.exe` there), so this notice is their only route.
- `update-manager.ts`: on win32, when a release has no `.exe`, `downloadUrl` is
  `MICROSOFT_STORE_URL` (`https://apps.microsoft.com/detail/9N80K3HFX0JT`). Spec updated, 39/39 pass.
- `download-page.component.ts` (landing): a release with no Windows asset shows "Get it from the
  Microsoft Store"; older releases keep their `.exe` links.
- NOT yet verified with nx: `nx test`/`typecheck` for `ptah-electron` and `ptah-landing-page`.
  Only the update-manager spec (Jest) and eslint on the changed files ran.

## Verification status

- Done (before `4e98f64b3`): `nx test`, `typecheck`, `lint` for ptah-electron, chat-ui, chat — all
  pass (lint 0 errors, no warnings in changed files). Pre-push gate passed on the first push.
- CI dry run passed: run 39333516872 (prepare + 3 build legs success; release/store skipped).
  Artifact `ptah-msstore-2.0.0` (~715 MB). **A1 (`--win appx --prepackaged`) and A6 (stage dir
  name) hold.**
- Still unverified (only the first submission settles them): A7 `msstore publish` accepts the
  `.appx`; an unsigned appx passes Store upload validation.

## External setup (all done)

- Partner Center product **Ptah**, MSIX or PWA app, In draft. Store ID `9N80K3HFX0JT`.
  Identity: Name `PtahOrchestra.Ptah`, Publisher `CN=4E52CB56-1E00-4214-9A22-F65A54BFF522`,
  PublisherDisplayName `Ptah Orchestra`, PFN `PtahOrchestra.Ptah_rwqmhy9dq1amj`.
  **Name reservation lapses ~2027-01-19 unless the first submission is made before then.**
- Partner Center account: Individual, Seller ID `96757110`.
- Entra tenant `2163618d-9f83-4ef1-b829-84254d1f9e2d`; Entra app `ptah-msstore-ci`, client ID
  `1e347197-db51-41c3-82d6-bcd820c26473`, Partner Center role **Manager**.
- GitHub repo variables `MSSTORE_TENANT_ID`, `MSSTORE_CLIENT_ID`, `MSSTORE_SELLER_ID`,
  `MSSTORE_PRODUCT_ID`; secret `MSSTORE_CLIENT_SECRET` (**expires ~2027-04-17**; rotate in Entra →
  Certificates & secrets, then `gh secret set MSSTORE_CLIENT_SECRET`).

## SSL.com (closed)

- The user revoked the certificate, removed the eSigner subscription, and SSL.com voided the
  October invoice. No refund for the remaining license months (user accepted).
- GitHub secrets `SSL_COM_USERNAME`, `SSL_COM_PASSWORD`, `SSL_COM_CREDENTIAL_ID`,
  `SSL_COM_TOTP_SECRET` were deleted 2026-10-20 with user approval. No workflow refers to them.

## User's plan before restart

1. Other sessions (tasks 593/702, 707, 662, 705) finish and open their PRs; the user merges them.
2. The user restarts this task with the prompt below.
3. The user tests a v2.0.0 MSIX that contains all merged work, then decides go-live.

The installed (live) Ptah app hosts the Claude sessions, so the user uninstalls it only after the
other sessions are done. `~/.ptah` survives the NSIS uninstall (`deleteAppDataOnUninstall` is not
set); a backup copy is still advised.

## Next steps (in order, after restart)

1. Machine queue: ask peer sessions (`ListAgents`) whether any heavy job runs. If none respond or
   none exist, ask the user before heavy checks. One heavy check at a time.
2. Rebase on main (other PRs are merged by then):
   ```bash
   cd D:/projects/ptah-extension/.claude-worktrees/microsoft-store
   git fetch origin && git rebase origin/main
   ```
   Resolve conflicts (likely `publish-electron.yml`, `apps/ptah-electron/package.json` version —
   keep `2.0.0`, `update-manager.ts`, chat-ui `index.ts`).
3. Checks, one at a time, from the worktree:
   ```bash
   npx nx test ptah-electron --parallel=1 2>&1 | tail -20
   npx nx test ptah-landing-page --parallel=1 2>&1 | tail -20
   npx nx run-many -t test -p @ptah-extension/chat-ui @ptah-extension/chat --parallel=1 2>&1 | grep -E "Running target|Tests:|FAIL|Successfully|failed"
   npx nx typecheck ptah-electron --parallel=1 2>&1 | tail -15
   npx nx typecheck ptah-landing-page --parallel=1 2>&1 | tail -15
   npx nx lint ptah-electron --parallel=1 2>&1 | tail -15
   npx nx lint ptah-landing-page --parallel=1 2>&1 | tail -15
   ```
   Add chat-ui/chat typecheck+lint only if the rebase touched them. Fix failures with new commits.
4. Push (background): `git push --force-with-lease origin feat/microsoft-store` (a rebase needs
   it; the PR is a draft and only this task uses the branch). Keep PR #778 a draft.
5. CI dry run (publishes nothing):
   ```bash
   gh workflow run publish-electron.yml --ref feat/microsoft-store -f bump=none -f dry-run=true
   gh run list --workflow publish-electron.yml --branch feat/microsoft-store -L 1
   ```
   Watch once in the background (`gh run watch <id> --exit-status`). Confirm artifact
   `ptah-msstore-2.0.0`. Update the PR test plan with the new run ID.
6. Give the user the sideload recipe and S1–S11 checklist (implementation-plan.md "Local
   verification recipe"), using the CI artifact:
   `gh run download <run-id> -n ptah-msstore-2.0.0 -D $env:TEMP\ptah-msstore`.
   S10 expects a mail draft to **help@ptah.live** with "Response time" in the body.
7. Only when the user says v2 is ready: mark the PR ready, merge, dispatch
   `publish-electron.yml` with `bump: none`, `store-submission: skip`; the first submission is by
   hand in Partner Center with the artifact (listing text, runFullTrust justification, privacy URL
   https://ptah.live/privacy, AI disclosure — drafted in the plan "Store compliance"). The Store
   link in the release notes and download page works only after the listing is public.

## Rules to remember

- Global memory has a TEMPORARY rule until 2026-10-24 00:00: CLI lanes (`ptah_agent_spawn`)
  instead of Claude subagents; the orchestrator does only small edits, verification and git.
- Project CLAUDE.md: memory-safe checks (`--parallel=1`, `--maxWorkers=2`, one heavy check at a
  time), commit in the foreground, push in the background, commitlint subject ≤ 72 chars.

## Out of scope / noted for later

- Docs site download links; emails to old users (user).
- macOS Developer ID signing + notarization (later task).
- Wrong org name `HiveAcademy` in links: `memory-curator-tab.component.ts:89`,
  `skill-synthesis-tab.component.ts:108`, `cron-scheduler-tab.component.ts:106` (separate fix).
- Store and GitHub installs share `~/.ptah` (users must uninstall the old version). `npx skills`
  install flow kept and disclosed in the listing (policies 10.2.2/10.2.3).
