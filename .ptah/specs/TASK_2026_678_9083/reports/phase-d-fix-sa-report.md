# Phase D S-A fix

## Changes

- `libs/frontend/chat-state/src/lib/command-center-persona.ts:7-32`: owns the shared roster tag, a complete example, and the exact AskUserQuestion question format. `libs/frontend/chat-state/src/index.ts:76-77` exports both constants.
- `libs/frontend/command-center/src/lib/model/tribunal-roster-proposal.ts:2,108`: parser imports the shared tag. `libs/frontend/command-center/src/lib/components/command-center-page.controller.ts:11` imports it directly as well.
- `libs/frontend/command-center/src/lib/components/command-center-page.controller.ts:81-126,213-231`: an untagged question with a Confirm-like choice during a matching Tribunal request is hidden from the ordinary card, answered `Decline` once through the Tribunal transport, and reported with an `Invalid Tribunal proposal` toast. For ordinary questions with Confirm-like choices, the choices omit affirmative labels.
- `libs/frontend/command-center/src/lib/components/command-center-page.controller.ts:403-414`: click and voice answers beginning with `confirm`, `yes`, `approve`, or `go ahead` are rejected for such a question. Voice uses this same controller callback at line 196, so no voice-loop change was needed.

## Final persona format text

“The AskUserQuestion question text must be ONLY `<TRIBUNAL_ROSTER_PROPOSAL>` followed by one JSON object and `</TRIBUNAL_ROSTER_PROPOSAL>`, with no other text. The JSON object must contain proposalId, nonce, rootSessionId, move, options ["Decline","Confirm"], objective, rounds, and lanes (at least one object with laneId, family, displayName, cli, and optional role). Copy nonce and rootSessionId exactly from the request block. Allowed move values: council, forge, race, relay, crucible. Allowed cli values: codex, copilot, cursor, antigravity, opencode, pi, grok, ptah-cli. Allowed role values: plan, architect, implement, review, executor, judge; omit role for council, forge, and race. Use rounds 1 except for crucible.”

Example embedded in the persona:

`<TRIBUNAL_ROSTER_PROPOSAL>{"proposalId":"proposal-1","nonce":"nonce-from-request","rootSessionId":"root-from-request","move":"council","options":["Decline","Confirm"],"objective":"Review the change","rounds":1,"lanes":[{"laneId":"codex#1","family":"codex","displayName":"Codex","cli":"codex"}]}</TRIBUNAL_ROSTER_PROPOSAL>`

Persona length: **2,355 characters**; RPC bound: **16,384 characters** (`libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.schema.ts:35`). The existing persona bound assertion remains at `libs/frontend/chat-state/src/lib/command-center-persona.spec.ts:35`.

## Specs and verification

- `libs/frontend/command-center/src/lib/model/tribunal-roster-proposal.contract.spec.ts:15`: “parses the exact question text shown in the persona example.”
- `libs/frontend/command-center/src/lib/model/tribunal-roster-proposal.contract.spec.ts:32`: “names every schema field, delimiter, and allowed enum value.”
- `libs/frontend/command-center/src/lib/components/command-center-page.controller.spec.ts:469`: “declines an untagged Tribunal choice and rejects click and spoken approval.”
- `libs/frontend/command-center/src/lib/components/command-center-page.controller.spec.ts:513`: “filters affirmative choices and answers on an ordinary Confirm question.”
- Jest Command Center: `Test Suites: 32 passed, 32 total`; `Tests: 221 passed, 221 total` (run twice; same result). Jest chat-state persona: `Test Suites: 1 passed, 1 total`; `Tests: 2 passed, 2 total`.
- Scoped `tsc` grep for `src/`: **no output**.
- ESLint on all changed source/spec files: **exit 0, no findings**. Prettier `--write` completed; `--check`: **All matched files use Prettier code style!**

## Decisions

- The persona spells out Tribunal move and role values because importing `@ptah-extension/tribunal-panel/phase` into chat-state triggered the Nx circular dependency lint rule. The contract spec compares those lists against `TRIBUNAL_MOVES`, `RELAY_ROLES`, and `CRUCIBLE_ROLES`, so drift fails a test. CLI values come directly from `SYSTEM_CLI_TYPES` plus the parser's `ptah-cli` value.
- The controller's ordinary answer callback already serves the voice loop; changing the voice loop would duplicate the guard.

## Anything not done

- The final small `ordinaryChoices` adjustment, which limits filtering to questions containing a Confirm-like option, was made after the last Jest run. ESLint and Prettier passed afterward. No additional Jest run was made under the four-run cap (the initial Bash quoting failure may have started one run).
