# Decisions - TASK_2026_862_bf84

| # | Decision | Evidence / source |
| - | -------- | ----------------- |
| 1 | Type FEATURE, depth Full | User request ("Full workflow"); keywords "make ... use", new selection logic |
| 2 | Lanes enabled, approval mode `user` for Gate 2 | User: "a plan I approve before any implementation"; lanes named by user |
| 3 | Research split in two parallel lanes: codex (runtime/binary/admission) and Kimi (models, pricing, protocol tolerance, auth, dependency bump) | File-disjoint read scopes; user-named lanes |
| 4 | Architect = codex lane; plan reviewer = Glm (different family) | User rule: reviewer of another family |
| 5 | User waived plan approval mid-run: proceed through implementation, live test with the "luna" model, PR, CI green, all review comments addressed | User message 2026-11-03 ("don't wait on me ... test it with luna model and make a pr") |
| 6 | User-reserved plan items decided by orchestrator under that delegation: minimum version 0.165.0 (= bundled); delete offline pin manifest rows/generator as proposed in parity-inventory | Plan Decisions + Glm review; user delegated |
| 7 | Live check authorized: Codex turns with the luna model are allowed (user named it) | User message |
