Verdict: REVISE

| Round 1 finding | Resolved? | Plan evidence |
| --- | --- | --- |
| Serious: AC 3.11 step 4 assigned and left unwritten | Yes in the operative body; stale decision row remains (finding 2) | `implementation-plan.md:183-188,880-883,1126-1134,1319-1324,1360-1371,1436-1444` assigns all four steps, with step 4 asserting `AUTH_REQUIRED` naming the stored provider and no `resumeSession`. Q2 is marked superseded by `decisions.md:41-42`. |
| Moderate: reused URL helper cannot meet Codex's first-valid/4096 contract | Partly; new defect prevents Kimi parity (finding 1) | `implementation-plan.md:304-334,360-368,396-408` separates all-candidate extraction from Kimi's first-candidate/2048 wrapper and adds Codex-only validation, but the exact wrapper expression loses the no-match guard in `kimi-code-login.service.ts:403-405`. |

## New findings

1. **Serious — The specified Kimi wrapper throws on a line with no HTTPS URL.** The plan defines `extractHttpsUrl(line)` as `parseHttpsUrl(httpsUrlCandidates(line)[0], 2048)` (`implementation-plan.md:321-327`). For a line with no match, index zero is `undefined`; `parseHttpsUrl(candidate: string, maxLength)` reads `candidate.length` before its `try` block (`implementation-plan.md:321-324`). The current Kimi helper returns `undefined` before dereferencing a missing match (`libs/backend/auth-providers/src/lib/providers/kimi-code/kimi-code-login.service.ts:403-405`), and its existing spec explicitly calls `extractHttpsUrl('nothing here')` (`kimi-code-login.service.spec.ts:306-313`). Ordinary Kimi output without an HTTPS URL would now throw through its unchanged caller (`kimi-code-login.service.ts:231-237`). Guard an absent first candidate before calling `parseHttpsUrl`, preserving the existing return value; keep the no-URL Kimi test and add it to the shared helper spec.

2. **Moderate — One Revision 1 decision row still says AC 3.11 step 4 is held.** `implementation-plan.md:1287` says that the continuation step is held by the scope note, contradicting the now-operative four-step test (`implementation-plan.md:1319-1324`) and `decisions.md:41-42`. The historical Q2 paragraph is explicitly marked superseded (`implementation-plan.md:1352-1362`), so it is unambiguous; row R1-6 lacks that marker. Update R1-6 to describe the current `AUTH_REQUIRED` assertion, or mark its old text superseded. This is the sole remaining active “held” mention found by the requested grep.

## Decisions

| Decision | Options | Evidence | Reversible? |
| --- | --- | --- | --- |
| Ship AC 3.11 steps 1-4 here; step 4 expects `AUTH_REQUIRED` and no resume, with carry-over in its separate task. | Hold step 4; implement carry-over here. | `decisions.md:41-42`; `implementation-plan.md:1319-1324,1436-1444`. | Yes. |
| Keep Kimi's first-candidate/2048 behavior, including `undefined` for no match; use first-valid/4096 only for Codex. | Change Kimi parsing; duplicate the regex for Codex. | `decisions.md:44`; `kimi-code-login.service.ts:402-415`; `kimi-code-login.service.spec.ts:306-313`. | Yes. |
