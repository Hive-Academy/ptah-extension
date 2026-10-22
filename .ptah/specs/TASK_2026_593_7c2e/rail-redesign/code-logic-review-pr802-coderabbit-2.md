# Code logic review — redaction regex confirmation

Review family: grok (implementer: codex; regex correction by orchestrator)

**Verdict: APPROVED**
**Score: 8/10**

0 blocking, 0 serious, 0 moderate, 0 failure modes.

The suffix that treated any letter continuation as part of the key is gone. `SECRET_NAME` at `chat-attention-source.service.ts:21` is now a sensitive word with separator-bounded repeats on both sides. The four ordinary commands stay intact, and the prefixed, suffixed, and bare keys still redact. Both repeats are anchored by a mandatory `_` or `-`. The added spec cases do not contain a secret-shaped literal.

8 sits below 9 because a name that continues with letters (`authorization`, camelCase `dbPassword`) still does not redact, and the fallback key test at `chat-attention-source.service.ts:43` still uses a substring match. 8 sits above 7 because those are outside the suffix bug: the named ordinary words no longer redact on the command path, and the positive cases still do.

`ptah_*` tools are not connected in this session (tool search returned no `ptah_*` schemas). Evidence is the service read in full (211 lines), the redaction specs at `chat-attention-source.service.spec.ts:150-189`, and one Node check of the same two expressions. Nx, Jest, tsc, lint, and build were not run. Geometry was not reopened.

## Decisions

- Separator-bounded parts are the fix the previous review asked for, not a new gap. A suffix must be empty or start with `_` or `-`, and a prefix segment must end with `_` or `-`. That keeps `TOKEN_BACKUP` and leaves `author`, `tokens`, and `secretary` alone. Reversible.
- Alphabetic continuation (`authorization=`) and camelCase without a separator stay unredacted under that rule. Not raised as a defect.

## Defects

None.

## Check (1) — ordinary words fixed, positive keys still redact

No defect.

`SECRET_NAME` (`chat-attention-source.service.ts:21`):

`(?:[A-Za-z0-9]+[_-])*(?:password|passwd|secret|token|api[_-]?key|auth)(?:[_-][A-Za-z0-9]+)*`

Assignment wraps it as `(\b${SECRET_NAME}\s*=\s*)` plus the same three value alternatives (`:22`). Flags wrap it as `(--${SECRET_NAME}\s+)` (`:23`). `safePreview` still replaces the kept prefix with `***` (`:28-29`).

Ordinary words, applied to those expressions:

- `git log --author alice` — after `--`, `auth` can match, but `or` does not satisfy `(?:[_-][A-Za-z0-9]+)*`, and `\s+` then fails. No `=`, so the assignment expression does not apply.
- `git commit author=alice` — `\b` is at `author`. `auth` leaves `or=`, which is neither a separator suffix nor `\s*=`.
- `count tokens=5` — `token` leaves `s=`. The suffix cannot take `s`.
- `set secretary=bob` — `secret` leaves `ary=`. Same miss.

The spec asserts the unchanged command at `chat-attention-source.service.spec.ts:181-188`.

Positive keys still match because the prefix and suffix repeats may be empty, and a non-empty part must carry `_` or `-`:

- `GITHUB_TOKEN=` — prefix `GITHUB_`, word `token`, empty suffix, then `=`.
- `DB_PASSWORD=` — prefix `DB_`, word `password`.
- `AWS_SECRET_ACCESS_KEY=` — prefix backtracks to `AWS_`, word `secret`, suffix `_ACCESS` and `_KEY`.
- `--api-token ` — prefix `api-`, word `token`, flag whitespace.
- `--client-secret ` — prefix `client-`, word `secret`.
- `TOKEN_BACKUP=` — empty prefix, word `token`, suffix `_BACKUP`.
- bare `password=` and `--token ` — empty prefix and empty suffix, as before (`:156-159` still expects both redactions).
- `api[_-]?key` still covers `API_KEY=`, `apikey=`, and `--api-key `.

