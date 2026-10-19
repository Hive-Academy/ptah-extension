# Prompt-Authoring Rubric

The ten rules every skill body is written and audited against. Apply them
when creating a skill, trimming one, or reviewing one for publication.
Rules 1 and 10 decide structure; the rest decide content.

## 1. SKILL.md routes

The triggers live in the frontmatter description. The body carries the
3–5 rules that break silently when violated, plus a reference index with
a load condition per link. Target ≤ ~150 lines; when the body exceeds
that, the longest section carries the burden of proof.

## 2. One home per rule

Each rule has exactly one home — SKILL.md or a reference file. Every
other occurrence is a link to that home, never a paraphrase. Paraphrases
drift from their home and the two start to disagree.

## 3. Cut model education

Do not teach what the using model already knows or can read from a
schema: SOLID, poll loops, retry patterns, tool basics. Keep what it
cannot derive: unfamiliar library contracts, failure cases and
parser-sensitive labels. "Never teach concepts" is not a law — teach the
concepts the model cannot look up.

## 4. One example per mechanism

One worked example per mechanism. Variants that differ by one string
become one example plus a table, not N examples.

## 5. No history

No task IDs, no dates, no "this already cost us". A skill states the
current contract; how it got here is not loadable knowledge.

## 6. Contracts over narrative

Schemas, gates, output fields and stop conditions stay precise. Prose
that describes them goes. If the reader can be handed the shape, do not
hand them a paragraph about the shape.

## 7. No rosters, counts or versions that discovery supplies

If the runtime can tell the agent — a list command, a detect call, a
`--help`, a schema advertisement — do not write the list down. Write how
to run the discovery and what the result means.

## 8. Role-gated capabilities

An agent only receives capabilities it may use. Do not load instructions
for tools or actions the receiving role cannot invoke.

## 9. No hardcoded brand or stack

A generic skill must not hardcode a brand or stack; the project supplies
those as input. A skill whose subject is the brand or product itself is
not generic — it names its subject freely.

## 10. Measure what loads

Directory size is not the metric. Measure the trigger text (frontmatter
description), the selected reference and the expanded agent. Validate a
cut on a representative task before accepting it: the skill must still
route and still teach after the trim.

## Audit procedure

1. Measure the frontmatter description separately as trigger-time cost;
   sum the byte sizes of all skill files for total skill size.
2. Count the rules that break silently. More than five: the extras move
   to references. Fewer than three: the body may be under-specified.
3. Walk every section against rules 2–9 and mark each finding with its
   line number.
4. Cut the narration, move the per-workflow detail behind a reference;
   never change what the skill teaches.
5. Re-measure, then run the skill's validation (links exist, frontmatter
   parses) and one representative task before accepting the cut.
