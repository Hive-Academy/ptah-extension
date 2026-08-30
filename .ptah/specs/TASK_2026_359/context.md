# Context — TASK_2026_359

## Why

The setup wizard exists so the generated agents fit the repository in front of
it. The mechanism was `<!-- LLM:ID -->` sections that the model fills from the
project analysis. By v0.2.32 only three templates still carried them; TASK_2026_254
removed those and, in the same pass, wrote Ptah's own stack into five template
bodies. Both moves were wrong for a product asset that ships to arbitrary repos.

The stale-census defect that motivated the removal was in what the old prompt
produced (lib counts, versions), not in the mechanism.

## Design

| Layer               | Content                                                          | Author                  |
| ------------------- | ---------------------------------------------------------------- | ----------------------- |
| Template body       | Role, inputs, method, output contract, refusals — stack-agnostic | Hand-authored           |
| `_shared/` partials | Cross-cutting protocol rules                                     | Hand-authored           |
| `LLM:*` sections    | Conventions, patterns, review focus for THIS repo                | Model, wizard time      |
| `{{VAR}}` slots     | Project type, monorepo type, package manager                     | Analysis, deterministic |

LLM section rules (prompt + post-validation): patterns and conventions only;
no counts, no version numbers, no lib censuses; every claim backed by a path
the analysis found; bounded length; generic fallback text stays inside the
markers for the no-SDK path.

## Section map

| Role                                                                                                                              | Sections                                     |
| --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| backend-developer, frontend-developer                                                                                             | FRAMEWORK_CONVENTIONS, ARCHITECTURE_PATTERNS |
| devops-engineer                                                                                                                   | BUILD_AND_DEPLOY_SURFACE                     |
| senior-tester                                                                                                                     | TEST_INFRASTRUCTURE                          |
| software-architect                                                                                                                | EXISTING_PATTERNS                            |
| code-logic-reviewer, code-style-reviewer, visual-reviewer                                                                         | REVIEW_FOCUS                                 |
| team-leader, project-manager, researcher-expert, modernization-detector, technical-content-writer, ui-ux-designer, video-director | none required                                |

## Related

TASK_2026_254 — the audit and the shared-partials resolver this builds on.
