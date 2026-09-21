# Review response — `security-review-antigravity.md`

Six of the seven findings are accepted. Finding 1, one of the three blocking
findings, is declined: the permission name it names is not the name Chromium
sends, and a measurement in this worktree shows the shipped code already works.
Finding 4 is accepted as out of scope and documented in place.

The work order was finding 7 first, because a suite that cannot fail cannot
gate the rest.

---

## Finding 7 — test fidelity — ACCEPTED

**The claim**: `permission-policy.spec.ts` supplied `securityOrigin`,
`mediaTypes` and `mediaType` to every case, so the suite could not fail on
findings 1 and 2.

**What I did first**: I read Electron's own type definitions in this
worktree — `node_modules/electron/electron.d.ts`, Electron 44.4.3 (the root
`CLAUDE.md` still says Electron 40, which is documentation drift).

| Handler | Interface | Line | Shape |
| --- | --- | --- | --- |
| request | `PermissionRequest` | 10885 | `{ isMainFrame, requestingUrl }` |
| request, media | `MediaAccessPermissionRequest` | 9479 | adds `mediaTypes?`, `securityOrigin?` |
| check | `PermissionCheckHandlerHandlerDetails` | 23372 | `{ isMainFrame, requestingUrl?, embeddingOrigin?, securityOrigin?, mediaType?, … }` |

The two shapes are different, and the old spec merged them into one optimistic
fixture. I did not stop at the types. I ran a throwaway Electron main process
that installed grant-everything handlers, loaded a `file:` document and logged
every `(permission, details)` pair Chromium raised. The measured shapes are
recorded in `implementation-notes.md` and are the fixtures the spec now uses.
Three shapes matter, and none of them was representable in the old harness:

- a `clipboard-sanitized-write` check with no media field at all;
- a `media` check with `mediaType: 'audio'` and **no** `securityOrigin`;
- a `media` check with **neither** `securityOrigin` nor `mediaType`.

**The change**: `detailsFor(kind, permission, overrides)` builds a request
fixture and a check fixture separately, from the measured base shapes. A test
that wants a field absent gets it absent. Fixture provenance is documented in
the file header.

**Proof the improved suite fails against the committed code.** Command:

```
npx nx run-many -t test -p ptah-electron --skip-nx-cache
```

Observed, before any change to `permission-policy.ts`:

```
  ● Electron shell permission handlers › allows the measured media check shape: {"mediaType":"audio"}
  ● Electron shell permission handlers › allows the measured media check shape: {"securityOrigin":"file:///"}
  ● Electron shell permission handlers › allows the measured media check shape: {}
  ● Electron shell permission handlers › check handler decision matrix › accepts either drive-letter case for the same document: file:///C:/app/renderer/index.html
  ● Electron shell permission handlers › check handler decision matrix › accepts either drive-letter case for the same document: file:///c:/app/renderer/index.html
  ● Electron shell permission handlers › check handler decision matrix › trusted main frame › allowlist cell: media
  ● Electron shell permission handlers › request handler decision matrix › accepts either drive-letter case for the same document: file:///c:/app/renderer/index.html

Test Suites: 1 failed, 1 skipped, 47 passed, 48 of 49 total
Tests:       8 failed, 3 skipped, 795 passed, 806 total
```

A representative failure body:

```
  ● Electron shell permission handlers › check handler decision matrix › trusted main frame › allowlist cell: media

    expect(received).toBe(expected) // Object.is equality

    Expected: true
    Received: false
```

Eight failures against three defects: finding 2 (five of them) and finding 6
(three of them). Finding 1 produced no failure, which is the first evidence
that finding 1 is not a defect.

The review's other test-quality points are also addressed:

- The review noted that `shell-probe.js` asserted `inlineBlocked` from
  `window.inlineExecuted !== true`, which is true for any reason the script
  fails. The probe now records real `securitypolicyviolation` events and the
  spec asserts on the violated directive.
- The review noted the CSP spec proved only that the tag was written. The
  probe now also loads an `https:` image and an `http:` image and the spec
  asserts that Chromium blocked exactly the `http:` one under `img-src` — real
  enforcement, and no network needed, because the violation fires before any
  request.
- The spec now asserts through real Electron that a microphone query reports
  `granted`, a camera query reports `denied`, camera capture fails and a
  clipboard-write query reports `granted`. These are positive assertions: an
  inverted `allows()` stub fails them.

---

## Finding 1 — the clipboard allowlist — DECLINED

**The claim**: Chromium dispatches `clipboard-read` for
`navigator.clipboard.writeText()` from a `file:` origin, so the allowlist
breaks all clipboard writing, violating acceptance criterion 3.

**Why I declined it.** A declined finding needs stronger evidence than an
accepted one, so this is a measurement in this worktree, not a reading.

