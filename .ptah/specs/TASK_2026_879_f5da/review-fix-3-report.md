# Review fix 3: visual request routing

## Rule

Code requests route to **compact** when a code word follows a visual noun directly or with one intervening adjective (for example, `chart component` or `graph rendering bug`), when the visual noun is in a filename/code token (for example, `plot.ts` or `chart.component.html`), or when the request's main verb is `fix`, `refactor`, `rename`, `debug`, `test`, `lint`, `typecheck`, `implement`, `add a test`, `write a test`, or `review the code`. Polite request prefixes are accepted before those verbs.

Visual nouns linked to their subject by `of`, `for`, `showing`, `about`, `on`, or `with` route to **report**, including when the subject contains a code word. The code-verb rule takes precedence. The existing report phrases, visual triggers, and bug/error-report negatives remain. The Electron-only call-site gate and Codex wording were untouched.

## Spec table

| Route | Request |
| --- | --- |
| REPORT | make a diagram of the module dependencies |
| REPORT | draw a chart of the test results |
| REPORT | build a dashboard for my components |
| REPORT | can you do it with charts better |
| REPORT | visualize my open tasks |
| REPORT | make a diagram of the architecture |
| REPORT | give me an infographic of this sprint |
| REPORT | show a representational view of my work |
| REPORT | send me a report of all in-progress tasks |
| REPORT | make a dashboard of my work |
| COMPACT | show me the chart component source |
| COMPACT | create a chart component |
| COMPACT | fix the graph rendering bug |
| COMPACT | refactor plot.ts |
| COMPACT | add a test for the diagram module |
| COMPACT | fix the chart component bug |
| COMPACT | rename the plot variable |
| COMPACT | what does the diagram.ts file do |
| COMPACT | file a bug report |
| COMPACT | report this error |
| COMPACT | can you report on the crash |

The spec also covers the remaining code verbs, one-adjective adjacency, and `chart.component.html` while retaining every prior case.

## Verification

Reviewed the matcher and spec table after editing. `ptah_get_diagnostics` was scoped to both changed TypeScript files and returned 0 errors and 0 warnings with clean coverage. The sandbox prohibits npm, nx, Jest, and Node, so tests were not run.

## Decisions

- **Precedence:** Code verbs win over visual subject links. This follows the explicit rule and is reversible.
- **Adjacency:** A linking preposition is not treated as an adjective between a visual noun and a code word. This keeps `chart of the test results` on the report route and is reversible.
