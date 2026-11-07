---
title: Creating a Cron Job
description: The fields of a cron job and the validation rules.
---

# Creating a Cron Job

1. Open **Thoth → Schedules**.
2. Click **New job**.
3. Fill in the fields.
4. Click **Create job**.

## Fields

| Field                     | What it is                                                                 |
| ------------------------- | -------------------------------------------------------------------------- |
| Name                      | The label in the job list and in the run history                           |
| Cron expression           | A 5-field or 6-field croner expression. The form shows a preview or error  |
| Prompt / handler          | The prompt that the headless session runs each time the job fires          |
| Workspace root (optional) | The absolute path of the workspace that the session runs in                |
| Timezone                  | An IANA zone, for example `America/New_York` or `UTC`. Default is detected |
| Enabled                   | When cleared, the job is saved but does not fire                           |

## Validation

- Croner validates the expression and the timezone when you save. The form shows the croner error message without changes.
- A workspace root must be an absolute path and must not contain `..` segments.
- A prompt that starts with `handler:` is rejected. That prefix is reserved for internal jobs.

:::caution
Do not put secrets in the prompt. The prompt is stored in `~/.ptah/state/ptah.sqlite`.
:::

## Manage a job

Each job card has actions to run the job now, edit it, enable or disable it, and delete it. Open a job to see its details and run history.

- To pause a job, disable it. A disabled job keeps its run history.
- To test a new job, click **Run now** before you rely on the schedule.
- When you delete a job, its run history is deleted too.
