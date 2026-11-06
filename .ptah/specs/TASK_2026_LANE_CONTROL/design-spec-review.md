# design-spec.md + prototype — review

Reviewer: orchestrator (in-process). Author: codex CLI lane. Round: after revise round 1.
Verdict: **APPROVED** with implementation notes. Rendered at 1440x1000, dark and light themes.

## Accepted
- Compact vs full composer variants; queue summary line on compact surfaces.
- Distinct vocabularies: receipt (Queued / Sending / Received / Done / Failed / Expired /
  Interrupted — not sent), verdict (Deliverables written / No deliverable / Failed / Unverified),
  parent signal (Waiting for parent / Sent to parent).
- Labelled policy badges ("Messaging: steer", "Permission: Ask", "Network: denied", "Limit: …").
- Pre-press hint line and the partial-work discard warning for interrupt-resume.
- Stopped lane: Resume is primary; "Resume with message" with the resume path shown before press.
- Attributed communication thread with inline receipts, report vs completion icons.
- CLI tools management table for all adapters with row details.

## Implementation notes (binding for Batches 7 and 9)
1. Use real icons (lucide, as the app already does) for the split-button chevron, report,
   completion and lane identity. The prototype's "v" and "?" glyphs are placeholders.
2. Separator "·" and check marks must render as text, not entities (prototype lacks a charset).
3. Compact surfaces hide the queue section entirely when empty (the stopped Migration card still
   shows "Queued messages (0)").
4. A stopped lane shows only Resume / Resume with message. Send now is not shown on a stopped
   lane.
5. CLI table: the Status column shows install state only (Installed / Not installed / Disabled).
   Verification state belongs to the capability cells (e.g. "Unverified" with a tooltip).
6. Values in the table come from the live manifest (`agent:detectClis`), never hard-coded.
7. Visual review in Electron (dark + light) is required before merge.
