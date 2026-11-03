# User decisions — motion presets (2026-10-31)

These answers close the plan's open questions. They override the plan where they differ.

1. Default preset: **Rise**.
2. Top-level surface change (chat -> settings) under a slide preset: **plain whole-window crossfade**. Slides apply only inside surfaces (child routes, tabs). The navbar and rails never move.
3. Fade preset on panels that contain blurring glass panes: **move without fade** (transform-only entrance, exit is a cut).
4. Extras in scope: **provider setup wizard steps** and **chat session tabs** (the session switch uses the selected preset instead of the fixed crossfade).
   Not in scope: a separate "None" preset.
5. Earlier decision: Motion setting "Always animate" / "Follow system" / "Reduce motion", default **Always animate** (Chromium startup switch, separate lane). "Reduce" must still win over every preset.

6. Plan final review (round 2) open item, decided 2026-11-01: **fix it in the build**. The Marketplace batch adds a preset exit animation to the inspector and the drawer when they close on detail -> list. The batch code review checks it.
