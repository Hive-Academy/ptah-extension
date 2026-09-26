# Task Context - TASK_2026_570_fd05

## Background

memory.store.ts passed the 1,000-line soft ceiling and memory-curator.service.ts is 861 lines (lint max-lines 700; it was 805 on base). Split under the facade rule: public class, DI token and signatures stay; extracted concerns become injected or constructed collaborators with real names (for example quarantine read/restore, write-counter generation, lifecycle-freeze writes).

## Evidence

Source: follow-up from TASK_2026_563_2939 (PR #601). Evidence: ../TASK_2026_563_2939/reviews/batch-3-code-style-review.md, reviews/batch-5-code-style-review.md.
