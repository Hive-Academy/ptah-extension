# Batch report C4 — Scheduled catalog probe

## File added

- `.github/workflows/connectors-probe.yml` — a scheduled/manual GitHub Actions workflow that runs the live connector catalog probe and manages one stable failure issue.

## Schedule

The workflow uses `17 3 * * 1`: every Monday at 03:17 UTC. This is weekly as required, avoids a high-contention exact-hour start, and starts 77 minutes after `nightly-coverage.yml` begins its daily run at 02:00 UTC. It can also be started explicitly with `workflow_dispatch`. There is no pull-request trigger, because the probe makes real third-party network calls.

## Conventions copied from `nightly-coverage.yml`

- `ubuntu-latest` runner.
- Workflow-level `NODE_VERSION: 24` and `NX_TUI: false` environment values.
- `actions/checkout@v4` with `filter: tree:0` and `fetch-depth: 0`.
- `actions/setup-node@v4` using `${{ env.NODE_VERSION }}`.
- The same `actions/cache@v4` `node_modules` cache path, cache key, and `cache-modules` step id.
- The same cache-miss-only dependency installation, including `npm ci || npm install --no-audit --no-fund` and the Linux Rollup binary workaround.
- Read-only `actions` and `contents` permissions, extended only with `issues: write` for failure issue management.

The C4 wording mentions following a concurrency group from `nightly-coverage.yml`, but that source workflow has no `concurrency:` block. In accordance with the adjacent instruction not to copy a convention the source does not use, `connectors-probe.yml` deliberately does not invent one.

## Probe and failure handling

The workflow sets `PTAH_LIVE_PROBES=1` and runs:

```text
npx nx test @ptah-extension/cli-agent-runtime --testPathPatterns ptah-connectors-catalog.live
```

The plural Jest 30 flag is used. The command is piped through `tee` with `pipefail`, so its complete output is retained for the issue body while a failed probe still fails the step and the workflow.

On probe failure, a Bash step uses the runner-provided `gh` CLI with `GH_TOKEN: ${{ github.token }}`. It lists open issues, filters by exact equality with the stable title `[connectors-probe] Live connector catalog probe failed`, sorts matches by issue number, updates the oldest exact match or creates one when absent, and closes every additional exact-title open match. The body contains the full captured probe output. No issue is created on a successful probe.

## Parse check

Command:

```powershell
npx --no-install js-yaml 'D:\projects\ptah-extension\.github\workflows\connectors-probe.yml'
```

Exit code: `0`

Full output:

````json
{
  "name": "Connectors Catalog Probe",
  "on": {
    "schedule": [
      {
        "cron": "17 3 * * 1"
      }
    ],
    "workflow_dispatch": null
  },
  "permissions": {
    "actions": "read",
    "contents": "read",
    "issues": "write"
  },
  "env": {
    "NODE_VERSION": 24,
    "NX_TUI": false,
    "PTAH_LIVE_PROBES": 1
  },
  "jobs": {
    "probe-connectors-catalog": {
      "runs-on": "ubuntu-latest",
      "timeout-minutes": 25,
      "steps": [
        {
          "uses": "actions/checkout@v4",
          "with": {
            "filter": "tree:0",
            "fetch-depth": 0
          }
        },
        {
          "uses": "actions/setup-node@v4",
          "with": {
            "node-version": "${{ env.NODE_VERSION }}"
          }
        },
        {
          "name": "Cache node_modules",
          "id": "cache-modules",
          "uses": "actions/cache@v4",
          "with": {
            "path": "node_modules",
            "key": "node-modules-${{ runner.os }}-${{ hashFiles('package-lock.json') }}"
          }
        },
        {
          "name": "Install dependencies",
          "if": "steps.cache-modules.outputs.cache-hit != 'true'",
          "run": "npm ci || npm install --no-audit --no-fund\nnpm install @rollup/rollup-linux-x64-gnu --no-save --force\n"
        },
        {
          "name": "Run live connector catalog probe",
          "id": "probe",
          "run": "set -o pipefail\nnpx nx test @ptah-extension/cli-agent-runtime --testPathPatterns ptah-connectors-catalog.live 2>&1 | tee \"${RUNNER_TEMP}/connectors-probe-output.txt\"\n"
        },
        {
          "name": "Open or update the probe failure issue",
          "if": "failure() && steps.probe.outcome == 'failure'",
          "env": {
            "GH_TOKEN": "${{ github.token }}",
            "ISSUE_TITLE": "[connectors-probe] Live connector catalog probe failed"
          },
          "run": "output_file=\"${RUNNER_TEMP}/connectors-probe-output.txt\"\nbody_file=\"${RUNNER_TEMP}/connectors-probe-issue-body.md\"\n\n{\n  echo 'The scheduled live connector catalog probe failed.'\n  echo\n  printf -- '- Run: %s/%s/actions/runs/%s\\n' \\\n    \"${GITHUB_SERVER_URL}\" \"${GITHUB_REPOSITORY}\" \"${GITHUB_RUN_ID}\"\n  printf -- '- Commit: `%s`\\n' \"${GITHUB_SHA}\"\n  echo\n  echo '## Probe output'\n  echo\n  echo '```text'\n  if [[ -f \"${output_file}\" ]]; then\n    cat \"${output_file}\"\n  else\n    echo 'The probe output file was not created.'\n  fi\n  echo '```'\n} > \"${body_file}\"\n\nmapfile -t matching_issues < <(\n  gh issue list --state open --limit 1000 --json number,title \\\n    --template '{{range .}}{{printf \"%d\\t%s\\n\" .number .title}}{{end}}' |\n    while IFS=$'\\t' read -r issue_number candidate_title; do\n      if [[ \"${candidate_title}\" == \"${ISSUE_TITLE}\" ]]; then\n        printf '%s\\n' \"${issue_number}\"\n      fi\n    done |\n    sort -n\n)\n\nif (( ${#matching_issues[@]} == 0 )); then\n  issue_url=\"$(\n    gh issue create --title \"${ISSUE_TITLE}\" --body-file \"${body_file}\"\n  )\"\n  keeper_number=\"${issue_url##*/}\"\nelse\n  keeper_number=\"${matching_issues[0]}\"\n  gh issue edit \"${keeper_number}\" \\\n    --title \"${ISSUE_TITLE}\" \\\n    --body-file \"${body_file}\"\nfi\n\nfor duplicate_number in \"${matching_issues[@]:1}\"; do\n  gh issue close \"${duplicate_number}\" --reason 'not planned'\ndone\n\necho \"Probe failure recorded in issue #${keeper_number}.\"\n"
        }
      ]
    }
  }
}
````

The workflow itself was not triggered.
