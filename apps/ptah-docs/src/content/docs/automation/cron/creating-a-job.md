---
title: Creating a Cron Job
description: Step through the fields and validation rules.
---

# Creating a Cron Job

Open **Settings → Cron** and click **New job**.

## Fields

| Field           | What it is                                                           |
| --------------- | -------------------------------------------------------------------- |
| Name            | Human-readable label shown in the panel and run history              |
| Cron expression | 5- or 6-field croner-compatible expression. Second field is optional |
| Timezone        | IANA zone (e.g. `America/New_York`, `Europe/London`, `UTC`)          |
| Prompt          | The task sent to the agent each time the job fires                   |
| Workspace root  | Absolute path to the workspace the agent runs in. Required           |

## Validation

Cron expressions and timezones are validated by croner at save time. If either is invalid, **croner's diagnostic message is surfaced verbatim** in the form — no re-wrapping, so you can search the croner docs directly.

The workspace root is validated at the RPC boundary:

- Must be an absolute path
- No `..` segments allowed (no escape)
- Must point to an existing directory readable by Ptah

:::caution
Don't put secrets in the prompt. Job rows live in `~/.ptah/ptah.db` and are also visible in run history. Reference secrets through your environment or settings, not the prompt body.
:::

## RPC surface

For automation or A2A scenarios:

| Method          | Purpose                                        |
| --------------- | ---------------------------------------------- |
| `cron:create`   | Create a job                                   |
| `cron:update`   | Update an existing job                         |
| `cron:delete`   | Delete a job (cascade-deletes its run history) |
| `cron:toggle`   | Enable / disable a job without deleting it     |
| `cron:runNow`   | Fire the job immediately, off-schedule         |
| `cron:list`     | List all jobs                                  |
| `cron:get`      | Fetch a single job                             |
| `cron:runs`     | List past runs for a job                       |
| `cron:nextFire` | Compute the next scheduled fire time           |

## Tips

- Start with the cron expression `0 * * * *` (top of every hour) and **Run now** the first time to confirm the job behaves as you expect.
- Toggle a job off rather than deleting it if you're just pausing — run history stays intact.
- Use small, idempotent prompts. A 200-line prompt that runs every 5 minutes is a recipe for noise.
