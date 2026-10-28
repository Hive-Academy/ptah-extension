# P1 fix round B — short re-review

Reviewed the current files directly against the original review and both fixer reports. S1/S2 use the fixer's labels; B1/B2/B3 correspond to original findings 1/2/3. No git, tests, or builds were run. Source files were not modified.

| Finding | Status | Evidence file:line |
| --- | --- | --- |
| S1 — persisted config validation | FIXED | `libs/backend/agent-sdk/src/lib/helpers/plugin-config-home.ts:95` validates all persisted lists; `:87` explicitly discards invalid timestamp metadata; `:148` parses unknown input; `:193` and `:256` validate home records. `libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts:1072` and `:1087` use the strict parser for policy reads. |
| S2 — incomplete initialization options | FIXED | `libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts:90` requires both fields; `:552` makes the entire options object optional; `:557` applies it together and `:567` warns when storage cannot support it. |
| B1 — interrupted plugin-agent publication | FIXED | `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-plugin-agents.ts:415` reads and hashes the publication content once; `:428` writes intent before body and sidecar. `:448` checks pending provenance, `:459` rejects edited bodies, and `:467` restores the sidecar. Restart, user-edit, and foreign-source cases are covered in `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-plugin-agents.spec.ts:238`, `:273`, and `:294` (read, not executed). |
| B2 — ambiguous legacy ownership | PARTIAL | `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-mirror.service.ts:645` computes ambiguity only over current pass roots; `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-plugin-agents.ts:184` still declares ownership whenever that set contains only one matching basename. Guards at `user-layer-mirror.service.ts:1764` and `:1838` preserve clones when both sources participate, but do not establish uniqueness across installed sources. See remaining scenario below. |
| B3 — counted failures reported as success | FIXED | `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-mirror.service.ts:208` sums file and retirement errors. Electron checks at `apps/ptah-electron/src/activation/plugin-activation.ts:414` precede the backfill stamp at `:425`; reconcile checks at `:550`, aggregation at `:613`, and broadcast at `:619` propagate failure. VS Code checks at `apps/ptah-extension-vscode/src/activation/plugin-activation.ts:158`, `:225`, and `:266` propagate failure. CLI runs both passes and checks their combined counts at `libs/backend/cli-engine/src/lib/bootstrap/harness-boot.ts:147` and `:153`. |

## Remaining B2 gap

Serious, existing finding not fully resolved: plugin A originally supplied a legacy clone with `pluginId: 'toolkit'` and no `sourceRef`. A and B remain installed at different external coordinates sharing that basename. Disable A while B is enabled. Electron supplies only enabled external plugin paths (`apps/ptah-electron/src/activation/plugin-activation.ts:353`; resolution iterates enabled IDs at `libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts:1281`). B is now the sole candidate in the pass, so the new predicate returns `owned`. Reconcile assigns B's identity at `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-mirror.service.ts:1769` and can overwrite an unedited A clone with B's content at `:1780`. The analogous file-clone path assigns identity at `:1843`.

The two-order regression correctly covers both sources participating (`libs/backend/agent-generation/src/lib/services/user-layer/user-layer-mirror.service.plugin-agents.spec.ts:570`), but its single-candidate follow-up at `:619` retains the true owner only. It does not cover retaining B instead. This limitation is also acknowledged in the fixer's report. Establish ambiguity across installed sources, including disabled candidates, or require trustworthy provenance before assigning identity. Add the disabled-original-owner case; preserve the clone and report ambiguity when ownership remains unresolved.

## New defects

1. None identified at Blocking or Serious severity in the reviewed fixes. The B2 gap above is a remaining original finding.

Verdict: REVISE
