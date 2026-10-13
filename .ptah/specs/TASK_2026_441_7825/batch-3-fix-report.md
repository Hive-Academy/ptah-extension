# Batch 3 git standards fix report

Updated `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/orchestration/references/git-standards.md` in place. Its existing Repository commit rules, Quiet commit window, Hook Failure Protocol, Destructive operations, and Related references sections remain, including the `#quiet-commit-window` and `#hook-failure-protocol` anchors.

## Restored sections

| Earlier heading | Current heading |
| --- | --- |
| Commit Message Format; Allowed Types; Valid Examples; Invalid Examples | Repository commit rules → Default commit types and examples |
| Branch Operations | Branch operations |
| Pre-commit Checks | Pre-commit checks |
| Hook Failure Protocol → Option Actions | Hook Failure Protocol → Option actions |
| Hook Failure Protocol → Agent Behavior Rules | Hook Failure Protocol → Agent behavior rules |
| Hook Failure Protocol → Documentation When Bypassing | Hook Failure Protocol → Documentation when bypassing |
| Example Scenarios | Hook Failure Protocol → Example scenarios |

## Deliberately not restored

- The earlier repository scope list and commitlint limits: each repository's own configuration takes precedence, and unconfigured limits must not be presented as enforced rules.
- Project names, stack-specific commands, hook tool names and check order: they would incorrectly promise behavior in other repositories. The reference now directs the orchestrator to discover actual hooks and run scoped checks.
- Vendor-specific agent information: it does not belong in a generic git reference.

## Verification

Ran once: `npm run validate-skill 2>&1 | Select-Object -Last 30`.

```text
Found 9 markdown files to validate
Files checked: 9
Errors: 0
Warnings: 0
VALIDATION PASSED
```

The validation passed, including the reference links. A search of the edited file for the five prohibited strings returned no matches (`rg` exit code 1).
