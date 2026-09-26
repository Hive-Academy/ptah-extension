# Task Context - TASK_2026_567_90d4

## Background

The new EXTRACT_SYSTEM_PROMPT returned {"memories": []} for all 3 windows of session 1359b2b0, although the content (a mojibake root cause, a reusable repair-script pattern, a verification workflow) is durable by the task rubric. On the 10-session sample: single-use count 145 -> 126 (pass) but share 98.0% -> 99.2% (fail); durable drafts 100 -> 105; 33 durable losses, 5 real. Tune the DO NOT EXTRACT section so real lessons inside task-heavy sessions survive, then re-measure on a larger sample with search-based subject reuse enabled against a DB copy.

## Evidence

Source: follow-up from TASK_2026_563_2939 (PR #601). Evidence: ../TASK_2026_563_2939/test-report.md M4-8, harness/output/m4-extraction.md (raw outputs are local only).
