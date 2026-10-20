# Batch 38 report

## Files changed

- `apps/ptah-electron/src/activation/plugin-activation.ts`: removed the candidate-store read and candidate-folding implementation. Kept the exported `readDormantSkillSlugs()` compatibility port returning an empty list because `phase-2-libraries.ts` still calls it. Kept the shipped skills root and registry catalog/reconcile paths.
- `apps/ptah-electron/src/activation/plugin-activation.spec.ts`: removed the candidate-store fixture and mock token.
- `apps/ptah-electron/src/activation/boot-coordinator.ts`: removed the synthesis ref initializer and excluded the retired ref from the host `BootRefs` type.
- `apps/ptah-electron/src/activation/boot-heavy-services.ts`: removed assignment from the Thoth synthesis ref; kept `onSkillTriggerStarted`.
- `apps/ptah-electron/src/activation/shutdown.ts`: removed synthesis stop; kept skill trigger stop.
- `apps/ptah-electron/src/activation/boot-order.spec.ts`: removed synthesis service fixtures, retry expectation, and start-order assertion; retained the live skill trigger ref assertion.
- `apps/ptah-electron/src/activation/wire-runtime.spec.ts`: removed the synthesis service fixture; retained trigger, invocation recorder, spec harvester, and metrics fixtures.
- `apps/ptah-electron/src/activation/skill-repropagation.ts` and `.spec.ts`: updated the repropagation description and removed an unnecessary synthesis module mock; retained propagation behavior.
- `apps/ptah-electron/src/services/tray/tray.service.ts`: removed stale comments describing the deleted synthesis drain; retained existing tray controls and settings behavior.

`wire-runtime.ts` and `main.ts` required no pipeline import or boot change. Their retained settings and tray paths are described below.

## What stays wired

- Shipped skills root via `resolveSkillsRoot`, user-layer mirror/reconcile, registry catalog sync, and skill repropagation.
- `onSkillTriggerStarted` to `refs.skillTrigger`, plus skill trigger shutdown.
- Spec harvester, invocation recorder, foreground activity, Library service registration and RPC exposure.
- Tray pause controls, quit item, and existing optional keepalive setting.

## Acceptance rg result

Command: `rg -n "SKILL_DRAIN_JOBS|skill-drain-jobs|SKILL_BACKLOG_CLEANUP|skill-backlog-cleanup|skill_candidates|refs\.skillSynthesis|\.skillSynthesis\b" apps/ptah-electron/src`

One hit remains: `apps/ptah-electron/src/main.quit-path.spec.ts:347: refs.skillSynthesis = {`. This file is outside the allowed edit list. No hit remains in the files edited for this batch. No test, typecheck, lint, build, serve, e2e, or Electron run was performed, per task rule.

## Decisions

- Kept the `readDormantSkillSlugs()` export as an empty compatibility port because the out-of-scope `phase-2-libraries.ts` calls it. The candidate store is no longer queried.
- Kept the tray's user-facing Pause skills switch and existing optional keepalive behavior. Plan row 34 only says to remove pipeline imports/keepalive, without specifying removal of a visible tray control or its dependent specs.
- Left the `skillSynthesis.enabled` pause gate in `wire-runtime.ts` and its spec, as explicitly allowed.

## Proposed Removals

- Consider retiring `skillSynthesis.trayKeepalive` and its close-window behavior in a coordinated tray/main/spec change. Plan row 34 is silent on the user-visible tray behavior, and `tray.service.spec.ts` and `main.quit-path.spec.ts` are outside this batch's allowed files.
- Consider retiring the Pause skills tray item when its settings semantics are decided. It remains intact here.

## Clarifications Needed

- `apps/ptah-electron/src/main.quit-path.spec.ts:347` still writes `refs.skillSynthesis`, and the same fixture indexes `BootRefs['skillSynthesis']` on line 349. The spec is outside the allowed edit list; with the retired ref excluded from `BootRefs`, it needs a coordinated update before the Electron typecheck and quit-path spec can pass. Its expected stop order may also need adjustment.
