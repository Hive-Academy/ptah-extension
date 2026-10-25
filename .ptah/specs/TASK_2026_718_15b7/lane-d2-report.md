# Lane D2 — zoneless test timing

## Files changed
- `libs/frontend/chat/src/lib/components/molecules/agent-card/cli-agent-output.component.spec.ts`: await a macrotask after Angular stability before reading async markdown; preserved the pre-existing models/pricing RPC mock.
- `libs/frontend/chat/src/lib/components/molecules/agent-card/stdout-visibility.spec.ts`: settle async markdown during initial rendering and subsequent disclosure transitions.
- `libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card-unified.spec.ts`: settle markdown before retained-output assertions, preserving the existing explicit animation-frame control.
- `libs/frontend/chat/src/lib/components/organisms/subagent-lane/subagent-lane.component.spec.ts`: wait for summary markdown parsing and detect changes before asserting the completed summary.
- `libs/frontend/chat/src/lib/components/molecules/confirmation-dialog.component.spec.ts`: check pre-render focus synchronously after Cancel, before awaiting the answer promise.

All 59 test cases and all existing assertions remain. No production, setup, shared helper, console stub, or git changes were made by this lane.

## Confirmed root causes
- cli-agent-output.component.spec.ts: three failures read empty/stale ngx-markdown content before its parse promise completed. Four explicit macrotask waits cover initial/replacement DOM reads.
- stdout-visibility.spec.ts: initial raw stdout and completed error markdown were read before parsing finished. The local render helper now waits for it.
- agent-card-unified.spec.ts: both text/error parameterized cases read raw stdout before parsing completed. Existing frame callbacks remain controlled so scroll-retention assertions retain their meaning.
- subagent-lane.component.spec.ts: finished-record summary uses async markdown; zoneless fixture stability does not track its parsing promise.
- confirmation-dialog.component.spec.ts: the awaited answer allowed automatic zoneless rendering and afterNextRender focus restoration before the pre-render assertion. Moving that unchanged assertion before the await restores the intended ordering.

Evidence: ngx-markdown render awaits parse before writing directly to nativeElement.innerHTML (node_modules/ngx-markdown/fesm2022/ngx-markdown.mjs:550–551). ExecutionNodeComponent publishes rendered content through signals (libs/frontend/chat/src/lib/components/organisms/execution/execution-node.component.ts:577, 617–635); AgentCardOutputComponent updates renderedTail via a signal (libs/frontend/chat-ui/src/lib/molecules/agent-card/agent-card-output.component.ts:424–426). ConfirmationDialogComponent restores focus in afterNextRender (libs/frontend/chat/src/lib/components/molecules/confirmation-dialog.component.ts:189–197).

## Verification
Executed from `D:/projects/ptah-extension/.claude-worktrees/chat-test-hygiene/`:

```powershell
npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/components/molecules/agent-card/cli-agent-output.component.spec.ts libs/frontend/chat/src/lib/components/molecules/agent-card/stdout-visibility.spec.ts libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card-unified.spec.ts libs/frontend/chat/src/lib/components/organisms/subagent-lane/subagent-lane.component.spec.ts libs/frontend/chat/src/lib/components/molecules/confirmation-dialog.component.spec.ts --coverage=false --maxWorkers=2 > $env:TEMP/d2.log 2>&1
Select-String -Path $env:TEMP/d2.log -Pattern 'Tests:|Test Suites:|^FAIL|●' | Select-Object -First 40
```

Baseline: 5 failed suites; 9 failed, 50 passed tests. Narrow failure excerpts were read from the saved log.
After edits:
```
Test Suites: 5 passed, 5 total
Tests:       59 passed, 59 total
```
The final filtered log contained no FAIL or console sections. No whole-library or workspace-wide tests were run.

Scoped ptah_get_diagnostics was called for the five changed specs. It returned unavailable: TypeScript check still running after 45 seconds; all five files unchecked. It explicitly reported the compiler was not cancelled. This is not a diagnostics pass; no repeat compiler check was started.

## Findings
No production zoneless update defect was identified. The inspected async paths either publish signals or write parsed HTML directly, and dialog focus restoration occurs after rendering as intended.

