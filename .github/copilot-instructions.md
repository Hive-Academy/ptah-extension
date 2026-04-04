# Code Review Instructions

Apply this three-phase review protocol. Be adversarial — find how code breaks, not how it works. Never rubber-stamp. Every review must find 3+ issues.

## Phase 1: Code Logic Review (40% weight)

Assume every line will fail in the worst way.

**Answer these 5 questions:**

1. **How does this fail silently?** — catch blocks that log but don't propagate to UI, promises without error handling
2. **What user action causes unexpected behavior?** — rapid clicks, tab switches mid-operation, navigation during async work
3. **What data produces wrong results?** — null/undefined inputs, empty arrays, malformed responses, extremely large datasets
4. **What happens when dependencies fail?** — network failures, timeouts, service unavailability, stale state
5. **What's missing that requirements didn't mention?** — offline behavior, cleanup on destroy, concurrent operations, retry logic

**Critical smells to flag:**

- Silent failures: catch blocks that swallow errors while UI shows success
- Race conditions: state checked in one tick, used in another without re-validation
- State inconsistency: mutations without synchronized UI updates
- Fire-and-forget: async calls without error handling or user feedback
- Missing cleanup: subscriptions, timers, event listeners not disposed on destroy
- Stale closures: callbacks capturing state that changes before execution

**Severity:** Data loss or silent failures → CRITICAL. Missing error handling → SERIOUS. Default to higher severity when unsure.

## Phase 2: Code Style & Patterns Review (35% weight)

Every line must justify its existence.

**Answer these 5 questions:**

1. **What breaks in 6 months?** — fragile coupling, magic strings, implicit dependencies
2. **What confuses a new team member?** — unclear data flow, non-obvious side effects, hidden state
3. **What's the hidden complexity cost?** — premature abstractions, over-engineering, unnecessary indirection
4. **What pattern inconsistencies exist?** — deviations from established codebase conventions
5. **What would I do differently?** — simpler alternatives, better naming, clearer structure

**Project patterns to enforce:**

- Angular signals for all frontend state (never RxJS BehaviorSubject for state)
- Branded types (SessionId, MessageId) — never raw strings for IDs
- Strict layering: libs depend only on layers below, no circular deps
- Standalone components with zoneless change detection (no NgModules)
- tsyringe DI with tokens from vscode-core for backend services
- Event-driven: state changes published via EventBus
- No `any` types, no unsafe type assertions hiding nullability
- No TODO/FIXME without linked issue, no stub implementations
- No console.log in production paths
- Single responsibility per function; extract at nesting depth > 3

## Phase 3: Security Review (25% weight)

OWASP-aligned assessment adapted for VS Code extensions.

**Always check:**

- No hardcoded secrets: API keys, tokens, passwords, connection strings in source
- Input validation: all external input sanitized before use
- Injection prevention: no raw string concatenation in queries, commands, or file paths
- No authentication bypasses or privilege escalation paths
- No PII/sensitive data in logs or error messages
- No `eval()` or dynamic code execution
- Content Security Policy enforced in all webviews
- Webview ↔ extension messages validated on both sides
- File system access uses proper path validation (no path traversal)
- Extension permissions follow least-privilege principle
- Dependencies: flag known-vulnerable packages

## Scoring

| Score | Meaning                                     | Frequency |
| ----- | ------------------------------------------- | --------- |
| 9-10  | Handles all edge cases, production-hardened | <5%       |
| 7-8   | Good, minor improvements needed             | 20%       |
| 5-6   | Core works, gaps in coverage                | 50%       |
| 3-4   | Significant logic gaps or silent failures   | 20%       |
| 1-2   | Fundamental errors                          | 5%        |

Best reviews make the author say "I hadn't thought of that."
