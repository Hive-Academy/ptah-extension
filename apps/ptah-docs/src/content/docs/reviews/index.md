---
title: Reviews
description: See the pull request review runs, open the details of a run, and set the repositories, the bot token, and the publication pause.
---

# Reviews

The **Reviews** tab shows the **Review runs** page: the repository review attempts and their coverage. Each run is one review of a GitHub pull request (PR). From this page you can open the details of a run, start a rerun, and change the review settings.

## Open the page

- Click the **Reviews** tab in the tab bar.
- Or click **Thoth** in the chat header, open the **Schedules** tab, and click **Review runs**.

## The page layout

| Area             | What it shows                                                                                   |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| Header           | **Review runs**, the time of the last refresh, **Pause all publication**, **Review settings**, and **Refresh** |
| **Repositories** | The repositories in the review settings, with a state badge for each one                         |
| **Runs**         | The number of queued runs, the repository and state filters, and the list of runs               |

Click a repository in the **Repositories** list to show only its runs. The state badge of a repository is **Disabled**, **Paused**, **Dry-run**, or **Live**.

## The runs list

Each row in the **Runs** list shows:

- The PR number and the repository (`owner/name`).
- The first characters of the head commit and the trigger of the run.
- A state badge, for example **Completed**, **Partial / coverage limited**, **Skipped**, or `failed`.
- **Waiting**, **In progress**, or **Finished**.

A failed run also shows the stage that failed and the error message. When automatic retries stopped, the row shows **Automatic retries stopped**. Otherwise it can show **Retry after** and a time.

Use the two filters above the list to show one repository or one state. When no run matches, click **Clear filters**. Use the Up and Down arrow keys to move between rows.

### Refresh the list

Click **Refresh** to get the latest runs. When no runs exist, the page shows **No review runs yet**, because runs appear after the next poll.

The page can show these messages:

| Message                                                    | What to do                                     |
| ---------------------------------------------------------- | ---------------------------------------------- |
| **The last review poll failed. Review runs may be out of date.** | Click **Retry with Refresh**.            |
| **Review service is unavailable. Showing cached runs from** a time | Click **Retry connection**.            |
| **Review history could not be loaded.**                    | Click **Retry**.                               |
| **No lanes available. Review has not produced a clean result.** | Check the lane availability in settings. |

## Run details

Click a run to open its details panel. The panel title is **PR #** and the PR number, followed by **review**. The panel shows the repository, the head commit, the attempt ID, and the run state. Click **Close** or push Escape to close the panel.

The panel has these sections:

- **Stage timeline** — each stage of the run (**Discovery**, **Context**, **Checks**, **Triage**, **Lenses**, **Verification**, **Identity**, **Publication**) with its state and its duration. A lens stage shows its scope.
- **Coverage and lanes** — the lane coverage, the **Lens family**, and the **Verifier family**. When the lens and verifier families are the same, the panel shows **Weaker evidence · same-family verification**. A partial run shows **Coverage limited. Unchecked paths are not claimed clean.**
- **Rerun this PR** — start the review again. See [Rerun a PR](#rerun-a-pr).
- **Findings** — a table with the columns **Severity**, **Lens**, **Location**, **Status**, and **Confidence**. Filter the table by status (**Accepted** or **Suppressed**) or by lens. Click a column name to sort the table.
- **Walkthrough preview** and **Artifacts**.

When a section has no data for the run, it shows a message, for example **Findings unavailable for this run.**

### Rerun a PR

1. Open the run details.
2. Go to **Rerun this PR**.
3. Click **Rerun as dry-run** to make a local preview. A dry-run does not publish comments.
4. Or click **Rerun live** to publish. A live rerun can publish a new COMMENT review and verified inline comments on the current PR head.
5. For a live rerun, select the permission check box in the **Start live rerun?** dialog.
6. Click **Start live rerun**.

**Rerun live** is not available when no bot token is connected or when all publication is paused.

## Review settings

Click **Review settings** in the page header to open the settings drawer. The settings apply to the next run. Click **Save review settings** to save your changes.

### Repositories

The **Repositories** section lists the repositories to review. Each repository has these controls:

| Control                                    | What it does                                                         |
| ------------------------------------------ | -------------------------------------------------------------------- |
| **Enable review polling**                  | Turns the review of this repository on or off                        |
| **Keep this repository in dry-run**        | Keeps the reviews local. Clear it to publish live.                   |
| **Pause publication for this repository**  | Stops the publication of comments for this repository                |
| **Remove**                                 | Removes the repository from the list                                 |

To add a repository:

1. Type the repository in **Add repository (owner/name)**, for example `octo-org/web-app`.
2. Click **Add repository**.

A new repository starts with polling off and in dry-run. PtahCode shows an error when the name is not a valid GitHub `owner/name` or when the repository is already in the list. Fork PRs are always excluded. CodeRabbit stays enabled alongside the Ptah review.

### Make a repository live

You must connect a bot token before a repository can publish. Until you connect one, the drawer shows **Connect a bot token to enable live publication.**

1. Connect a bot token. See [GitHub bot identity](#github-bot-identity).
2. Clear **Keep this repository in dry-run**.
3. In the **Enable live publication?** dialog, select the permission check box.
4. Click **Enable live publication**.
5. Click **Save review settings**.

The permission check box confirms that the bot token has **Pull requests: Read and write**, **Contents: Read**, and **Metadata: Read** for the repository.

### Other review settings

| Setting                       | What it controls                                                                  |
| ----------------------------- | --------------------------------------------------------------------------------- |
| **Maintainer allowlist**      | Your maintainer GitHub login for live permission attestation, and a comma-separated list of GitHub logins |
| **Minimum severity**          | The minimum severity of the findings (shown, not edited)                           |
| **Poll interval (minutes)**   | The time between two review polls, from 1 to 1440 minutes                          |
| **Max inline comments**       | The maximum number of new inline comments, from 0 to 100                           |
| **Confidence floor**          | The lowest confidence of a finding, from 0 to 1                                    |
| **Lane cap per PR**           | The maximum number of lanes for each PR, from 1 to 6                               |

### GitHub bot identity

The **GitHub bot identity** section holds the GitHub token that PtahCode uses to publish reviews.

1. Paste the token in **Connect bot token**.
2. Click **Save token**.
3. Click **Verify connection** to see the bot login.

When the token is valid, the section shows **Connected as** and the bot login, the reported scopes, and the connection time. When no token is connected, it shows **No bot connected. Live publication is unavailable.**

- To use a new token, paste it in **Replace bot token**, click **Save token**, and then click **Replace connection**.
- To remove the token, click **Remove connection**, and then confirm. Live publication stops until you connect another token.

:::caution[Token storage]
When system encryption is unavailable, PtahCode stores the bot token as plaintext. The section then shows a warning.
:::

## Pause publication

**Pause all publication** stops all reviews from publishing comments. The toggle is in the page header and in the settings drawer.

- Turn the toggle on to pause publication.
- To turn it off, click **Resume publication** in the **Resume live publication?** dialog. In the settings drawer, also select the permission check box. After you resume, eligible pull requests can receive comments again.

To pause only one repository, use **Pause publication for this repository** in the [Repositories](#repositories) section.

## Related

- [Cron Scheduler](/automation/cron/)
- [Git & Version Control](/git/)
