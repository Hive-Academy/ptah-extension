# Codex 5-hour window report

## Outcome

The live Codex App Server response contains no 300-minute window. The missing
5-hour window therefore cannot be added truthfully. The normal production reader
continues to report the live Weekly window at 27%.

## Redacted live shape

Command:

```powershell
npx ts-node --transpile-only --project scripts/agent-usage/tsconfig.json -r tsconfig-paths/register scripts/agent-usage/probe-plan-usage.ts --codex-shape
```

Result (only bucket identifiers, names, durations, percentages, and reset
instants; no credentials, email, account ID, or raw response):

```json
{
  "rateLimitsByLimitIdKeys": ["codex"],
  "buckets": [
    {
      "bucket": "default",
      "limitId": "codex",
      "limitName": null,
      "primary": { "windowDurationMins": 10080, "usedPercent": 27, "resetsAt": 1791948716 },
      "secondary": null
    },
    {
      "bucket": "codex",
      "limitId": "codex",
      "limitName": null,
      "primary": { "windowDurationMins": 10080, "usedPercent": 27, "resetsAt": 1791948716 },
      "secondary": null
    }
  ]
}
```

## Root cause and fix

`rateLimitsByLimitId` is parsed by the Codex schema but is not projected by
the account-usage service. That omission is real, but it is not the cause of a
missing 5-hour window for the live account: its only by-ID bucket duplicates
the default 10,080-minute Weekly window. Neither bucket has a secondary window
or any 300-minute window.

The harness now has `--codex-shape`, which directly requests
`account/rateLimits/read` and prints the safe structural projection above. No
production quota-mapping change was made, because adding or labelling a window
not returned by the provider would invent usage data. The existing shared
duration mapping already labels a provider-declared 300-minute duration as
`5-hour`.

## Files changed

- `D:\projects\ptah-extension\scripts\agent-usage\probe-plan-usage.ts`
- `D:\projects\ptah-extension\.ptah\specs\TASK_2026_UI_DEFECTS\codex-5h-window-report.md`

## Harness result after

```json
{
  "provider": "Codex",
  "state": "available",
  "reason": "app-server",
  "windows": [{ "label": "Weekly", "percent": 27, "resetAt": "2026-10-14T03:31:56.000Z" }]
}
```

The remaining normal-harness providers were redacted operational statuses:
Antigravity `service-unavailable`, Ollama Cloud `unsupported-config`, Claude
`service-unavailable`, and OpenCode `no-usage-source`.

## Checks

- Passed: normal harness command above; Codex was `available` with one Weekly
  window at 27%.
- Passed: `npx nx typecheck @ptah-extension/auth-providers --parallel=1`;
  TypeScript completed successfully. Nx Cloud separately reported its disabled
  organization as a non-blocking telemetry warning.
- Not applicable: no Jest spec changed, so no focused Jest command was run.
- Diagnostics: scoped diagnostics for the harness reported pre-existing
  TypeScript errors in the transpile-only script's mock logger and unrelated
  sibling projects. The new `--codex-shape` mode itself ran successfully.

## Decisions

- Do not manufacture a 5-hour window when no live bucket declares 300 minutes.
- Preserve the current service and UI mapping because both live buckets are the
  same Weekly quota; merging them would not expose new data.
- Retain the redacted shape mode so a future provider response with a 300-minute
  bucket can be evidenced before changing the production projection.
