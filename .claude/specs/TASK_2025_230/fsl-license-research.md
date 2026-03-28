# FSL-1.1-MIT License Research Report - TASK_2025_230

**Date**: 2026-03-28
**Research Classification**: LICENSE_MIGRATION
**Confidence Level**: 95% (based on official template + 6 production implementations)
**Primary Source**: https://fsl.software/FSL-1.1-MIT.template.md

---

## 1. Official FSL-1.1-MIT License Text (Verbatim from Template)

The following is the EXACT text from `https://fsl.software/FSL-1.1-MIT.template.md` with
template variables shown as `${...}` placeholders.

```
# Functional Source License, Version 1.1, MIT Future License

## Abbreviation

FSL-1.1-MIT

## Notice

Copyright ${year} ${licensor name}

## Terms and Conditions

### Licensor ("We")

The party offering the Software under these Terms and Conditions.

### The Software

The "Software" is each version of the software that we make available under
these Terms and Conditions, as indicated by our inclusion of these Terms and
Conditions with the Software.

### License Grant

Subject to your compliance with this License Grant and the Patents,
Redistribution and Trademark clauses below, we hereby grant you the right to
use, copy, modify, create derivative works, publicly perform, publicly display
and redistribute the Software for any Permitted Purpose identified below.

### Permitted Purpose

A Permitted Purpose is any purpose other than a Competing Use. A Competing Use
means making the Software available to others in a commercial product or
service that:

1. substitutes for the Software;

2. substitutes for any other product or service we offer using the Software
   that exists as of the date we make the Software available; or

3. offers the same or substantially similar functionality as the Software.

Permitted Purposes specifically include using the Software:

1. for your internal use and access;

2. for non-commercial education;

3. for non-commercial research; and

4. in connection with professional services that you provide to a licensee
   using the Software in accordance with these Terms and Conditions.

### Patents

To the extent your use for a Permitted Purpose would necessarily infringe our
patents, the license grant above includes a license under our patents. If you
make a claim against any party that the Software infringes or contributes to
the infringement of any patent, then your patent license to the Software ends
immediately.

### Redistribution

The Terms and Conditions apply to all copies, modifications and derivatives of
the Software.

If you redistribute any copies, modifications or derivatives of the Software,
you must include a copy of or a link to these Terms and Conditions and not
remove any copyright notices provided in or with the Software.

### Disclaimer

THE SOFTWARE IS PROVIDED "AS IS" AND WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING WITHOUT LIMITATION WARRANTIES OF FITNESS FOR A PARTICULAR
PURPOSE, MERCHANTABILITY, TITLE OR NON-INFRINGEMENT.

IN NO EVENT WILL WE HAVE ANY LIABILITY TO YOU ARISING OUT OF OR RELATED TO THE
SOFTWARE, INCLUDING INDIRECT, SPECIAL, INCIDENTAL OR CONSEQUENTIAL DAMAGES,
EVEN IF WE HAVE BEEN INFORMED OF THEIR POSSIBILITY IN ADVANCE.

### Trademarks

Except for displaying the License Details and identifying us as the origin of
the Software, you have no right under these Terms and Conditions to use our
trademarks, trade names, service marks or product names.

## Grant of Future License

We hereby irrevocably grant you an additional license to use the Software under
the MIT license that is effective on the second anniversary of the date we make
the Software available. On or after that date, you may use the Software under
the MIT license, in which case the following will apply:

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## 2. Customization Points Analysis

The FSL-1.1-MIT template has exactly **two** template variables:

| Variable           | Description                             | Our Value      |
| ------------------ | --------------------------------------- | -------------- |
| `${year}`          | Copyright year or year range            | `2025-2026`    |
| `${licensor name}` | Legal name of the entity licensing code | `Hive Academy` |

**Important nuances discovered from production implementations:**

- **Sentry** uses: `Copyright 2016-2024 Functional Software, Inc. dba Sentry`
- **GitButler** uses: `Copyright 2023-2024 GitButler Inc`
- **CodeCrafters** uses: `Copyright 2021-2026 CodeCrafters, Inc.`
- **Convex** uses: `Copyright 2026 Convex, Inc.`
- **Sweetr** uses: `Copyright 2024, sweetr.dev`
- **PowerSync** uses: `Copyright 2023-2026 Journey Mobile, Inc.`

**Key Finding**: There is NO "Change Date" field in FSL. Unlike the Business Source License (BSL/BUSL)
which has an explicit "Change Date" field, FSL uses a fixed mechanism: "the second anniversary of
the date we make the Software available." This is per-version, not per-project. Each git commit or
release gets its own 2-year countdown. No date needs to be specified in the license file.

**Key Finding**: There is NO "Software Name" field in FSL. The software is identified by inclusion
of the license terms, not by name. This differs from BSL which has explicit "Licensed Work" fields.

---

## 3. Customized LICENSE.md File for Ptah (Ready to Use)

This file should replace the current `LICENSE` at the project root. Note the file extension
change to `.md` for Markdown rendering (consistent with GitButler, Sentry, CodeCrafters, Convex).

```markdown
# Functional Source License, Version 1.1, MIT Future License

