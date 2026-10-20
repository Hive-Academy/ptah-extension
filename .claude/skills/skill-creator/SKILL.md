---
name: skill-creator
description: Creates or updates agent skills — instructions, references, scripts and assets. Use when the user wants to write a new skill, improve an existing skill, or package domain knowledge, a workflow or a tool integration as a skill.
license: Complete terms in LICENSE.txt
---

# Skill Creator

Create and update skills: a SKILL.md that routes, plus optional scripts,
references and assets.

**Author against the rubric.** `references/prompt-authoring-rubric.md`
holds the ten authoring rules — routing, one home per rule, no model
education, one example per mechanism, contracts over narrative, measure
what loads. Read it before writing a body and audit every finished skill
against it. This file keeps the format contracts and the creation
process.

## Anatomy

```
skill-name/
├── SKILL.md          # required
│   ├── frontmatter: name, description (both required)
│   └── body (Markdown instructions)
├── scripts/          # executable code; runs without loading into context
├── references/       # docs, loaded into context only when needed
└── assets/           # files used in the output (templates, icons, fonts)
```

Create only the directories the skill will actually use. An empty or
placeholder-filled directory ships confusion.

## Frontmatter contract

- `name` and `description` are the only fields the loader reads, and the
  only two a skill needs. One exception is legitimate: a `license`
  field, when the skill carries a `LICENSE.txt` whose terms require the
  notice to travel with the work — this skill itself is such a case. Do
  not add fields beyond those.
- `name`: lowercase with hyphens; must match the directory name exactly.
- `description`: the primary trigger. State WHAT the skill does and WHEN
  to use it, in third person. All "when to use" information belongs here —
  the body loads only after the skill triggers, so a "When to Use"
  section in the body reaches nobody who has not already triggered it.

## Degrees of freedom

Match the specificity of the instructions to the task's fragility:

| Situation                                          | Freedom | Form                                |
| -------------------------------------------------- | ------- | ----------------------------------- |
| Many valid approaches; context decides             | High    | Prose instructions                  |
| A preferred pattern exists; some variation is fine  | Medium  | Pseudocode or parameterized scripts |
| Fragile operations; consistency is critical        | Low     | Specific scripts, few parameters     |

## Body rules

- Keep the body to the essentials and under 500 lines. When approaching
  the limit, split content into reference files.
- Link every reference file from SKILL.md with a load condition — what
  the reader needs, not just the file name. Keep references one level
  deep from SKILL.md.
- For a reference longer than 100 lines, open it with a table of
  contents. Past ~10k words, include grep patterns in SKILL.md so the
  reader can search the file without loading it whole.
- Never duplicate information between SKILL.md and references: each fact
  has one home, and every other mention links to it.
- No auxiliary files — README.md, CHANGELOG.md, QUICK_REFERENCE.md,
  setup or testing notes. Ship only what an agent needs to do the job.
- Write in imperative/infinitive form.

Routing is one mechanism — an index of links, each with its load
condition:

```markdown
# PDF Processing

## Quick start

Extract text with pdfplumber:
[code example]

## Advanced features

- **Form filling**: See `references/forms.md` for the complete guide
- **API reference**: See `references/api.md` for all methods
```

For a skill with several domains, frameworks or variants, split the
references by domain or variant (`references/aws.md`,
`references/gcp.md`) so a request loads only its own file.

## Creation process

Follow these steps in order. Skip one only with a clear reason it does
not apply.

1. **Understand the skill with concrete examples.** Ask what the skill
   must support, how it will be used, and what a user would say that
   triggers it. Do not ask everything at once — start with the most
   important questions and follow up.
2. **Plan the reusable contents.** For each example, identify what would
   help when the work recurs, and where it lives:

   | The work needs…                                            | Bundle as    |
   | ---------------------------------------------------------- | ------------ |
   | Code rewritten every time, or deterministic reliability     | `scripts/`   |
   | Documentation the agent should consult while working        | `references/` |
   | Files used in the output itself (templates, brands, fonts)  | `assets/`    |

   Example: "help me rotate this PDF" recurs as the same rotation code
   every time → `scripts/rotate_pdf.py`.

3. **Initialize.** Create `<skill-name>/`, then `SKILL.md` with the
   frontmatter, then only the resource directories the skill will use.
   Do not scaffold placeholder files "to be deleted later" — they ship
   by accident and every reader pays for them.
4. **Edit.** Write the reusable resources first; the user may need to
   supply inputs such as brand assets, schemas or API docs. Test added
   scripts by running them — a representative sample when many are
   similar. Delete any file the skill does not actually need.
5. **Package.** Validate first, then zip: a package that fails
   validation on the receiving end is worse than no package.
6. **Iterate.** Use the skill on real tasks, notice struggles, update
   the body or the resources, and test again.

### Validation checklist

Read the finished skill and check each item:

- The frontmatter parses as YAML and carries both `name` and
  `description`.
- `name` is lowercase-with-hyphens and matches the directory name
  exactly.
- `description` says WHAT and WHEN, in third person, under 1024
  characters.
- Every file path named in SKILL.md and in the reference files exists.
  Dead links are the most common defect — check them one by one.
- No `README.md`, `CHANGELOG.md` or other auxiliary documentation is
  present.

### Packaging

A `.skill` file is an ordinary zip with a different extension. Run from
the directory that contains the skill folder, so the folder is preserved
as the top-level entry in the archive:

```bash
zip -r my-skill.skill my-skill/
```

Fix any validation problem before packaging; do not ship and then
patch.

## References

| Read                                    | When you need to …                                        |
| --------------------------------------- | --------------------------------------------------------- |
| `references/prompt-authoring-rubric.md` | The ten authoring rules, to write or audit a body against. |
| `references/workflows.md`               | Sequential or conditional step patterns for a body.        |
| `references/output-patterns.md`         | Template and example patterns for consistent output.       |