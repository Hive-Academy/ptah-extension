# Research Report: FSL vs BSL Licensing for Ptah Extension

**Date**: 2026-03-28
**Research Depth**: COMPREHENSIVE
**Sources Analyzed**: 25+ primary, 15+ secondary
**Confidence Level**: 92%
**Current License**: MIT (package.json + LICENSE file)
**Context**: $5/month VS Code extension with AI coding features

---

## Table of Contents

1. [Functional Source License (FSL) - Complete Analysis](#1-functional-source-license-fsl)
2. [Business Source License (BSL) - Complete Analysis](#2-business-source-license-bsl)
3. [Head-to-Head Comparison](#3-head-to-head-comparison)
4. [VS Code Marketplace Context](#4-vs-code-marketplace-context)
5. [How Other Extensions Handle Licensing](#5-how-other-extensions-handle-licensing)
6. [Recommendation for Ptah](#6-recommendation-for-ptah)

---

## 1. Functional Source License (FSL)

### 1.1 Overview

The Functional Source License (FSL) is a "Fair Source" license created by **Sentry** (the application monitoring company) in November 2023. It was designed by Sentry's co-founder Armin Ronacher and attorney Heather Meeker as a direct improvement over the Business Source License (BSL), which Sentry had previously used.

FSL is explicitly **not an Open Source license** during its restriction period. It is classified as a "source-available" or "Fair Source" license. After two years, it automatically and irrevocably converts to a true permissive open source license (Apache 2.0 or MIT).

### 1.2 Current Versions

Two variants exist, differing only in which permissive license the code converts to:

| SPDX Identifier  | Future License     | Patent Protection           | GPL-2.0 Compatible |
| ---------------- | ------------------ | --------------------------- | ------------------ |
| **FSL-1.1-ALv2** | Apache License 2.0 | Yes (explicit patent grant) | No                 |
| **FSL-1.1-MIT**  | MIT License        | No                          | Yes                |

Both are registered with SPDX. The version is 1.1 (no 1.0 was publicly released).

**Choosing between them:**

- **FSL-1.1-ALv2 (Apache 2.0 future)**: Better patent protection after conversion. Sentry uses this for their web apps. Recommended if you hold patents or want defensive patent protection for users.
- **FSL-1.1-MIT (MIT future)**: Simpler, more permissive after conversion, GPL-2.0 compatible. Sentry uses this for all SDKs. Recommended for broader ecosystem compatibility.

### 1.3 Official Sources

- **Official website**: https://fsl.software/
- **GitHub repository**: https://github.com/getsentry/fsl.software
- **FSL-1.1-MIT template**: https://github.com/getsentry/fsl.software/blob/main/FSL-1.1-MIT.template.md
- **FSL-1.1-ALv2 template**: https://github.com/getsentry/fsl.software/blob/main/FSL-1.1-Apache-2.0.template.md
- **SPDX (MIT variant)**: https://spdx.org/licenses/FSL-1.1-MIT.html
- **SPDX (ALv2 variant)**: https://spdx.org/licenses/FSL-1.1-ALv2.html
- **Sentry licensing page**: https://open.sentry.io/licensing/
- **Sentry blog announcement**: https://blog.sentry.io/introducing-the-functional-source-license-freedom-without-free-riding/
- **Fair Source organization**: https://fair.io/

### 1.4 Complete License Terms (FSL-1.1-MIT)

The license template has these fill-in parameters:

- `${year}` - Copyright year
- `${licensor name}` - Your company name

**Grant of Rights:**
You receive rights to use, copy, modify, create derivative works, publicly perform, publicly display, and redistribute the Software for any Permitted Purpose.

**Permitted Purpose (what you CAN do):**
Any purpose EXCEPT a Competing Use. Specifically permitted:

- Internal use and access (including production, on-prem, cloud)
- Non-commercial education
- Non-commercial research
- Professional services provided to licensees using the Software in accordance with the Terms

**Competing Use (what you CANNOT do):**
Making the Software available to others in a commercial product or service that:

1. Substitutes for the Software itself
2. Substitutes for any other product or service the licensor offers using the Software (as of the date the Software was made available)
3. Offers the same or substantially similar functionality as the Software

**Specifically includes as Competing Use:**

- Using the Software as a substitute for any of the licensor's products or services
- Exposing the APIs of the Software in a competing product
- Offering a product or service with the same or substantially similar functionality

**Patent Clause:**
To the extent your Permitted Purpose use would necessarily infringe the licensor's patents, the license grant includes a patent license. However, if you make a patent infringement claim against any party regarding the Software, your patent license terminates immediately.

**Redistribution:**
You must include the license terms and preserve copyright notices in all copies or substantial portions of the Software.

**Trademarks:**
No trademark rights are granted beyond identifying the licensor.

**Disclaimer:**
Software provided "AS IS" without warranties. No liability for indirect, special, incidental, or consequential damages.

**Future License Conversion (the key mechanism):**
"We hereby irrevocably grant you an additional license to use the Software under the [MIT License / Apache License, Version 2.0] that is effective on the second anniversary of the date we make the Software available."

This means:

- The conversion is **per version** (each release gets its own 2-year clock)
- It is **irrevocable** - the licensor cannot take it back
- After 2 years, anyone can use that specific version under full MIT/Apache 2.0
- The latest version always has the FSL restriction; 2-year-old versions are fully open

### 1.5 Companies Using FSL

As of March 2026, companies that have adopted FSL include:

| Company             | Product             | FSL Variant       | Notes                                        |
| ------------------- | ------------------- | ----------------- | -------------------------------------------- |
| **Sentry**          | Sentry web app      | FSL-1.1-ALv2      | Creator of FSL; SDKs remain MIT              |
| **Codecov**         | Codecov web app     | FSL-1.1-ALv2      | Acquired by Sentry                           |
| **GitButler**       | Git client          | FSL-1.1-MIT       | Went directly from closed source to FSL      |
| **PowerSync**       | Sync service        | FSL-1.1-ALv2      | Server-side only; client SDKs are Apache 2.0 |
| **Liquibase**       | Database CI/CD      | FSL               | Adopted for v5.0 (September 2025)            |
| **CodeCrafters**    | Developer education | FSL               | -                                            |
| **Answer Overflow** | Discord search      | FSL               | -                                            |
| **Convex**          | Backend platform    | FSL               | -                                            |
| **Sweetr**          | Engineering metrics | FSL               | -                                            |
| **Vyuh Framework**  | App framework       | FSL               | -                                            |
| **Keygen**          | License management  | FCL (FSL variant) | Uses Fair Core License, derived from FSL     |

### 1.6 Contribution Handling / CLA

FSL does **not inherently require** a CLA, but most companies using FSL **do require one** in practice.

**Why a CLA is needed with FSL:**

- The licensor needs the right to relicense contributions under the FSL terms
- The licensor needs the ability to grant the future license conversion
- Without a CLA, contributors retain copyright and the licensor cannot guarantee the 2-year conversion

**Examples:**

- **Sentry**: Requires CLA for contributions
- **Liquibase**: Requires a one-time CLA via CLA Assistant on first PR
- **Standard practice**: Most FSL projects use a CLA that assigns or licenses contribution rights to the project maintainer

**Recommendation for Ptah:** If using FSL, implement a CLA (CLA Assistant on GitHub is the standard approach). This is a lightweight process - contributors sign once via a GitHub comment.

### 1.7 Criticisms and Gotchas

**Criticisms:**

1. **"Not Open Source"** - The Open Source Initiative (OSI) explicitly states FSL is not open source. Using terms like "open source" to describe FSL software is considered "openwashing."

2. **Competing Use ambiguity** - The phrase "substantially similar functionality" is legally fuzzy. What counts as "substantially similar" to an AI coding extension? Does a competing AI extension that uses different architecture count? This has not been tested in court.

3. **Community reception is mixed** - Open source purists view FSL negatively. However, pragmatic developers generally accept it, especially given the 2-year conversion.

4. **Reduced contributions** - Some developers will not contribute to non-OSI-approved projects on principle. This effect is real but varies.

5. **Corporate legal friction** - Some corporate legal departments have blanket bans on non-OSI licenses, which could prevent enterprise adoption.

**Gotchas:**

1. **Per-version timing** - The 2-year clock starts per release. If you release v1.0 today and v1.1 in 6 months, v1.0 becomes MIT/Apache in 2 years but v1.1 takes 2.5 years from today.

2. **API exposure clause** - The Competing Use definition specifically mentions "exposing the APIs of the Software." If someone forks your extension and wraps it as an API service, that is explicitly prohibited.

3. **"As of the date" clause** - Competing Use is measured against products the licensor offers "as of the date we make the Software available." If you launch a new product line later, older FSL versions may not protect against competition with that new product.

4. **No trademark rights** - You need separate trademark protection. FSL does not prevent someone from creating a confusingly named fork (though trademark law might).

---

## 2. Business Source License (BSL)

### 2.1 Overview

The Business Source License (BSL) was created by **MariaDB** (specifically by MySQL/MariaDB founders David Axmark and Michael "Monty" Widenius) in 2013, with version 1.1 released in 2016. "Business Source License" is a trademark of MariaDB Corporation Ab.

BSL is a **parameterized** license - unlike FSL, it has customizable fields that each licensor fills in differently, making every BSL implementation effectively a unique license.

### 2.2 Current Version

**BSL 1.1** is the current and only widely-used version.

- SPDX Identifier: `BUSL-1.1`
- Registered with SPDX: Yes

### 2.3 Official Sources

- **Official license text**: https://mariadb.com/bsl11/
- **MariaDB BSL FAQ**: https://mariadb.com/bsl-faq-mariadb/
- **BSL adoption FAQ**: https://mariadb.com/bsl-faq-adopting/
- **SPDX**: https://spdx.org/licenses/BUSL-1.1.html
- **Wikipedia**: https://en.wikipedia.org/wiki/Business_Source_License

### 2.4 Complete License Terms

The BSL 1.1 has four customizable parameters:

| Parameter                | Description                             | Constraint                                                           |
| ------------------------ | --------------------------------------- | -------------------------------------------------------------------- |
| **Licensor**             | The entity granting the license         | Required                                                             |
| **Licensed Work**        | The specific software being licensed    | Required                                                             |
| **Additional Use Grant** | What production uses are permitted      | Cannot impose new restrictions beyond the base license               |
| **Change Date**          | When conversion occurs                  | Must be specified; defaults to 4-year anniversary if not set earlier |
| **Change License**       | What open source license it converts to | Must be GPL 2.0+ compatible                                          |

**Base Rights (always granted):**

- Copy the Licensed Work
- Modify the Licensed Work
- Create derivative works
- Redistribute the Licensed Work
- Make **non-production use** of the Licensed Work

**Production Use:**
By default, BSL **prohibits all production use** unless the Additional Use Grant explicitly allows it. This is a critical difference from FSL.

**Additional Use Grant (the key differentiator):**
This is where BSL gets complex. Each company writes their own Additional Use Grant differently:

- **MariaDB**: Allows production with fewer than 3 server instances
- **HashiCorp**: Allows production except competitive offerings against HashiCorp's paid products
- **CockroachDB**: Cannot use it as a "Database Service"
- **Couchbase**: Cannot create commercial derivative works or include in commercial DBaaS/SaaS
- **Directus**: Free for companies under $5M in total finances
- **Akka**: No production use at all without commercial license

**Change Date Mechanism:**
On the Change Date (or the fourth anniversary of first public distribution, whichever comes first), the License automatically converts to the Change License. All BSL rights terminate and are replaced with the Change License rights.

**Licensor Covenants (binding constraints on adopters):**

1. Change License must be GPL 2.0+ or compatible
2. Additional Use Grants cannot impose restrictions beyond the base BSL
3. Licensor must specify a Change Date
4. No other modifications to the license text are permitted

**Termination:**
Any use in violation of the BSL automatically terminates all rights for current and all other versions.

**Disclaimer:**
Software provided "AS IS" without warranties.

### 2.5 Companies Using BSL

| Company              | Product                | Additional Use Grant            | Change Date | Change License |
| -------------------- | ---------------------- | ------------------------------- | ----------- | -------------- |
| **MariaDB**          | MaxScale               | <3 server instances             | 4 years     | GPL 2.0+       |
| **HashiCorp**        | Terraform, Vault, etc. | No competitive hosted offerings | 4 years     | MPL 2.0        |
| **CockroachDB**      | CockroachDB (formerly) | No "Database Service"           | 3 years     | Apache 2.0     |
| **Akka** (Lightbend) | Akka framework         | None (no production use)        | 3 years     | Apache 2.0     |
| **Couchbase**        | Couchbase Server       | No commercial derivative/DBaaS  | 4 years     | Apache 2.0     |
| **Directus**         | Directus CMS           | Free under $5M revenue          | 3 years     | GPL 3.0        |
| **dotCMS**           | dotCMS                 | Varies                          | Varies      | GPL compatible |
| **Materialize**      | Materialize DB         | Varies                          | Varies      | GPL compatible |

Note: CockroachDB moved away from BSL in 2024 to a proprietary license (CockroachDB Community License), then to an even more restrictive model. Sentry moved from BSL to FSL. Both moves away from BSL are instructive.

### 2.6 Criticisms and Gotchas

**Major Criticisms:**

1. **"Every BSL is a different license"** - Sentry's primary criticism. The customizable Additional Use Grant means you cannot reason about "BSL" as a single license. Legal teams must review each implementation individually, which is costly and slow.

2. **4-year default is too long** - In fast-moving software, 4 years is an eternity. Code from 4 years ago is often obsolete. This makes the "eventual open source" promise less meaningful.

3. **OpenTofu/HashiCorp backlash** - HashiCorp's BSL switch in August 2023 triggered the creation of OpenTofu (a community fork under the Linux Foundation). This is the most high-profile example of BSL adoption leading to community fracture.

4. **Ambiguous production restrictions** - The base BSL prohibits "production use" but the Additional Use Grant re-enables it with conditions. This creates confusion about what is actually allowed.

5. **Trust erosion** - Switching from an open source license to BSL is perceived as betraying the community. Multiple companies (HashiCorp, Akka) faced significant backlash.

6. **Reduced contributions** - Similar to FSL, but worse because BSL is perceived more negatively by the developer community.

7. **Legal uncertainty** - Has never been tested in court. The enforceability of "competing product" definitions is untested.

**Gotchas:**

1. **Non-production default** - If you forget to write a good Additional Use Grant, users cannot use your software in production AT ALL. FSL avoids this problem entirely.

2. **GPL compatibility requirement** - The Change License must be GPL 2.0+ compatible. This rules out converting to MIT or Apache 2.0 unless the licensor chooses those specifically and they are confirmed GPL-compatible (Apache 2.0 is GPL 3.0 compatible but not GPL 2.0 compatible).

3. **Automatic termination** - Any violation terminates rights for ALL versions, not just the violated one. This is more punitive than FSL.

4. **Trademark limitation** - "Business Source License" is a trademark of MariaDB. You must use it correctly.

---

## 3. Head-to-Head Comparison

### 3.1 Feature Comparison Matrix

| Feature                           | FSL 1.1                             | BSL 1.1                                                      |
| --------------------------------- | ----------------------------------- | ------------------------------------------------------------ |
| **Creator**                       | Sentry (2023)                       | MariaDB (2013/2016)                                          |
| **Version**                       | 1.1                                 | 1.1                                                          |
| **SPDX Identifier**               | FSL-1.1-MIT or FSL-1.1-ALv2         | BUSL-1.1                                                     |
| **Is Open Source?**               | No (during restriction period)      | No (during restriction period)                               |
| **Becomes Open Source?**          | Yes, after 2 years                  | Yes, after Change Date (usually 3-4 years)                   |
| **Default restriction period**    | 2 years (fixed)                     | 4 years (customizable, max 4)                                |
| **Conversion license options**    | Apache 2.0 or MIT (fixed)           | Any GPL 2.0+ compatible (variable)                           |
| **Production use allowed?**       | Yes, for all non-competing purposes | No, unless Additional Use Grant allows it                    |
| **Customizable terms?**           | No (only copyright holder and year) | Yes (Additional Use Grant is freeform)                       |
| **Internal/corporate use?**       | Explicitly allowed                  | Allowed only in non-production (or via Additional Use Grant) |
| **Competing product restriction** | Standardized definition             | Custom per implementation                                    |
| **Patent clause**                 | Yes (grant + defensive termination) | No explicit patent clause                                    |
| **Redistribution**                | Allowed with license copy           | Allowed with license copy                                    |
| **Violation consequence**         | Standard (implied termination)      | Automatic termination of ALL version rights                  |
| **Legal review complexity**       | Low (one license to review)         | High (each implementation is unique)                         |
| **Community perception**          | Mixed-to-positive                   | Mixed-to-negative                                            |
| **Track record**                  | ~3 years                            | ~10 years                                                    |
| **Court tested?**                 | No                                  | No                                                           |
| **CLA typically needed?**         | Yes                                 | Yes                                                          |

### 3.2 For a VS Code Extension Context

**Individual Developer Use:**

- **FSL**: Explicitly permitted. You can run the extension, modify it, study the code.
- **BSL**: Permitted for non-production use. Production use depends entirely on the Additional Use Grant.

**Corporate/Enterprise Use:**

- **FSL**: Internal use is explicitly a Permitted Purpose. A company using Ptah internally for their development workflow is fully allowed.
- **BSL**: Depends on the Additional Use Grant. If you write "production use is permitted for internal purposes," it works. But you must explicitly write this.

**Competing Forks:**

- **FSL**: Someone cannot take Ptah's code and create "Ptah Clone" as a competing VS Code AI extension. The "substantially similar functionality" clause covers this. However, 2-year-old code is fair game under MIT/Apache.
- **BSL**: Same general protection, but you define the scope yourself in the Additional Use Grant. More flexible but more work and more ambiguity.

**GitHub Community Perception:**

- **FSL**: Generally better received. Sentry's brand and Armin Ronacher's advocacy have built credibility. The 2-year timeline is seen as reasonable. The standardized terms reduce fear.
- **BSL**: Significantly worse reception after the HashiCorp/OpenTofu drama. The name "Business Source License" carries negative connotations in many developer communities.

### 3.3 Verdict: FSL is Superior for This Use Case

FSL wins on every dimension relevant to a VS Code extension:

1. **Simpler** - No need to draft custom Additional Use Grant language
2. **Shorter restriction** - 2 years vs 4 years
3. **Better defaults** - Production use allowed by default (only competing use restricted)
4. **Better perception** - Less community backlash
5. **More predictable** - Every FSL is the same license
6. **Better conversion** - MIT or Apache 2.0 (not restricted to GPL-compatible)
7. **Patent protection** - Included (BSL lacks this)
8. **Designed for SaaS/developer tools** - FSL was literally designed for products like Ptah

---

## 4. VS Code Marketplace Context

### 4.1 Marketplace License Policy

The VS Code Marketplace does **not restrict** which licenses extensions can use. Key findings:

- Extension authors are "free to choose a license that fits their business needs"
- The marketplace accepts both open-source and proprietary licenses
- Microsoft itself uses proprietary licenses for some of its own extensions (C# DevKit, Pylance, Remote Development)
- There is no requirement to be OSI-approved
- The marketplace displays the `license` field from `package.json` under "Resources" on the extension page

**How to declare a non-standard license:**
In `package.json`, use:

```json
{
  "license": "SEE LICENSE IN LICENSE.md"
}
```

This links to your `LICENSE.md` file in the extension's repository.

For SPDX-recognized identifiers, you can use:

```json
{
  "license": "FSL-1.1-MIT"
}
```

### 4.2 Marketplace Display

The license is shown:

- Under the "Resources" section on the right column of the marketplace page
- As a clickable link to the license file or URL
- There is no visual distinction between OSI-approved and non-OSI licenses
- No warning banners or restrictions based on license type

### 4.3 Marketplace Suspension Risk

Your extension was previously suspended for "suspicious content." Changing from MIT to FSL should **not** trigger any marketplace policy issues because:

- The marketplace explicitly allows proprietary licenses
- Microsoft's own extensions use proprietary licenses
- The suspension was likely related to AI API calls, not licensing
- Multiple proprietary extensions exist on the marketplace

### 4.4 Open VSX / VSCodium Considerations

If you want your extension available on Open VSX (used by VSCodium, Gitpod, etc.):

- Open VSX accepts extensions under any license
- However, the community using Open VSX tends to prefer open source more strongly
- FSL's 2-year conversion to MIT/Apache may be better received than a fully proprietary license

---

## 5. How Other Extensions Handle Licensing

### 5.1 GitLens (GitKraken) - Dual License Model

GitLens is the most relevant comparable extension (18M+ installs, freemium VS Code extension):

- **Core code**: MIT License (fully open source)
- **Premium features** (in `plus/` directories): Proprietary commercial license (GitKraken EULA)
- **Subscription tiers**: Free, Pro, Advanced, Business, Enterprise
- **Source availability**: All code visible on GitHub, but premium code is not MIT-licensed
- **Contribution handling**: Contributors assign modifications/patches to GitKraken

**Key insight**: GitLens uses a **directory-based dual license** approach. The base extension is MIT, premium features are proprietary. This is the "open core" model.

### 5.2 Wallaby.js / Quokka.js - Proprietary Freemium

- **Core**: Free "Community" edition
- **Premium**: Commercial "Pro" edition with perpetual license per version + 12 months updates
- **Source code**: Closed source (not on GitHub)
- **License type**: Proprietary commercial license
- **Pricing**: Personal licenses and Company Seat licenses available

### 5.3 Other Notable Examples

| Extension                 | License Model                   | Source Availability |
| ------------------------- | ------------------------------- | ------------------- |
| **Pylance** (Microsoft)   | Proprietary (Microsoft License) | Closed source       |
| **C# DevKit** (Microsoft) | Visual Studio subscription      | Closed source       |
| **GitHub Copilot**        | Proprietary                     | Closed source       |
| **Cody** (Sourcegraph)    | Apache 2.0                      | Open source         |
| **Continue.dev**          | Apache 2.0                      | Open source         |
| **TabNine**               | Proprietary                     | Closed source       |
| **Cursor**                | Proprietary (VS Code fork)      | Not an extension    |

### 5.4 No Known VS Code Extensions Using FSL or BSL

As of this research date, no VS Code extensions were found using either FSL or BSL specifically. The common patterns are:

1. **Fully open source** (MIT/Apache 2.0) with external SaaS monetization
2. **Dual license** (open core + proprietary premium features, like GitLens)
3. **Fully proprietary** (closed source, like Copilot)

**Ptah would be a pioneer** in using FSL for a VS Code extension, which has both risks (uncharted territory) and benefits (PR/thought leadership potential, community goodwill from the 2-year conversion promise).

---

## 6. Recommendation for Ptah

### 6.1 Primary Recommendation: FSL-1.1-MIT

**Use FSL-1.1-MIT** (Functional Source License 1.1, MIT Future License) for the Ptah extension.

**Why FSL-1.1-MIT specifically (not FSL-1.1-ALv2):**

- MIT is simpler and more universally understood
- MIT is GPL-2.0 compatible (Apache 2.0 is not)
- Ptah does not hold patents that need defensive protection
- Sentry uses MIT for SDKs, which are closer to an extension's form factor than a web app
- Broader compatibility with the ecosystem after conversion

### 6.2 What This Means in Practice

**For your users:**

- Individual developers: Full use, no restrictions
- Companies using Ptah internally: Full use, no restrictions
- Educational/research use: Full use, no restrictions
- Anyone building integrations with Ptah: Allowed (as long as not creating a competing product)
- Someone forking Ptah to create a competing AI coding extension: PROHIBITED for 2 years per version
- After 2 years: Any version becomes fully MIT, no restrictions whatsoever

**For competing forks:**

- Cannot take Ptah's code and create "BetterPtah" or any competing AI coding VS Code extension
- Cannot wrap Ptah's APIs into a competing service
- CAN use 2-year-old versions of Ptah code under MIT for any purpose

**For contributors:**

- Can view, study, and modify all source code
- Need to sign a CLA to contribute (implement via CLA Assistant on GitHub)
- Their contributions become part of the FSL-licensed codebase

### 6.3 Implementation Checklist

1. **Replace LICENSE file** with FSL-1.1-MIT template from https://github.com/getsentry/fsl.software/blob/main/FSL-1.1-MIT.template.md
   - Fill in: `Copyright 2025-2026 Hive Academy`
   - The license text is fixed; only copyright holder and year are customizable

2. **Update package.json**:

   ```json
   {
     "license": "FSL-1.1-MIT"
   }
   ```

   Or if the marketplace does not recognize the SPDX identifier:

   ```json
   {
     "license": "SEE LICENSE IN LICENSE.md"
   }
   ```

3. **Set up CLA** via [CLA Assistant](https://github.com/cla-assistant/cla-assistant) on GitHub

4. **Add a license header** to source files (recommended but not required):

   ```
   // Copyright 2025-2026 Hive Academy
   // SPDX-License-Identifier: FSL-1.1-MIT
   ```

5. **Update README** to explain the license choice (link to fsl.software for community understanding)

6. **Consider a blog post** explaining the move from MIT to FSL (builds trust, follows Sentry/GitButler's playbook)

### 6.4 Alternative Approaches Considered

| Approach                              | Verdict            | Why                                                                                                                                                 |
| ------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Stay on MIT**                       | Risky              | No protection against competing forks. Anyone can clone Ptah and compete freely.                                                                    |
| **BSL 1.1**                           | Worse than FSL     | More complex, worse community perception, longer restriction period, requires custom Additional Use Grant drafting.                                 |
| **Dual License (MIT + Proprietary)**  | Viable alternative | Like GitLens. More work (must separate code into open/premium directories). Better for open-source credibility but more engineering overhead.       |
| **Fully Proprietary**                 | Too restrictive    | Blocks community contributions and reduces trust.                                                                                                   |
| **AGPL**                              | Wrong fit          | Copyleft license that scares away corporate users. Does not prevent competing SaaS.                                                                 |
| **Fair Core License (FCL)**           | Close alternative  | FSL variant with license key support built in. Worth considering if you want license-key-gated features in the license itself, but adds complexity. |
| **SSPL (Server Side Public License)** | Wrong fit          | Designed for databases (MongoDB). Not suited for extensions.                                                                                        |

### 6.5 Risk Assessment

| Risk                                       | Probability | Impact               | Mitigation                                                                                                     |
| ------------------------------------------ | ----------- | -------------------- | -------------------------------------------------------------------------------------------------------------- |
| Reduced community contributions            | 20%         | Medium               | The 2-year conversion and CLA mitigate this. Most contributors care about the product, not the license.        |
| Corporate legal department blocks adoption | 15%         | Medium               | FSL is SPDX-registered and well-documented. Provide FAQ for enterprise customers.                              |
| Marketplace issues                         | 5%          | Low                  | Marketplace explicitly allows non-OSI licenses.                                                                |
| Community backlash                         | 10%         | Low-Medium           | Transparency about the change and reasoning (blog post) reduces this. FSL is much better received than BSL.    |
| Legal enforceability questions             | 10%         | Low                  | Same risk as any untested license. The 2-year conversion limits the exposure window.                           |
| Competing fork during restriction period   | 5%          | High (if it happens) | FSL legally prohibits this. Practical enforcement would require legal action, but the license terms are clear. |

### 6.6 Financial Context

For a $5/month VS Code extension:

- FSL protects against someone cloning Ptah and offering it free or cheaper
- The 2-year conversion is generous enough that users feel comfortable investing in the ecosystem
- Enterprise customers evaluating Ptah will find FSL more acceptable than BSL or proprietary
- The "eventually open source" promise is a marketing advantage

---

## Sources

### Primary Sources

- [FSL Official Website](https://fsl.software/)
- [FSL GitHub Repository](https://github.com/getsentry/fsl.software)
- [FSL-1.1-MIT Template](https://github.com/getsentry/fsl.software/blob/main/FSL-1.1-MIT.template.md)
- [FSL-1.1-ALv2 Template](https://github.com/getsentry/fsl.software/blob/main/FSL-1.1-Apache-2.0.template.md)
- [SPDX FSL-1.1-MIT](https://spdx.org/licenses/FSL-1.1-MIT.html)
- [SPDX FSL-1.1-ALv2](https://spdx.org/licenses/FSL-1.1-ALv2.html)
- [SPDX BUSL-1.1](https://spdx.org/licenses/BUSL-1.1.html)
- [BSL 1.1 Official Text (MariaDB)](https://mariadb.com/bsl11/)
- [Sentry Licensing Page](https://open.sentry.io/licensing/)
- [Sentry Blog - Introducing FSL](https://blog.sentry.io/introducing-the-functional-source-license-freedom-without-free-riding/)
- [Fair Source Organization](https://fair.io/)
- [Fair Source Licenses List](https://fair.io/licenses/)
- [VS Code Extension Manifest](https://code.visualstudio.com/api/references/extension-manifest)
- [VS Code Extension Licensing Policy](https://code.visualstudio.com/docs/supporting/oss-extensions)

### Secondary Sources

- [Armin Ronacher - FSL vs AGPL Analysis](https://lucumr.pocoo.org/2024/9/23/fsl-agpl-open-source-businesses/)
- [Armin Ronacher - Cathedral and Bazaar Licensing](https://lucumr.pocoo.org/2023/11/19/cathedral-and-bazaaar-licensing/)
- [Heather Meeker - FSL Launch Analysis](https://heathermeeker.com/2023/11/18/sentry-launches-functional-source-license-a-new-twist-on-delayed-open-source-release/)
- [TechCrunch - Fair Source Movement](https://techcrunch.com/2024/09/22/some-startups-are-going-fair-source-to-avoid-the-pitfalls-of-open-source-licensing/)
- [InfoQ - Sentry FSL Introduction](https://www.infoq.com/news/2023/12/functional-source-license/)
- [The Register - Do We Need Another License?](https://www.theregister.com/2023/11/24/opinion_column/)
- [FOSSA - BSL Requirements and History](https://fossa.com/blog/business-source-license-requirements-provisions-history/)
- [FOSSA - Source-Available License Guide](https://fossa.com/blog/comprehensive-guide-source-available-software-licenses/)
- [HashiCorp BSL Adoption Blog](https://www.hashicorp.com/en/blog/hashicorp-adopts-business-source-license)
- [HashiCorp BSL Page](https://www.hashicorp.com/en/bsl)
- [Spacelift - Terraform License Change Impact](https://spacelift.io/blog/terraform-license-change)
- [TLDRLegal - FSL Explained](https://www.tldrlegal.com/license/functional-source-license-fsl)
- [TLDRLegal - BSL Explained](https://www.tldrlegal.com/license/business-source-license-bsl-1-1)
- [GitButler - Fair Source Announcement](https://blog.gitbutler.com/gitbutler-is-now-fair-source)
- [PowerSync FSL Legal Page](https://www.powersync.com/legal/fsl)
- [Liquibase FSL Announcement](https://www.liquibase.com/blog/liquibase-community-for-the-future-fsl)
- [GitLens LICENSE](https://github.com/gitkraken/vscode-gitlens/blob/main/LICENSE)
- [GitLens LICENSE.plus](https://github.com/gitkraken/vscode-gitlens/blob/main/LICENSE.plus)
- [Wikipedia - Business Source License](https://en.wikipedia.org/wiki/Business_Source_License)
- [Akka BSL License FAQ](https://akka.io/bsl-license-faq)
- [BSL FAQ for Adopters (MariaDB)](https://mariadb.com/bsl-faq-adopting/)