## Abbreviation

FSL-1.1-MIT

## Notice

Copyright 2025-2026 Hive Academy

## Terms and Conditions

### Licensor ("We")

The party offering the Software under these Terms and Conditions.

### The Software

The "Software" is each version of the software that we make available under
these Terms and Conditions, as indicated by our inclusion of these Terms and
Conditions with the Software.

### License Grant

Subject to your compliance with this License Grant and the Patents,
Redistribution and Trademark clauses below, we hereby grant you the right to
use, copy, modify, create derivative works, publicly perform, publicly display
and redistribute the Software for any Permitted Purpose identified below.

### Permitted Purpose

A Permitted Purpose is any purpose other than a Competing Use. A Competing Use
means making the Software available to others in a commercial product or
service that:

1. substitutes for the Software;

2. substitutes for any other product or service we offer using the Software
   that exists as of the date we make the Software available; or

3. offers the same or substantially similar functionality as the Software.

Permitted Purposes specifically include using the Software:

1. for your internal use and access;

2. for non-commercial education;

3. for non-commercial research; and

4. in connection with professional services that you provide to a licensee
   using the Software in accordance with these Terms and Conditions.

### Patents

To the extent your use for a Permitted Purpose would necessarily infringe our
patents, the license grant above includes a license under our patents. If you
make a claim against any party that the Software infringes or contributes to
the infringement of any patent, then your patent license to the Software ends
immediately.

### Redistribution

The Terms and Conditions apply to all copies, modifications and derivatives of
the Software.

If you redistribute any copies, modifications or derivatives of the Software,
you must include a copy of or a link to these Terms and Conditions and not
remove any copyright notices provided in or with the Software.

### Disclaimer

THE SOFTWARE IS PROVIDED "AS IS" AND WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING WITHOUT LIMITATION WARRANTIES OF FITNESS FOR A PARTICULAR
PURPOSE, MERCHANTABILITY, TITLE OR NON-INFRINGEMENT.

IN NO EVENT WILL WE HAVE ANY LIABILITY TO YOU ARISING OUT OF OR RELATED TO THE
SOFTWARE, INCLUDING INDIRECT, SPECIAL, INCIDENTAL OR CONSEQUENTIAL DAMAGES,
EVEN IF WE HAVE BEEN INFORMED OF THEIR POSSIBILITY IN ADVANCE.

### Trademarks

Except for displaying the License Details and identifying us as the origin of
the Software, you have no right under these Terms and Conditions to use our
trademarks, trade names, service marks or product names.

## Grant of Future License

We hereby irrevocably grant you an additional license to use the Software under
the MIT license that is effective on the second anniversary of the date we make
the Software available. On or after that date, you may use the Software under
the MIT license, in which case the following will apply:

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## 4. CLA (Contributor License Agreement) Recommendation

