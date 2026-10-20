# Batch 64 report

## Changes

- `libs/shared/src/lib/types/messages/message-constants.ts:271`: removed the retired push constant and its comment.
- `libs/shared/src/lib/types/messages/payload-map.ts:136,170,424`: removed the now-unused `SkillSynthesisEventWire` import, `SkillSynthesisEventPayload` interface, and payload-map entry.
- `libs/shared/src/lib/types/rpc/rpc-curator-diagnostics.types.ts:51`: reworded the event ID comment to refer to the diagnostics snapshot without naming the retired push.

## Acceptance search

`rg -n "SKILL_SYNTHESIS_EVENT|skillSynthesis:event|SkillSynthesisEventPayload" libs apps tools` still returns:

```text
libs\frontend\core\src\lib\services\back-office-activity.service.spec.ts:507:    send(service, 'skillSynthesis:event', {
libs\shared\src\lib\types\rpc\host-source-registry.baseline.ts:537:  'skillSynthesis:event',
```

Both files are outside this batch's edit allowlist. The acceptance criterion therefore remains unmet. No matching specs were found under `libs/shared/src/lib/types/messages/`.

## Decisions

- Kept changes within the three allowed source files. The remaining frontend spec and shared RPC baseline need ownership from another batch.
- Ran no Nx, Jest, TypeScript, npm, build, lint, or other checks, as instructed. Verification was limited to read-only searches and diff inspection.

## Could not do

- Remove the two out-of-scope references or establish whether an exhaustive switch or record elsewhere breaks; checks were prohibited and no other matching reference appeared in the search.
