# Context

## Evidence

`apps/ptah-extension-vscode/src/services/webview-html-generator.ts:138` passes
the search string:

```
'<meta charset="utf-8">'
```

`apps/ptah-extension-webview/src/index.html:4` emits:

```
<meta charset="utf-8" />
```

The two strings are not equal. `String.prototype.replace` with a string search
argument matches literally, so the replacement is a no-op and the generator
returns the document unchanged. No `Content-Security-Policy` meta tag reaches
the webview.

The second, independent proof: the inline theme-boot script near
`apps/ptah-extension-webview/src/index.html:50` carries no `nonce` attribute.
It executes. Under any CSP that this generator would have injected, an inline
script without a nonce is blocked. It is not blocked, so no policy is enforced.

## Scope

In scope:

1. Repair the match so the policy is injected for every document the generator
   produces. Do not depend on the exact spelling of the charset tag. Anchor on
   something the Angular build cannot reformat, or insert the tag positionally
   rather than by string replacement.
2. Add a nonce to the inline theme-boot script and thread the same nonce
   through the generated policy.
3. Decide and implement the policy for lazily loaded chunks. TASK_2026_524
   converted nine surfaces to lazily loaded routes, so the number of script
   requests the policy must admit grew. A `script-src` that admits only the
   nonce will block those chunks unless the loader propagates it.
4. Add a regression test that fails when the policy is absent from the
   generated document. A test that only asserts the generator's output string
   is not enough — it must assert against the real built document, the way
   `webview-html-generator.initial-view.spec.ts` does.

Out of scope: the Electron shell policy. TASK_2026_491_e0da did that half and
is done.

## Why the two halves cannot be split

Repairing the match alone turns a policy that is currently inert into a policy
that is enforced. The moment it is enforced, the un-nonced inline theme-boot
script is blocked and the webview boots without its theme, and any lazily
loaded chunk that the policy does not admit fails to load. Landing the match
repair on its own converts a silent security gap into a visible boot failure.

## Acceptance criteria

1. The generated VS Code webview document contains a `Content-Security-Policy`
   meta tag. A test proves it.
2. The inline theme-boot script carries a nonce that the policy admits.
3. Every routed surface from TASK_2026_524 still loads in a live VS Code
   webview with the policy enforced. This must be clicked, not inferred.
4. No `unsafe-inline` in `script-src`.

## Open questions

- Does the Angular build rewrite the charset tag between source and output? The
  source file uses the self-closing form. Confirm what the built
  `index.html` in `dist/` actually contains before choosing the new anchor.
- Do the lazily loaded chunks need `script-src` nonce propagation, or does
  VS Code's `asWebviewUri` scheme let a `script-src <cspSource>` entry cover
  them without per-chunk nonces?
