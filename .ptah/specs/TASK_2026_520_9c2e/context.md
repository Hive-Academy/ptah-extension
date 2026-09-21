# Context

## The defect

A scan of `.ptah/specs/` on `origin/main` at `702c41413` on 2026-09-21:

```
grep -rniEl "D:[/\\]projects|C:[/\\]Users|abdal" .ptah/specs/ | wc -l
  → 325
```

325 committed files contain an absolute workstation path, the developer account name, or both.
Typical forms observed:

- `D:\projects\ptah-extension\...` and `D:/projects/ptah-extension/...`
- `C:\Users\<account>\AppData\Local\Temp\...`
- `file:///D:/projects/ptah-extension/.claude-worktrees/<branch>/...` inside markdown links,
  which a worktree-scoped agent produces naturally because that is the path it was handed.

## Why this is not cosmetic

CodeRabbit raised it on pull request 546 (comment 10) and classified it as CWE-200, information
disclosure. The repository is public. An absolute path discloses the account name, the drive
layout and the directory structure of the maintainer's machine.

That review fixed only the eight task folders belonging to pull request 546. The other 325 files
were never in scope, and nothing prevents the next one.

## Why it recurs

Every agent lane is given an absolute working directory, so absolute paths are what it has to
hand when it writes evidence. Three of the four lanes run on 2026-09-21 reintroduced the pattern
in fresh deliverables — one of them 28 times in a single file — and each was cleaned by hand
after the fact. Hand cleaning does not scale and is not reliable.

## Acceptance criteria

1. An automated guard rejects a commit that adds an absolute workstation path or the account
   name under `.ptah/specs/`. A pre-commit hook via `.lintstagedrc.mjs`, or a lint rule, or a CI
   check — choose one and state why. A CI-only check still lets the path reach a public branch,
   so prefer the hook, with CI as the backstop.
2. The guard matches the forms listed above, including the `file:///` markdown-link form, and is
   case-insensitive. Windows drive letters vary in case.
3. The guard must not fire on a legitimate reference. `file:///C:/Windows/win.ini` appears in an
   attack fixture in `TASK_2026_497_debb` and is a test input, not a leak. Decide how to express
   an exemption, and document it.
4. The 325 existing files are cleaned. Replace an absolute path with a repository-relative path
   where one exists, and with a placeholder where it does not. Do not delete the surrounding
   evidence.
5. After the change, the scan command above returns zero, excluding any documented exemption.

## Note on scope

This is a large mechanical edit across historical task folders. Do not rewrite their prose, do
not correct their findings, and do not change any `task.md` frontmatter. Replace the path and
nothing else. A task folder is a record of what was found at the time.

## Source

Pull request 546, CodeRabbit comment 10. Re-measured 2026-09-21.
