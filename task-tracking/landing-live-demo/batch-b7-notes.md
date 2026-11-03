# B7 landing live demo notes

## Files changed

- `libs/web/landing/src/lib/live-demo/live-demo-catalog.ts`: four PtahCode replay entries and media paths.
- `libs/web/landing/src/lib/sections/live-demo/live-demo-section.component.ts`: responsive, SSR-safe replay section, tab keyboard controls, iframe control and state protocol.
- `libs/web/landing/src/lib/sections/live-demo/live-demo-section.component.spec.ts`: SSR, keyboard, iframe URL, and message filtering tests.
- `libs/web/landing/src/lib/landing-page.component.ts`: added the section directly after the hero.
- `task-tracking/landing-live-demo/batch-b7-notes.md`: this report.

## Decisions

- Use the four-tab order and real `orchestration` on-send behavior from the B7 assignment. The older plan listed three synthetic tabs; the assignment explicitly supersedes that catalog. This is reversible in the catalog.
- Keep the iframe loaded across tab changes so changing the bound, validated scenario URL reloads it. This preserves the click-to-load choice on tablet. This is reversible in the section.
- Render the poster on the server; switch to native video below 768 px after the browser has rendered. This follows the SSR and mobile requirements. This is reversible in the section.

## Verify result

`npm run verify -- -p web-landing`: **exit 1** after a 454-second lock wait. Lint and tests succeeded; typecheck failed on ten errors in generated scenario files owned by other batches (`"session:stats"` and `"turnCost"` do not match `replay-scenario.types.ts`). The typecheck log contains no error in a B7-owned file.

After the small mobile-video pause fix, a second run of the same command waited more than ten minutes for the machine-wide lock, so I stopped the wait as instructed (exit 130). Its exact output tail was:

```text
[verify 2026-10-31T21:37:59.455Z] waiting for a slot: 2/2 held by pid 559321 [verify lint,test,typecheck (@ptah-extension/rpc-handlers,ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui,@ptah-extension/cli-engine,ptah-extension-webview)] in /home/amun/ptah-extension/.claude-worktrees/session-prefix-diet-d since 2026-10-31T21:27:06.300Z; pid 568456 [onboarding-a5-captures] in /home/amun/ptah-extension/.claude-worktrees/onboarding-module since 2026-10-31T21:36:59.208Z (queue position 2)
[verify 2026-10-31T21:38:05.424Z] SIGINT while waiting. Leaving the queue.
```

Scoped Ptah diagnostics after that fix reported no error in the component. The full test/lint/typecheck suite did not run on the final edit.

Exact output tail:

```text
 NX   3 tasks: 2 succeeded, 1 failed


✖ nx run web-landing:typecheck
  full log: /home/amun/.nx/8b7110c7390b9603/cache/terminalOutputs/11564463024820205884

Re-run with --output-style=static to inline logs.

  Run duration:      55.8s
  Cache:             0/2 hit (0%)
  Critical path:     22.5s (1 task)
  Recoverable time:  33.3s (60% of the run)

  Recommendations:
    - Increase parallelism to recover up to 33.3s → https://nx.dev/docs/concepts/ci-concepts/parallelization-distribution?utm_source=nx-cli&utm_medium=cli&utm_campaign=performance-report&utm_content=parallelization.
    - Drastically reduce your run duration by sharing a cache across your team and CI → https://cloud.nx.app/connect/2pQMe4Z4T8.
[verify 2026-10-31T21:27:03.898Z] lock released after 65.9s, exit code 1
```

## Known limits

- B8 owns the poster and WebM media files. This batch only references their required paths.
- `web-landing:typecheck` is blocked by the ten generated scenario type errors listed above. Those files are outside B7 ownership.
- The final `npm run verify -- -p web-landing` retry did not acquire the lock within ten minutes. Central verification is still needed for the final edit.
- A rendered screenshot was not taken because this lane was instructed not to run build, serve, or dev targets.
