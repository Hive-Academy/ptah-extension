# Scope change 1 — approved canvas dock removal

| Section | Change |
| --- | --- |
| Context and scope | Decision #9 removes the entire dock on empty and populated boards; the session viewport gains its height. |
| Session entry and create flow | The one optional-name popover anchors to the centre hero button on an empty board and the sidebar footer button with tiles; name, Enter/Escape, Cancel/Create, focus, disabled states, `aria`/title, and cap reasons remain. |
| Warning parity | Layout-write failure, newer-version read-only layout, and `headerMessage` move to an **inline** dismissable board notice, not a snackbar. Notices recur while their condition remains true; a regression test must assert all three paths. |
| Approved removals | The dock back-office ticker and its Thoth click target are removed; Thoth stays reachable from its own page. The needs-you chip and its four `canvas-needs-you-queue*.ts` implementation/spec files are removed in this task's last phase after TASK_2026_593_7c2e merges. |
| Cross-task boundary and gate | This task owns `orchestra-canvas.component.ts` dock removal and the gated chip/queue deletion. TASK_2026_593_7c2e in `.claude-worktrees/attention-notifications` owns the bell and notification-center code and does not edit the canvas component. The other dock-removal work may proceed before its merge; chip unmount waits for the merged bell's attention and lane-permission coverage. |
| Parity inventory | Replaced the combined dock row with separate capability, backing-service, destination, decision, and test rows. |
