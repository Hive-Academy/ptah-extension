# Context
Source: HANDOFF.md follow-up 7 (security).
- The `settings:set` RPC lets the renderer (webview) write `gateway.*.tokenCipher` and provider
  endpoint keys. A compromised renderer could redirect provider traffic or replace stored tokens.
- Expected: an allow-list (or deny-list) of renderer-writable keys at the RPC boundary, with specs.
- Security decision: confirm the key list with the user before implementation.
