---
id: TASK_2026_527_a7f3
status: backlog
type: BUGFIX
title: >-
  The VS Code webview ships with no Content-Security-Policy because the
  charset replacement never matches
description: >-
  WebviewHtmlGenerator builds a CSP meta tag and injects it by replacing the
  literal string '<meta charset="utf-8">' in the built document. The webview
  document emits '<meta charset="utf-8" />' with a space and a self-closing
  slash, so the replacement never matches and the policy is never injected.
  The VS Code webview therefore enforces no Content-Security-Policy at all.
  The inline theme-boot script in the webview index carries no nonce and still
  runs, which is the proof that no policy is in force. TASK_2026_491_e0da fixed
  the Electron half of this and is done. Repairing the string match turns the
  nonce question from theoretical into real for every lazily loaded chunk, so
  the match repair and the nonce work must land together or the webview will
  fail to boot.
---

# The VS Code webview ships with no Content-Security-Policy

See `context.md`.
