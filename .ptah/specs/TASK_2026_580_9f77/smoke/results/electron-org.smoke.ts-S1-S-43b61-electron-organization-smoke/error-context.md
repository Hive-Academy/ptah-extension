# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: electron-org.smoke.ts >> S1 S5 S6 S7 electron organization smoke
- Location: electron-org.smoke.ts:121:5

# Error details

```
TimeoutError: page.waitForURL: Timeout 120000ms exceeded.
=========================== logs ===========================
waiting for navigation until "load"
  navigated to "file:///D:/projects/ptah-extension/.claude-worktrees/task-580/dist/apps/ptah-electron/renderer/index.html"
============================================================
```

# Test source

```ts
  1   | import * as fs from 'fs';
  2   | import * as os from 'os';
  3   | import * as path from 'path';
  4   | import {
  5   |   _electron,
  6   |   type ElectronApplication,
  7   |   type Page,
  8   | } from '@playwright/test';
  9   |
  10  | export interface LaunchOptions {
  11  |   /** Extra environment variables to merge into the Electron process env. */
  12  |   env?: Record<string, string>;
  13  |   /** Extra args appended after the entry point. */
  14  |   args?: string[];
  15  |   /** Override launch timeout in ms (default 30_000). */
  16  |   timeout?: number;
  17  |   /**
  18  |    * Profile directory to launch against. Defaults to a fresh `mkdtemp` dir that
  19  |    * is removed when the app exits. The docs-screenshot harness passes a
  20  |    * pre-seeded copy of the real profile so surfaces paint real data.
  21  |    */
  22  |   userDataDir?: string;
  23  |   /**
  24  |    * Wait until the preparing shell has navigated to the Angular renderer.
  25  |    * Defaults to true. Lifecycle specs that deliberately close during boot may
  26  |    * opt out and wait only for Electron's first (preparing) window.
  27  |    */
  28  |   waitForRenderer?: boolean;
  29  | }
  30  |
  31  | const DEFAULT_LAUNCH_TIMEOUT_MS = 30_000;
  32  |
  33  | /**
  34  |  * Wait for the reusable main window to leave the preparing shell and load the
  35  |  * real Angular renderer. Since TASK_2026_411 the preparing shell is Electron's
  36  |  * first window, so `electronApplication.firstWindow()` alone no longer means
  37  |  * the IPC/RPC surface has finished registering.
  38  |  */
  39  | export async function waitForPtahRenderer(
  40  |   app: ElectronApplication,
  41  |   timeoutMs = DEFAULT_LAUNCH_TIMEOUT_MS,
  42  | ): Promise<Page> {
  43  |   const win = await app.firstWindow({ timeout: timeoutMs });
> 44  |   await win.waitForURL(
      |             ^ TimeoutError: page.waitForURL: Timeout 120000ms exceeded.
  45  |     (url) =>
  46  |       url.protocol === 'file:' && url.pathname.endsWith('/renderer/index.html'),
  47  |     { timeout: timeoutMs },
  48  |   );
  49  |   return win;
  50  | }
  51  |
  52  | /**
  53  |  * Where the launched app's SQLite database lives.
  54  |  *
  55  |  * `--user-data-dir` moves Electron's userData, NOT `os.homedir()`, and the DB
  56  |  * path is resolved from the home directory — so without this every launch that
  57  |  * did not also override HOME opened the developer's real
  58  |  * `~/.ptah/state/*.sqlite` and migrated it forward from the working tree. That
  59  |  * is how a capture run left an installed build unable to open its own data
  60  |  * (TASK_2026_291). `PTAH_DB_PATH` is honoured ahead of any profile by
  61  |  * `persistence-sqlite/src/lib/db-path.ts`, so pointing it at a temp file makes
  62  |  * the isolation explicit instead of a side effect of `NODE_ENV`.
  63  |  */
  64  | function isolatedDbPath(): string {
  65  |   return path.join(
  66  |     fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-e2e-db-')),
  67  |     'ptah-e2e.sqlite',
  68  |   );
  69  | }
  70  |
  71  | /**
  72  |  * Resolves the absolute path to the Electron main entry. The Nx build-dev
  73  |  * target writes `main.mjs` directly to `dist/apps/ptah-electron`.
  74  |  */
  75  | export function resolveElectronEntry(): string {
  76  |   return path.resolve(
  77  |     __dirname,
  78  |     '..',
  79  |     '..',
  80  |     '..',
  81  |     '..',
  82  |     'dist',
  83  |     'apps',
  84  |     'ptah-electron',
  85  |     'main.mjs',
  86  |   );
  87  | }
  88  |
  89  | /**
  90  |  * Launch the built Ptah Electron app and return the ElectronApplication
  91  |  * handle. The caller is responsible for closing it (the `electronApp`
  92  |  * fixture does this automatically).
  93  |  */
  94  | export async function launchPtah(
  95  |   opts: LaunchOptions = {},
  96  | ): Promise<ElectronApplication> {
  97  |   const entry = resolveElectronEntry();
  98  |
  99  |   if (!fs.existsSync(entry)) {
  100 |     throw new Error(
  101 |       `[ptah-electron-e2e] Electron entry not found at:\n  ${entry}\n\n` +
  102 |         `Run \`npx nx build-dev ptah-electron\` first (the 'e2e' Nx target\n` +
  103 |         `chains this via dependsOn).`,
  104 |     );
  105 |   }
  106 |
  107 |   const env: Record<string, string | undefined> = {
  108 |     ...process.env,
  109 |     NODE_ENV: 'test',
  110 |     PTAH_E2E: '1',
  111 |     // Inherited PTAH_DB_PATH is dropped, not merged: a stale value from the
  112 |     // shell would silently re-point every spec. A caller that wants a specific
  113 |     // database passes it through `opts.env` below.
  114 |     PTAH_DB_PATH: isolatedDbPath(),
  115 |     ...(opts.env ?? {}),
  116 |   };
  117 |   // Publish the effective database back to the Playwright process so a spec
  118 |   // can read the rows the app just wrote (`skill-telemetry-db.ts`) without
  119 |   // re-deriving a path the launcher chose.
  120 |   process.env['PTAH_E2E_DB_PATH'] = env['PTAH_DB_PATH'];
  121 |   delete env['ELECTRON_RUN_AS_NODE'];
  122 |   const ciArgs = process.env['CI']
  123 |     ? ['--no-sandbox', '--disable-dev-shm-usage']
  124 |     : [];
  125 |
  126 |   const userDataDir =
  127 |     opts.userDataDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-e2e-udd-'));
  128 |   const ownsUserDataDir = opts.userDataDir === undefined;
  129 |
  130 |   const app = await _electron.launch({
  131 |     args: [
  132 |       entry,
  133 |       `--user-data-dir=${userDataDir}`,
  134 |       ...ciArgs,
  135 |       ...(opts.args ?? []),
  136 |     ],
  137 |     env: env as Record<string, string>,
  138 |     timeout: opts.timeout ?? DEFAULT_LAUNCH_TIMEOUT_MS,
  139 |   });
  140 |   if (ownsUserDataDir) {
  141 |     app.process().on('exit', () => {
  142 |       fs.rm(userDataDir, { recursive: true, force: true }, () => undefined);
  143 |     });
  144 |   }
```
