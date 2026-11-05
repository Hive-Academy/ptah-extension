# Evidence — three unstable CI tests

Worktree: `/home/amun/ptah-extension/.claude-worktrees/flaky-ci-tests` (branch `fix/flaky-ci-tests`, from `main` 18f2143e2).

## 1. `libs/backend/platform-core/src/agent-pack-download.service.spec.ts`

CI: run 41776731007 (workflow CI, branch `feat/provider-readiness`, PR #916), attempt 1 failed, attempt 2 passed.

```
● AgentPackDownloadService › no-clobber against writers outside the queue (A2)
  › a replace of a file deleted since the plan does not clobber a concurrent create
  thrown: "Exceeded timeout of 5000 ms for a test."
  at src/agent-pack-download.service.spec.ts:853:5
```

Code (spec lines 797-814, 853-883): `holdReads(dest, 2)` pushes each held read's resume
callback into `release[]` in **arrival order**. The test then calls `gate.release[0]()` and
`await creator`, which assumes `release[0]` belongs to instance `a` (the creator). Instances
`a` and `b` have independent queues and run their async steps (lock, stat, read) concurrently,
so instance `b`'s read can arrive first. Then `release[0]` resumes the replacer, `release[1]`
(the creator's read) is never resumed, `await creator` never settles and Jest hits its 5 s
test timeout. The same index-equals-call-order assumption is in the test at line 816
(`release[0]` → `await first`).

Hypothesis status: confirmed by code reading of the spec; the lane confirms against the
service's read order before it changes anything.

## 2. `libs/backend/tool-output-reducers/src/lib/reducers/markdown.reducer.spec.ts`

CI: run 41782441700 (workflow CI, PR #916), attempt 1 failed, attempt 2 passed.

```
● reduceMarkdown — cost on crafted input › lexes a 256 KiB list-heavy document within the cap bound
  expect(received).toBeLessThan(expected)
  Expected: < 1797.2677359999943
  Received:   2092.426354000001
  at expectLinearTime (markdown.reducer.spec.ts:873:21)
  at markdown.reducer.spec.ts:941:5
```

Code (spec lines 841-942): the reduction took 2,092 ms, over `MAX_CAP_MS` (1,500 ms), so the
fallback compared it with `LOAD_FACTOR (4) × fastestMs(cap reference)` = 1,797 ms. The two
measurements are taken at different moments; on a shared CI runner the load changes between
them, so the ratio (here 4.66x, idle 2.0x) is not stable. Both bounds depend on wall-clock
time of the machine. The suite took 28 s on that runner.

## 3. Webview E2E — `marketplace/marketplace-servers.e2e.spec.ts:322`

Failed runs (`gh run list --workflow "Webview E2E" --status failure --limit 40`), same test,
same error, on unrelated branches: 41792889338, 41754346859, 41698150296, 41696061563,
41692571594, 41586018715, 41542504218, 41507917147, 41344770481. In PR #916's own failed run
41771960137 the marketplace tests were only skipped; that run failed in
`onboarding-ready-visual` (PR code, out of scope).

```
Error: expect(locator).toBeVisible() failed
Locator: locator('[data-testid="server-detail-not-found"]')
Error: strict mode violation: locator('[data-testid="server-detail-not-found"]') resolved to 2 elements:
  1) … aka getByTestId('docked-inspector-body').getByTestId('server-detail-not-found')
  2) … aka getByTestId('native-drawer-body').getByTestId('server-detail-not-found')
> 394 | await expect(page.locator('[data-testid="server-detail-not-found"]')).toBeVisible({
```

Code: after the workspace switch the marketplace shell remounts. `MarketplaceLayout`
(`libs/frontend/marketplace/src/lib/layout/marketplace-layout.ts:60-109`) starts at width 0
(tier `compact`) until its `ResizeObserver` reports, so `provider-list-view.component.html:129-157`
first renders the `<ptah-native-drawer>` branch, then the `wide` tier swaps to
`<ptah-docked-inspector>`. The drawer has `animate.leave="ptah-motion-leave"`, so for the
leave animation both bodies hold a `server-detail-not-found` node. A strict-mode violation
fails the assertion at once (it is not retried), so a poll that lands in that window fails.
Slow runners make the window wider. The un-scoped locator, not the product, is what the test
gets wrong: the test already asserts the wide/docked branch (line 368).

Product note (not changed here): the remount shows a short drawer flash before the docked
inspector at the wide tier. Reported to the user as a possible follow-up.
