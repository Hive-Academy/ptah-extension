# Caption cleanup review — builder-invitation

WhisperX ran with `--language ar`, so English engineering terms came back written
phonetically in Arabic script. `scripts/clean_transliterations.py` restored them
using `term-dictionary.json`. Timing was never touched: every replacement carries
the exact `start` of the first word it replaced and the exact `end` of the last.

- 97 substitutions applied (86 dictionary terms)
- 89 at **high** confidence, 8 at **medium**, 0 at **low**
- 34 entries (35 tokens) **left alone** and listed below for a human ear
- word count 1832 → 1788 (44 multi-word runs merged into single entries)

Timestamps are `mm:ss.mmm` from the start of the audio.

---

## 1. Substitutions made at medium confidence — verify these

Listen at the timestamp and confirm the speaker really said the English term.
To reject one, delete or edit its entry in `term-dictionary.json` and re-run
`scripts/clean_transliterations.py`.

| Time                | Was                  | Now                 | Why it is uncertain                                                                                                                                      |
| ------------------- | -------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 00:43.523–00:44.564 | `بـ Forehand`        | `بـ beforehand`     | Whisper wrote a Latin word it mis-heard. "نبني لها بـ beforehand" fits, but the result reads redundantly next to `بـ`.                                   |
| 01:07.569–01:08.250 | `اللونج تيرمي`       | `الlong term`       | Clearly "long term", but the trailing `ـي` may be an Arabic possessive the merge swallowed.                                                              |
| 03:10.288–03:10.588 | `بالtechnical depth` | `بالtechnical debt` | Same mis-hearing as elsewhere in the video ("technical debt" appears 4 more times). Confident on meaning, less so that he did not literally say "depth". |
| 04:02.480–04:03.921 | `لبوينت أوف تايم`    | `لpoint of time`    | "point of time" is the literal transliteration; he may have meant "point in time". Kept literal rather than corrected.                                   |
| 04:16.610–04:16.890 | `واللود`             | `والdownload`       | Context is "…download from here", but the token is heavily clipped.                                                                                      |
| 08:22.367–08:22.668 | `لساس`               | `لSaaS`             | `لـ + ساس` = "for SaaS", and "SaaS application" appears elsewhere in Latin. Still a one-syllable guess.                                                  |
| 09:46.760–09:47.220 | `الكود بيس`          | `الcodebase`        | "لو الcodebase كبير" reads correctly, but `الكود` alone is used 3 other times as plain Arabic for "the code".                                            |
| 11:35.869–11:36.609 | `الاجنس`             | `الagents`          | Fits "الagents والorchestration", but the token is mangled enough to be something else.                                                                  |

## 2. Suspected transliterations left alone — decide, then add to the dictionary

Nothing below was changed. Rule followed: a wrong "correction" is worse than an
uncorrected word.

### Flagged explicitly in the brief

| Time                | Token            | Suspected        | Note                                                                                                       |
| ------------------- | ---------------- | ---------------- | ---------------------------------------------------------------------------------------------------------- |
| 07:46.295–07:47.115 | `والقلامة cloud` | a provider name? | Mangled beyond safe reconstruction. Left verbatim — do NOT let the generic `cloud → Claude` rule reach it. |
| 11:11.561–11:12.362 | `المات سينيور`   | `mid-to-senior`  | "على الاقل كده mid-to-senior" fits the sentence, but the first token does not sound like "mid".            |

### Verbs carrying Arabic prefixes

These are English verbs with Arabic morphology glued on. Restoring them produces
hybrids like `يrun`, which may or may not be the house style. All left in Arabic.

| Time                | Token      | Likely       |
| ------------------- | ---------- | ------------ |
| 03:15.340–03:15.700 | `تجاين`    | join         |
| 04:32.261–04:32.561 | `يجوين`    | join         |
| 04:42.648–04:43.028 | `هيجاين`   | will join    |
| 04:44.949–04:45.730 | `يأكسس`    | access       |
| 08:49.310–08:49.630 | `ترن`      | run          |
| 09:44.698–09:45.038 | `يأكسس`    | access       |
| 10:47.948–10:48.289 | `ارن`      | run          |
| 07:37.246–07:37.787 | `اكونكت`   | connect      |
| 07:51.120–07:52.060 | `اشير`     | share        |
| 07:57.566–07:57.906 | `بشير`     | share        |
| 11:21.144–11:21.504 | `تسكب`     | skip         |
| 11:58.903–11:59.363 | `يرن`      | run          |
| 12:09.047–12:09.287 | `يرن`      | run          |
| 12:42.856–12:43.136 | `نشير`     | share        |
| 13:34.671–13:35.271 | `يسكراتش`  | scratch      |
| 06:48.429–06:49.070 | `بننتجريت` | we integrate |

### Nouns that are plausible but not certain

| Time                  | Token                | Suspected            | Note                                                                                                                                          |
| --------------------- | -------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 03:21.822–03:22.302   | `اساس application`   | `SaaS application`   | `اساس` is also ordinary Arabic for "foundation" — "builds us the foundation of the application" is a valid reading.                           |
| 03:41.466–03:42.647   | `للاساس application` | `للSaaS application` | Same ambiguity as above.                                                                                                                      |
| 06:50.130–06:51.090   | `كاوركسترا`          | `كorchestra`         | Product vocabulary ("coding orchestra"), but the surrounding clause is garbled.                                                               |
| 06:57.692–06:58.212   | `اجزامبل`            | `example`            | Sounds like "eggzample"; could also be a false start.                                                                                         |
| 10:20.707–10:21.107   | `كوربس`              | `corpus` / `repos`   | Two different readings, both plausible in "على كل كوربس من دول".                                                                              |
| 09:52.925 / 09:55.687 | `دابل`               | `double`?            | Appears twice inside a Latin list of apps. Meaning unclear — possibly a list filler.                                                          |
| 10:56.353–10:56.573   | `سوري`               | `sorry`              | A spoken self-correction. Arabic script is the normal way to write it; left as is.                                                            |
| 06:12.039–06:12.759   | `screening window`   | `SmartScreen window` | Already Latin. Context is the Windows publisher prompt, so "SmartScreen" is likely, but this is a mis-hearing fix, not a transliteration one. |

### Garbled audio — not transliterations, but the caption reads wrong

Worth a re-listen if these lines make the final cut.

| Time      | Token      | In context                                          |
| --------- | ---------- | --------------------------------------------------- |
| 01:59.663 | `ويطلق`    | "…ويطلق بquality كويسة" — probably `ويطلع`.         |
| 04:08.284 | `منان`     | "…وللكود اللي حصل منان على أن…"                     |
| 04:30.259 | `ويحبزها`  | "…كله open source ويحبزها لو حابب…"                 |
| 04:50.113 | `فتح مبني` | "…ونبدأ نشرح فتح مبني ازاي…" — probably `هو متبني`. |
| 10:09.542 | `خيال`     | Opens segment 26 with no antecedent.                |
| 12:06.586 | `المخلص`   | "…والمناسبة هو المخلص الlimit…"                     |
| 12:31.522 | `يروبوت`   | "…فيقدر يروبوت الاتنين ببعض…"                       |
| 12:55.920 | `السوءة`   | "…بنوري السوءة ونوري الناس…"                        |

## 3. Deliberately untouched ordinary Arabic

Words that look foreign at a glance but are ordinary Egyptian Arabic and were
never candidates: `بنسميه`, `مظبوط` / `المظبوط` / `مصبوط`, `متسطب`, `المشاكل`,
`الحلول`, `المقدرة`, `بالنسبالي`, `الكمال`, `نقاشها`, `بتاعكو`.
