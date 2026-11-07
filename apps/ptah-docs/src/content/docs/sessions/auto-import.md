---
title: Session Auto-Import
description: Import recent Claude sessions into PtahCode.
---

# Session Auto-Import

PtahCode imports your recent Claude sessions so that you can see and resume them in the app.

## Where PtahCode looks

PtahCode reads the session files that Claude writes to `~/.claude/projects/`. On Windows, this is `C:\Users\<you>\.claude\projects\`.

## When import runs

When you open a workspace, PtahCode scans the Claude sessions of that workspace. It imports the metadata of up to 50 of the most recent sessions.

PtahCode does not change or delete the original Claude session files.

## Troubleshooting

| Symptom                  | Fix                                                                  |
| ------------------------ | -------------------------------------------------------------------- |
| No sessions are imported | Make sure that `~/.claude/projects/` contains sessions for this workspace. |
| An old session is absent | PtahCode imports only the most recent sessions.                      |