A Node run of these expressions matched all fourteen fixtures (four ordinary, ten redacting).

## Check (2) — backtracking

No defect. Not catastrophic.

The first repeat ends with a mandatory `[_-]`. The second repeat starts with a mandatory `[_-]`. `[A-Za-z0-9]+` cannot consume the separator, so each segment has one split. The optional separator inside `api[_-]?key` is a single `?`, not a repeat. There is no nested quantifier of the form `(...+)+`.

Failure on a long chain of separator segments is polynomial: the engine gives the prefix back one segment at a time and retries a fixed set of words. A run of 4000 `a-` segments plus 2000 `token-` segments finished in the same Node process in 38 seconds. It did not hang. `String.prototype.replace` on the module-level `/g` expressions resets `lastIndex`, so one preview does not resume inside the next (`:28-29`).

## Check (3) — remaining over- or under-redaction

No serious remainder on the command patterns.

Under-redaction that follows the separator rule, and is not a defect: `authorization=` and `dbPassword=` do not match, because the letters after `auth` / before `password` are not a `_` or `-` segment. Plurals such as `tokens=` and `max_tokens=` do not match either; `tokens=5` is an asserted negative case (`:182`).

Over-redaction that the positive spec requires: any separator suffix is part of the key, so `TOKEN_BACKUP=` redacts (`:172`) and so does a numeric name such as `token_count=`. That is the same suffix rule, not a letter-class bug.

The fallback branch at `chat-attention-source.service.ts:42-46` is unchanged. It runs only when `command`, `file_path`, and `pattern` are absent. Its key test is `/secret|token|password|key|credential/i`, so an object key `tokens` or `secretary` still becomes `[redacted]`, while `author` does not (`auth` is not in that test). The git flag case goes through `command` and `safePreview`, not this branch. Left as a pre-existing boundary, not a serious defect in this correction.

## Check (4) — spec literals

No defect in the cases this correction adds.

`chat-attention-source.service.spec.ts:181-182` uses ordinary commands, the names alice and bob, and the digit 5. The positive rows at `:167-172` build the value with eight `x` characters via `repeat`, which is shorter than the token-shape minimums at `chat-attention-source.service.ts:24`. Expectations are the key text plus `***`.

## Five logic questions

1. **Silent failure.** A preview can still be produced and Allow still offered. For the four ordinary commands, the operand is no longer replaced, so the row is not a successful-looking redaction of a normal flag. A non-matching secret name (`authorization=`, camelCase without a separator) stays visible; that is the separator rule, and the row does not claim the value was removed.
2. **Unexpected user action.** Approving `git log --author alice` or `git commit author=alice` now shows the operand (`:181-188`). Approving a prefixed assignment still shows the name and `***`.
3. **Wrong answer from input.** `author`, `tokens`, and `secretary` as assignments or as a `--` flag produce the original command. `GITHUB_TOKEN`, `DB_PASSWORD`, `AWS_SECRET_ACCESS_KEY`, `--api-token`, `--client-secret`, `TOKEN_BACKUP`, bare `password`, and bare `--token` still produce `***` after the name. Eight `x` characters are not eaten by the token-shape expression.
4. **Dependency failure.** `safePreview` does not call the network (`:26-30`). A value alternative that does not match means the whole key pattern fails, so a bare `password` with no value is left as written. The global replace does not keep `lastIndex` across previews.
5. **Unspecified remainder.** The correction does not define camelCase or letter continuation. Those stay visible. The fallback key test at `:43` is outside `SECRET_NAME` and still substring-matches `token` and `secret`.

## Scope and uncertainty

Examined `chat-attention-source.service.ts` in full and the redaction specs at `chat-attention-source.service.spec.ts:150-189`. Did not re-read the rest of that spec file, and did not run the Jest file. The Node check covered the fourteen fixtures above, not the other 18 tests in the file. Did not re-open rail geometry.
