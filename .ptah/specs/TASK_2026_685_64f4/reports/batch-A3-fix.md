# Batch A3 test fixes

- `libs/frontend/chat/src/lib/components/molecules/execution-header/execution-header.component.spec.ts:29`: Assert that the projected action follows the disclosure row host and stays outside its button. The test still checks label, metadata, warning tone, `aria-controls`, and the collapsed/open region.
- `libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card-flat-header.spec.ts:46`: Assert that Resume sits in the row host's sibling action container and outside the disclosure button, independent of the wrapper's serialized markup.
- `libs/frontend/chat/src/lib/components/molecules/agent-card/cli-agent-output.component.spec.ts:83`: Assert the usage region starts closed, open the disclosure button, then check Lane usage and the existing CLI session and task facts inside the controlled region. Existing assertions for the flat card and absent stats content remain.
- `libs/frontend/chat/src/lib/components/organisms/agent-monitor-panel.component.spec.ts:533`: Add the `agents` signal to this suite's `AgentMonitorStore` mock. Selecting a CLI agent renders the existing `AgentContinueInputComponent`, which injects `AgentFollowUpQueueService`; its root effect calls `store.agents()`. The incomplete mock caused failure 4. Neither A3 component introduces this service dependency.

## Decisions

- Kept the production component unchanged because the four failures stem from assertions against old markup or an incomplete test provider. The sibling assertions use element relationships so unrelated wrapper classes do not affect them. Reversible: yes.
- Used `activeTabAgentsSig` for the mock's `agents` signal because this suite only renders the selected tab's agents. Reversible: yes.

No tests, typecheck, lint, or build were run, per the handoff. Scoped `ptah_get_diagnostics` timed out before returning results, so verification remains with the orchestrator.
