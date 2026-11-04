# design-spec.md + prototype — Gate 1.7 review (round 1)

- Author: codex lane f573685c (CLI side), role ui-ux-designer
- Reviewer: orchestrator (in-process side, Claude family)
- Verdict: **REVISE**

The runs list, run drawer, stage timeline, coverage notices and confirmation boundary are good and
match the existing cron surface and ptah-glass tokens in both themes. Gaps:

## Findings

1. **Serious — Repository settings surface is not designed.** The spec and prototype only link to
   "Repository settings". User decisions recorded after the design started (decisions.md D10–D12)
   need a designed settings surface:
   - D10: GitHub bot identity — connect/replace/remove the bot token (stored via secret storage;
     show only "connected as <login>", scopes check result, last verified time; never the token).
   - D11: trust policy — repositories (v1: Hive-Academy/PtahCode only, but the model is a list),
     editable maintainer allowlist of GitHub logins, forks always excluded (read-only note).
   - D12: lane budget — per-PR lane cap (default 6), polling interval, lens toggles and minimum
     severity/confidence (FR-10, FR-13), fallback family order; plus repo config file status
     (found / invalid with exact key and error / absent → defaults; AC-13.3).
   Design it as a section, tab or drawer of the Review runs surface (your choice, justify), with
   validation, empty and error states, and screenshots.
2. **Moderate — Missing light-theme evidence.** Only the list has a light screenshot. Add light
   screenshots of the run detail drawer, the confirmation dialog, the new settings surface, and at
   least the "No lanes available" and "GitHub offline" states (dark too where missing).
3. **Minor — Prototype-only control.** The "Preview state" select is a prototype device. Mark it
   prototype-only in the spec so it is not implemented.
4. **Minor — Strikethrough in the "Skipped-untrusted" badge** reduces legibility. Use plain text and
   an icon.
5. **Minor — Sample data.** Use `Hive-Academy/PtahCode` as the repository in sample data.
6. **Minor — Open question "backend authorization flag".** Decide it: Electron is a local
   single-operator app; the app user is the operator in v1 and no extra authorization layer exists.
   Move it to Decisions.

---

# Round 2 re-review

- Revision by: codex lane a31c5beb (resumed session 01a1a27c)
- Reviewer: orchestrator (in-process). Screenshots inspected: review-settings-light,
  review-settings-lower-dark, review-confirmation-light (+ round 1: runs dark/light, detail dark).
- Verdict: **APPROVED**

| # | Status |
|---|---|
| 1 | Resolved — settings drawer: bot identity (login + scopes, token never shown), trust policy (PtahCode only, maintainer logins, forks excluded), thresholds, lane cap, lens toggles, fallback order, repo config status |
| 2 | Resolved — 16 dark/light screenshots incl. detail, confirmation, settings, invalid config, no lanes, GitHub offline |
| 3–6 | Resolved per revision log |

## Binding notes for the architect (not worth a third round)

- N1: Lens names in the prototype (Architecture/Behavior/Security/Reliability) are sample labels.
  Implement the FR-6 lens set: correctness & async lifecycle; producer-consumer contracts &
  outside-diff callers; security & privacy; host parity, DI registration & configuration.
- N2: Default minimum severity is **Minor** (not the sample "Major"); Nitpick is summary-only
  (AC-9.3). Minor findings were 77/108 of the CodeRabbit sample.
- N3: "Preview state" and "Prototype config state" selects are prototype-only.