## Decisions
- Use explicit zero-delay macrotask waits in the specs. Options: generic shared helper, inline waits, fake timers. Evidence: ptah_code_search_symbols returned zero hits; text search found local non-exported settle helpers and the exported router-specific settleSurfaceNavigation in libs/frontend/core/src/testing/surface-router-testing.ts:113. That helper calls TestBed.tick and is intended for router navigation; it is not a generic markdown-settling helper. Reused the existing local render helper in stdout-visibility; kept other waits inline rather than importing another spec or introducing router behavior. Reversible.
- Move the dialog pre-render assertion before the await. Options: reorder the unchanged assertion or disable automatic rendering with fake timers. Evidence: baseline failed because focus was already restored; afterNextRender is the production contract. Reordering preserves the intended boundary with less test machinery. Reversible.
- Keep production and all existing assertions untouched; scope and current source resolve the implementation without a UI decision.

## Anything not done
No production changes were necessary. Scoped TypeScript diagnostics did not finish within the tool's response window. No other checks were requested or run.


## Follow-up — console hygiene

### Files changed
- `libs/frontend/chat/src/lib/components/molecules/agent-card/cli-agent-output.component.spec.ts`: inject a typed local LoggingService double so rendering does not construct the real environment-configuring logger; existing RPC mock retained.
- `libs/frontend/chat/src/lib/components/molecules/agent-card/stdout-visibility.spec.ts`: inject the same minimal logger method surface through TestBed.
- `libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card-unified.spec.ts`: inject the same minimal logger method surface through TestBed.
- `libs/frontend/chat/src/lib/components/organisms/subagent-lane/subagent-lane.component.spec.ts`: seed synthetic pricing for the existing claude-sonnet fixture in the stats-presentation test; restore the previous pricing map in finally.
- `confirmation-dialog.component.spec.ts`: no additional follow-up changes.

### Confirmed root causes
The three agent-card suites instantiate LoggingService indirectly through their rendered dependency graph. Its constructor emits environment guidance (logging.service.ts:115–122), which is unrelated to their rendering contracts. TestBed now provides fresh jest.fn methods typed against LoggingService rather than intercepting console.

The subagent stats test is not an unknown-pricing/error-path test: it asserts shared header, tokens, model label and details. Its synthetic model id was absent from the runtime pricing map, triggering pricing.utils.ts:236. Supplying test pricing fixes that fixture while preserving every existing assertion and model label. Cleanup resets the map and restores its captured entries even if an assertion fails. No console spy or global console mutation was introduced.

### Follow-up verification
Ran the same five-spec Jest command above exactly once after these changes, with --coverage=false --maxWorkers=2 and output saved to $env:TEMP/d2.log.

```
Test Suites: 5 passed, 5 total
Tests:       59 passed, 59 total
```

Filtered the saved log for `Tests:|Test Suites:|^FAIL|●|console\.|LoggingService|not found in pricing`. Only the two passing summary lines matched: no console sections, logger constructor messages, or missing-pricing warning remained.

Scoped ptah_get_diagnostics completed for the four files changed in this follow-up: no diagnostics in the requested files. It also reported 255 errors in sibling files outside this lane's ownership, including agent-card-truncation.spec.ts:137 (AgentOutputDelta cast missing fields) and chat-transcript.ptah-ui.spec.ts:7 (ComponentFixture imported from @angular/core). These were not changed; the project-wide diagnostics result is not clean.

## Decisions — follow-up
- Local typed LoggingService DI doubles instead of console spies. A single search of libs/frontend/core/src/testing found no logger helper. The shared createMockLogger helper targets backend two-argument logger signatures; local Pick<LoggingService, 'debug' | 'info' | 'warn' | 'error'> doubles preserve the frontend signature. This follows existing frontend DI-double patterns and is reversible.
- Seed the existing synthetic model's pricing only for its presentation test and restore it in finally, rather than asserting/silencing an incidental warning or changing the existing model assertion. Evidence: the test exercises stats presentation and has no missing-pricing expectation. Reversible.

## Findings — follow-up
No production defect identified. Sibling TypeScript diagnostics are outside the permitted scope and remain for the coordinating workflow. All requested follow-up edits and the single targeted Jest run are complete.
