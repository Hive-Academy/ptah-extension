---
title: Council
description: Compare independent answers and receive a cited verdict in chat.
---

# Council

Council is Tribunal's discussion move. Each selected lane answers the same question independently. The conductor sends anonymized answers to the other panelists for critique, then returns a cited verdict with agreement, unresolved disagreement, and a recommendation.

Ask in the main chat: `/tribunal council: should we split this service?` or "Run a Tribunal Council on our API design." Include the decision, constraints, and evidence you want considered. You may name installed lanes in plain text or ask the conductor to choose a diverse panel from `ptah_agent_list`.

Before spawning, the conductor states the pinned panel, critique rounds, and estimated paid calls and waits for your confirmation. With fewer than two independent vendor families, it asks whether you want a single-voice answer or to stop. An extra critique round is proposed only when a substantive disagreement remains.

Answers, critiques, and the verdict appear in the main chat; task artifacts are saved under `.ptah/specs/TASK_*`. Ask for the task folder path if you need the source material. Say "stop this Tribunal run" to stop any live lanes via `ptah_agent_stop`. Council does not change code. For implementations, use [Forge](/tribunal/forge/) or [Race](/tribunal/race/).