Step 1 — what name does Chromium send? A throwaway Electron 44 main process
granted every permission and logged each dispatch. A `file:` document called
`navigator.clipboard.writeText()`. The dispatch was:

```
{ "kind": "check",
  "permission": "clipboard-sanitized-write",
  "requestingOrigin": "file:///",
  "details": { "embeddingOrigin": "file:///", "isMainFrame": true,
               "requestingUrl": "file:///…/index.html" } }
```

`clipboard-read` never appeared for `writeText()`. It appeared only when the
page explicitly called `navigator.permissions.query({ name: 'clipboard-read' })`.
Note also that Chromium resolves this through the **check** handler and never
raises a clipboard request at all.

Step 2 — does `writeText()` actually succeed under the shipped policy? The
same document, with the committed `permission-policy.ts` installed and the
window focused:

```
CLIP_CALL:ok
```

Step 3 — control, to prove the test can fail. Same document, handlers replaced
with deny-all:

```
DENY_CLIP_CALL:NotAllowedError: Failed to execute 'writeText' on 'Clipboard': Write permission denied.
```

The exact error the review predicted appears only when the permission is
denied, and the shipped allowlist does not deny it.

Step 4 — the regression is now pinned. `shell-csp.spec.ts` asserts through real
Electron that `navigator.permissions.query({ name: 'clipboard-write' })`
reports `granted`. That query reaches the same check handler under the same
`clipboard-sanitized-write` name. The suite uses a hidden window, where
`writeText()` fails on document focus rather than on permission, so the query
and not the write is the assertion. The write itself is measured above.

**What I did not do**: I did not widen the allowlist to `clipboard-read`.
Doing so would grant the renderer read access to the user's whole clipboard for
a caller that does not exist — the three callers the review names all call
`writeText`. The reasoning, the measurement and the refusal to widen are now a
comment on the allowlist itself, because widening an allowlist is a security
change and a future reader needs the reason not to.

---

## Finding 2 — the media check branch — ACCEPTED

**The claim**: `permission-policy.ts:78-82` required
`subject.securityOrigin !== undefined`, which Electron does not supply for a
same-document permission query, so media checks fail closed.

**Confirmed, and the runtime consequence is exactly as described.** Electron's
own types say `securityOrigin` is optional on both detail shapes. The
measurement is sharper than the types. With grant-everything handlers,
`navigator.permissions.query({ name: 'microphone' })` reported `granted`. With
the committed policy installed, the same call on the same document reported:

```
{ "qMicrophone": "denied", "mic": true }
```

The microphone reported itself denied while capture worked — the split the
review predicted. Two absences, not one, were measured: `securityOrigin` is
absent on the microphone query, and a `media` check with **no `mediaType`
either** is raised around capture.

**The change**: the single `detailsSchema` is split into `requestSchema` and
`checkSchema`, matching what Electron sends on each path. The rule is now:

- an origin field is validated **only when Electron sent it**, so absence never
  decides the answer, while a hostile value still fails closed;
- a media **request** must still name its media types, because a request is the
  grant that opens a device and an unnamed type cannot be proved audio-only;
- a media **check** may omit `mediaType`, because a check reports state and
  opens nothing. Capture stays gated by the request handler.

Camera is still denied on both paths: the schema rejects `mediaType: 'video'`
and any `mediaTypes` containing `'video'`. `shell-csp.spec.ts` now proves this
through real Electron — microphone `granted`, camera `denied`, `getUserMedia({
video: true })` rejected, `getUserMedia({ audio: true })` accepted.

---

## Finding 3 — `img-src` has no `https:` — ACCEPTED

**The claim**: `img-src 'self' data: blob:` blocks remote marketplace icons and
remote markdown images.

**Verified in the source the review cites.** `smithery-surface.component.ts`
`iconSrc` returns `server.icons?.[0]?.src` — a URL from a third-party registry
entry, rendered through `<img [attr.src]>`. `provide-markdown-rendering.ts`
permits `https:` in `MEMBER_ALLOWED_URI_REGEXP`, deliberately. Neither has a
host set that is knowable at build time.

**The change**: `img-src 'self' https: data: blob:`.

**Why that is the narrowest value that works.** A host allowlist is not
available: both sources are open-ended by design, so any list would be a guess
that fails in the field. `https:` is a scheme-source, not a wildcard host —
`http:` stays denied, so a downgrade to plaintext is still blocked, and an
image source cannot execute script. It is also byte-for-byte what the VS Code
webview already ships (`webview-html-generator.ts:270`), so the two hosts do
not drift.

**The table was wrong, so I amended it.** `context.md` said `img-src` was
"explicit" and rule 1 said "no wildcard sources". Applied to `img-src` that
rule cannot be met without breaking shipped features. The table now carries
rule 5, which records the amendment, the two surfaces, and why a scheme-source
is not a wildcard. Every other directive keeps rule 1 unchanged.

---