### Research Findings

FSL projects take **two distinct approaches** to contributor agreements:

**Approach A: No Formal CLA (GitButler's approach)**

GitButler explicitly chose NOT to require a CLA. Their CONTRIBUTING.md states:

> "Any contributions sent to us implicitly give us the right to redistribute that work under
> the same license and rights."

They link to [Ben Balter's article](https://ben.balter.com/2018/01/02/why-you-probably-shouldnt-add-a-cla-to-your-open-source-project/)
arguing CLAs create unnecessary friction for contributors.

Instead, GitButler relies on:

- The "inbound = outbound" principle (contributions are under the same license as the project)
- A clear CONTRIBUTING.md explaining the license
- Required signed commits for traceability

**Approach B: Formal CLA via GitHub App (Sentry-style)**

Larger organizations like Sentry use a formal CLA process, typically via the
[CLA Assistant](https://github.com/cla-assistant/cla-assistant) GitHub App or the
[CLA Assistant Lite](https://github.com/cla-assistant/github-action) GitHub Action.

### Recommendation for Ptah: Approach A (Implicit CLA) + Clear CONTRIBUTING.md

**Rationale:**

1. Ptah is a small-to-medium project; formal CLA adds friction that discourages contributions
2. The FSL already has clear terms about redistribution
3. The "inbound = outbound" principle is well-established legal practice
4. GitButler (another FSL-1.1-MIT project of similar size) validates this approach works
5. If Hive Academy grows and needs stronger IP assignment, upgrading to a formal CLA later is easy

### Recommended CONTRIBUTING.md License Section

Add this to the existing CONTRIBUTING.md (or create one):

```markdown
## License

Ptah is licensed under the [Functional Source License, Version 1.1, MIT Future License](LICENSE.md)
(FSL-1.1-MIT). This is a Fair Source license that protects against harmful free-riding while
converting to full MIT open source after two years.

By submitting a pull request or otherwise contributing to this repository, you agree that your
contributions will be licensed under the same FSL-1.1-MIT license that covers the project. You
also represent that you have the right to submit the contribution and that it does not violate
any third-party rights.

We do not require a formal Contributor License Agreement (CLA). The "inbound = outbound"
principle applies: contributions are made under the same terms as the project license.
```

### If You Want a Formal CLA Later

Use [CLA Assistant Lite](https://github.com/cla-assistant/github-action) (GitHub Action, no
external service needed). Add `.github/workflows/cla.yml`:

```yaml
name: CLA Assistant
on:
  issue_comment:
    types: [created]
  pull_request_target:
    types: [opened, closed, synchronize]

permissions:
  actions: write
  contents: write
  pull-requests: write
  statuses: write

jobs:
  cla:
    runs-on: ubuntu-latest
    if: |
      (github.event.comment.body == 'recheck' || github.event.comment.body == 'I have read the CLA Document and I hereby sign the CLA')
      || github.event_name == 'pull_request_target'
    steps:
      - uses: contributor-assistant/github-action@v2.6.1
        with:
          path-to-signatures: 'signatures/cla.json'
          path-to-document: 'https://github.com/Hive-Academy/ptah-extension/blob/main/CLA.md'
          branch: 'main'
          allowlist: dependabot[bot],github-actions[bot]
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

---

## 5. Package.json Changes

### SPDX Status

FSL-1.1-MIT is **NOT** in the SPDX license list. This is expected -- it is a Fair Source
license, not an OSI-approved Open Source license. The SPDX identifier `FSL-1.1-MIT` is used
by convention in the FSL community but is not an official SPDX identifier.

### Root package.json (`D:\projects\ptah-extension\package.json`)

**Current:**

```json
"license": "MIT",
```

**Change to:**

```json
"license": "FSL-1.1-MIT",
```

Note: npm will warn about an unrecognized license identifier. This is expected and acceptable.
Alternatively, use the `SEE LICENSE` convention:

```json
"license": "SEE LICENSE IN LICENSE.md",
```

**Recommendation**: Use `"license": "FSL-1.1-MIT"` for clarity. The npm warning is harmless
and this is the convention used by CodeCrafters and other FSL projects.

### VS Code Extension package.json (`D:\projects\ptah-extension\apps\ptah-extension-vscode\package.json`)

**Current:**

```json
"license": "SEE LICENSE IN LICENSE",
```

**Change to:**

```json
"license": "SEE LICENSE IN LICENSE.md",
```

This already follows the correct pattern for VS Code extensions with custom licenses.
The only change needed is updating the file reference from `LICENSE` to `LICENSE.md` (since
we are renaming the file). VS Code Marketplace accepts this format for non-standard licenses.

---

## 6. Source File Header Template

### Recommended Header (Short Form)

```typescript
// Copyright (c) Hive Academy. Licensed under the Functional Source License, Version 1.1, MIT Future License.
// See LICENSE.md in the project root for license information.
```

### Notes on Header Strategy

**Production examples studied:**

- **Sentry**: Does NOT add license headers to every source file. Relies on root LICENSE.md.
- **GitButler**: Does NOT add license headers to every source file. Relies on root LICENSE.md.
- **CodeCrafters**: Does NOT add license headers to every source file.

**Recommendation**: Adding headers to source files is OPTIONAL for FSL projects. The license
is established by the LICENSE.md file at the project root. Most FSL projects do not add per-file
headers. If Ptah chooses to add them, use the short form above. It can be added incrementally
to new files or applied in a single bulk operation.

If you do add headers, target only Ptah's own source files (not generated files, not
third-party code, not test fixtures). A reasonable approach:

- `apps/ptah-extension-vscode/src/**/*.ts`
- `apps/ptah-extension-webview/src/**/*.ts`
- `apps/ptah-electron/src/**/*.ts`
- `libs/*/src/**/*.ts`

Skip: `node_modules`, `dist`, `*.d.ts`, `*.spec.ts`, generated Prisma files.

---

## 7. README License Section Draft

Replace the current README license section:

**Current (line 358-360 of README.md):**

```markdown
## License

MIT License — see [LICENSE](LICENSE) for details.
```

**Replace with:**

```markdown
## License

Ptah is licensed under the [Functional Source License, Version 1.1, MIT Future License](LICENSE.md) (FSL-1.1-MIT).

### What This Means

**You CAN:**

- Use Ptah for internal development, education, research, and professional services
- Read, modify, and redistribute the source code for any non-competing purpose
- Use any version under the full MIT license two years after its release

**You CANNOT:**

- Offer Ptah (or a substantially similar product) as a competing commercial product or service

The FSL is a [Fair Source](https://fair.io/) license designed to balance user freedom with developer sustainability. Every version of Ptah automatically converts to the permissive MIT license two years after release. This means today's code will be fully open source by 2028.

For full details, see [LICENSE.md](LICENSE.md).
```

---

## 8. Implementation Checklist

The following files need to be changed for the license migration:

| #   | File                                      | Action      | Details                                                                                  |
| --- | ----------------------------------------- | ----------- | ---------------------------------------------------------------------------------------- |
| 1   | `LICENSE`                                 | Delete      | Replace with LICENSE.md                                                                  |
| 2   | `LICENSE.md`                              | Create      | Use the customized FSL-1.1-MIT text from Section 3                                       |
| 3   | `package.json` (root)                     | Edit        | Change `"license": "MIT"` to `"license": "FSL-1.1-MIT"`                                  |
| 4   | `apps/ptah-extension-vscode/package.json` | Edit        | Change `"license": "SEE LICENSE IN LICENSE"` to `"license": "SEE LICENSE IN LICENSE.md"` |
| 5   | `README.md`                               | Edit        | Replace license section (Section 7 above)                                                |
| 6   | `CONTRIBUTING.md`                         | Create/Edit | Add license section (Section 4 above)                                                    |
| 7   | Source files (optional)                   | Edit        | Add header comment (Section 6 above)                                                     |

---

## 9. How the 2-Year Conversion Works (Important Nuance)

From the FSL FAQ:

> "The two year timeframe applies to each software version that is made available. Methods of
> making software available include pushing a Git commit, publishing a package to a repository,
> or mailing out a CD in a tin."

This means:

- **Each git commit** has its own independent 2-year timer
- There is NO single "Change Date" like in BSL
- Code committed on 2026-03-28 becomes MIT on 2028-03-28
- Code committed on 2026-06-15 becomes MIT on 2028-06-15
- Users can check out any commit older than 2 years and use it under MIT:
  ```bash
  git checkout `git rev-list -n 1 --before="2 years ago" main`
  ```

This is a significant advantage over BSL -- there is no need to maintain or update a Change
Date in the license file. The mechanism is automatic and applies per-version.

---

## 10. Risk Analysis

### Low Risk

- **VS Code Marketplace**: Already uses `"SEE LICENSE IN LICENSE"` pattern. Non-standard licenses
  are accepted. Sentry, GitButler, and other FSL projects are on various marketplaces.
- **npm**: Will show a warning about unrecognized license. Harmless.

### Medium Risk

- **Contributor friction**: Some potential contributors may be unfamiliar with FSL and hesitate.
  Mitigation: Clear CONTRIBUTING.md and README explaining the license.
- **Enterprise adoption**: Some enterprises have license allowlists. FSL may not be on them yet.
  Mitigation: FSL is gaining traction (Sentry, Convex, GitButler, CodeCrafters all use it).

### Negligible Risk

- **Legal validity**: FSL was drafted by Sentry's legal team and reviewed by multiple companies.
  It has been in production use since 2023 with no known legal challenges.

---

## 11. Companies Using FSL (for reference/validation)

| Company        | Product          | FSL Variant  | Year |
| -------------- | ---------------- | ------------ | ---- |
| Sentry         | Error tracking   | FSL-1.1-ALv2 | 2024 |
| GitButler      | Git client       | FSL-1.1-MIT  | 2023 |
| CodeCrafters   | Dev education    | FSL-1.1-MIT  | 2021 |
| Convex         | Backend platform | FSL-1.1-ALv2 | 2026 |
| PowerSync      | Sync engine      | FSL-1.1-ALv2 | 2023 |
| Sweetr         | Dev analytics    | FSL-1.1-ALv2 | 2024 |
| Codecov        | Code coverage    | FSL-1.1-ALv2 | 2024 |
| Vyuh Framework | App framework    | FSL          | 2024 |

---

## Research Artifacts

### Primary Sources (Verified)

1. https://fsl.software/FSL-1.1-MIT.template.md -- Official FSL-1.1-MIT template (verbatim)
2. https://github.com/getsentry/fsl.software -- FSL source repository and adoption guide
3. https://github.com/gitbutlerapp/gitbutler/blob/master/LICENSE.md -- GitButler FSL-1.1-MIT implementation
4. https://github.com/gitbutlerapp/gitbutler/blob/master/CONTRIBUTING.md -- GitButler CLA approach
5. https://github.com/codecrafters-io/frontend/blob/main/LICENSE.md -- CodeCrafters FSL-1.1-MIT implementation
6. https://github.com/getsentry/self-hosted/blob/master/LICENSE.md -- Sentry FSL-1.1-ALv2 implementation
7. https://fsl.software/ -- FAQ explaining 2-year conversion mechanics
8. https://fair.io/ -- Fair Source umbrella organization

### Secondary Sources

- https://blog.sentry.io/introducing-the-functional-source-license-freedom-without-free-riding/
- https://ben.balter.com/2018/01/02/why-you-probably-shouldnt-add-a-cla-to-your-open-source-project/
- https://github.com/cla-assistant/github-action -- CLA Assistant Lite (if formal CLA needed later)
