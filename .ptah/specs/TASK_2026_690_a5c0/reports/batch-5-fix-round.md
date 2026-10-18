# Batch 5 fix round

## Fixes

- `libs/frontend/chat/src/lib/components/organisms/execution/execution-node.ptah-ui.spec.ts:82` and `execution-node.send-message.spec.ts:67`: added `fillHeight = input(false)` to both inline agent bubble stubs so the execution node's new binding is recognized.
- `libs/frontend/chat/src/lib/components/organisms/execution/inline-agent-bubble.component.ts:71`: the host gains flex growth only while fill mode is expanded; at `:91` the root's `flex-1` and `min-h-0` use the same condition. The grid collapse rules remain in place. `inline-agent-bubble.component.spec.ts:144` now asserts collapsed fill mode removes root flex growth and the host's expanded class.
- `libs/frontend/chat/src/lib/components/templates/chat-view.dock.spec.ts:624`: after switching back to tab 1, asserts the display sheet host is shown.

## Verification

`git diff --check` found no whitespace errors in the five edited source/spec files. Tests, builds, typecheck, and lint were not run, as instructed.

## Anything not done

None.