## Finding 4 — the CDP automation window shares the default session — ACCEPTED AS OUT OF SCOPE

Not fixed here, as instructed. It is filed as TASK_2026_519_4f1a.

`installPermissionPolicy` now carries a scope note in its doc comment that
states the reach — the handlers sit on `session.defaultSession`,
`ElectronBrowserCapabilities` creates its window without a `partition`, so
every permission that window asks for is denied by the
`contents !== shellContents` test — and names the task that owns the fix. The
comment also records why denying is an acceptable interim state: it is the safe
direction, and repartitioning is a decision for the automation surface.

---

## Finding 5 — `secureRendererHtml` is not idempotent, and the hash is fragile — ACCEPTED

Two defects, and I removed the second one rather than hardening it.

**Idempotency.** `secureRendererHtml` now strips any existing CSP `<meta>` tag
before inserting its own, so a second pass cannot produce two conflicting
policies. Getting that byte-exact took one correction the new test caught: the
strip pattern must consume the newline that the insertion puts **before** the
tag, or a second pass adds a blank line and the output is not identical. The
`<base href>` rewrite was already idempotent, because an already-relative base
does not match the pattern.

`shell-csp.spec.ts` now patches the document twice, asserts the second pass is
byte-identical and lifts nothing, and feeds the twice-patched document to real
Electron, which reports exactly one `<meta>` tag.

**The hash.** I removed the hash approach instead of hardening it. Every inline
`<script>` is now lifted to its own file beside `index.html`, the tag stays in
place as `<script src="./inline-<hash>.js">`, and `script-src` is a bare
`'self'`. There is no hash left to go stale, so the whole failure mode — a
later whitespace edit to `dist/index.html` silently blocking the theme
bootstrap — cannot occur.

**Why not a nonce.** A nonce baked into a shipped static file is a constant
that any injected script can read back out of the DOM, so it would have been
strictly weaker than the hash it replaced. Externalising is strictly stronger
than both: the script is subject to `'self'` like every other script in the
document.

**Why the tag stays where it is.** The theme bootstrap must run before the
build's `styles.css` link, and an external classic script in `<head>` still
blocks the parser, so the ordering contract that comment documents is
preserved. Verified against the real built document: one script lifted, the
second pass identical, one CSP tag. Verified through real Electron: the theme
still resolves to `anubis-light` from the seeded state.

The previous run's lifted files are pruned only when this run lifted
something, so a second pass over an already-patched directory does not delete
the file the document now points at.

---

## Finding 6 — `URL.pathname` compared by exact string equality — ACCEPTED

**The claim**: Windows `file:` drive letters vary in case, so a legitimate
request can be denied.

**The change**: `normalizePathname` upper-cases **only** a leading `/<letter>:`
drive prefix. Everything after it is still compared byte-exact, so
`/C:/app/renderer/Index.html` still fails against `index.html`, and
`index.html.bak` still fails against `index.html`. This is a case
normalisation, not a loosening: the comparison is still exact equality, and the
scheme-and-host match in `parseTrustedUrl` is untouched.

Three of the eight pre-fix failures were this finding, so it was pinned before
it was fixed. The spec exercises both drive-letter cases for both handlers.

---

## What was deliberately not weakened

`contextIsolation`, `nodeIntegration: false`, `sandbox`, `webSecurity` and
`installNavigationGuard` are unchanged, and `permission-policy.spec.ts` still
pins all five by reading `main-window.ts`. Deny-by-default is unchanged. Origin
matching is still exact on scheme and host, with no prefix or substring match.
The near-match cases — a different scheme, a host for which the empty host is a
prefix, a sibling file, a `data:` URL, a malformed string, an empty string —
are all still denied, for both handlers.

---

## Verification

```
npx nx run-many -t test -p ptah-electron
```

```
Test Suites: 1 skipped, 48 passed, 48 of 49 total
Tests:       3 skipped, 806 passed, 809 total

 NX   Successfully ran target test for project ptah-electron and 6 tasks it depends on
```

The one skipped suite is `git-watcher.stress.perf.spec.ts`, which is
performance-gated behind an environment variable and was skipped before this
work as well.

```
npx nx run-many -t lint typecheck -p ptah-electron
```

```
✖ 12 problems (0 errors, 12 warnings)

> nx run ptah-electron:typecheck
> tsc --noEmit --project apps/ptah-electron/tsconfig.app.json

 NX   Successfully ran targets lint, typecheck for project ptah-electron
```

All twelve lint warnings are pre-existing and none is in a file this work
touched: `verify-packed-wasm.js`, `post-window.ts`, `workspace-restore.ts`,
`electron-adapters.ts`, `wizard-seed.integration.spec.ts` and
`electron-browser-capabilities.ts`.

Not run: the `apps/ptah-electron-e2e` Playwright suite (acceptance criterion
3). It needs a packaged desktop build and is outside the two commands this task
names.
