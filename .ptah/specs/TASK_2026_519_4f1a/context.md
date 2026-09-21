# Context

## How this was found

The adversarial security review of `TASK_2026_491_e0da` (defect 4 of 7,
`.ptah/specs/TASK_2026_491_e0da/security-review-antigravity.md`) reported it while checking
whether the new permission policy covered every window. It does not, and the reason is a
pre-existing defect that 491 neither caused nor fixes.

Verified independently on 2026-09-21 against `origin/main` at `702c41413`.

## The defect

`apps/ptah-electron/src/services/electron-browser-capabilities.ts`, in `createSession()`:

```ts
this.window = new BrowserWindow({
  show: !this._headless,
  width: this._viewport.width,
  height: this._viewport.height,
  webPreferences: {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
  },
});
```

The four `webPreferences` flags are correct. **`partition` is absent**, so this window uses
`session.defaultSession` — the same session object as the main application window.

## Why it matters

1. **Shared credential and storage state.** The automation window navigates to arbitrary
   external web pages. It shares cookies, local storage, the HTTP cache and saved credentials
   with the trusted shell. A page loaded by automation can read state that belongs to the
   application, and can write state the application later trusts.
2. **The shell permission policy reaches a window it was not written for.** Permission handlers
   are installed on the shell's session. Because the automation window shares that session, its
   permission requests are evaluated by a policy whose trusted origin is the shell renderer, so
   every request from an automated page is denied. That is safe, but it is accidental, and it
   makes the automation window's behaviour depend on an unrelated file.

Item 2 becomes visible only once `TASK_2026_491_e0da` lands. Item 1 is true today.

## Acceptance criteria

1. The automation window is created with its own `partition`. Prefer an ephemeral partition, so
   nothing survives the session. If persistence turns out to be required for a real automation
   flow, say which flow and why, and use a named partition that is still separate from the
   default.
2. No storage written by the automation window is readable from the shell window, and the
   reverse. Pin this with a test, not with an assertion in prose.
3. The automation window gets its own permission policy on its own session. Deny by default.
   Do not let it inherit the shell policy by accident, and do not leave its session without a
   handler.
4. A test proves the two windows do not share a session object.

## Constraints

- Do not weaken `contextIsolation`, `nodeIntegration: false`, `sandbox` or `webSecurity`.
- `TASK_2026_491_e0da` is changing `apps/ptah-electron/src/windows/`. Coordinate, or land after
  it, to avoid editing the permission surface twice.

## Source

`.ptah/specs/TASK_2026_491_e0da/security-review-antigravity.md`, defect 4, severity NON-BLOCKING
for task 491 — which is correct for that task, and is not the severity of the underlying
storage-sharing problem recorded here.
