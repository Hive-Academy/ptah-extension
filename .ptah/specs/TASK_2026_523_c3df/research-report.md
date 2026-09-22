# Research Report - TASK_2026_523_c3df

## Question

- **Decision this supports**: Whether and how Ptah's consolidated Settings → Providers UI can legally and practically ship vendor logo marks (from `thesvg.org` or elsewhere) without triggering the VS Code Marketplace automated rejection scanner or infringing vendor trademark rights.
- **Question**: Can this repo legally and practically ship vendor logo SVGs for its AI provider settings UI, and from where?
- **Bounds**: Did not download or vendor binary/vector files into the repository; did not modify application or configuration files; legal conclusions are technical/operational assessments based on published terms and guidelines, not binding legal counsel.

---

## Answer

This repo **cannot** ship loose vendor logo SVG asset files (e.g., `assets/icons/openai.svg`) because doing so triggers the VS Code Marketplace non-JS scanner and **permanently burns the extension ID**. 

The repo **can legally and practically** provide vendor marks by **inlining sanitized SVG path data directly into the webview JavaScript bundle** (paired with a Lucide generic icon fallback). Inlined JS passes marketplace validation (`CLAUDE.md:184`), satisfies nominative fair use for third-party compatibility identification, and isolates the extension from external runtime network failures.

---

## Provider + CLI Inventory

The complete set of marks required covers 12 provider connections (11 in the registry + virtual direct Claude) and 6 CLI agent adapters:

| Mark / Entity | Category | ID | Display Name | Source File & Line Citation | Brand / Trademark Owner |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **OpenRouter** | Anthropic Provider | `openrouter` | OpenRouter | [`provider-registry.ts:180-181`](file:///D:/projects/ptah-extension/libs/shared/src/lib/providers/provider-registry.ts#L180-L181) | OpenRouter Inc. |
| **Moonshot (Kimi)** | Anthropic Provider | `moonshot` | Moonshot (Kimi) | [`provider-registry.ts:194-195`](file:///D:/projects/ptah-extension/libs/shared/src/lib/providers/provider-registry.ts#L194-L195) | Moonshot AI (Moonshot Inc.) |
| **Z.AI (GLM)** | Anthropic Provider | `z-ai` | Z.AI (GLM) | [`provider-registry.ts:291-292`](file:///D:/projects/ptah-extension/libs/shared/src/lib/providers/provider-registry.ts#L291-L292) | Zhipu AI |
| **GitHub Copilot** | Anthropic Provider | `github-copilot` | GitHub Copilot | [`copilot-provider-entry.ts:202-203`](file:///D:/projects/ptah-extension/libs/shared/src/lib/providers/entries/copilot-provider-entry.ts#L202-L203) | GitHub, Inc. / Microsoft |
| **OpenAI Codex** | Anthropic Provider | `openai-codex` | OpenAI Codex | [`codex-provider-entry.ts:95-96`](file:///D:/projects/ptah-extension/libs/shared/src/lib/providers/entries/codex-provider-entry.ts#L95-L96) | OpenAI, L.L.C. |
| **Ollama** | Anthropic Provider | `ollama` | Ollama | [`local-provider-entry.ts:35-36`](file:///D:/projects/ptah-extension/libs/shared/src/lib/providers/entries/local-provider-entry.ts#L35-L36) | Ollama Inc. |
| **Ollama Cloud** | Anthropic Provider | `ollama-cloud` | Ollama Cloud | [`local-provider-entry.ts:115-116`](file:///D:/projects/ptah-extension/libs/shared/src/lib/providers/entries/local-provider-entry.ts#L115-L116) | Ollama Inc. |
| **LM Studio** | Anthropic Provider | `lm-studio` | LM Studio | [`local-provider-entry.ts:151-152`](file:///D:/projects/ptah-extension/libs/shared/src/lib/providers/entries/local-provider-entry.ts#L151-L152) | Element Labs Inc. |
| **Claude (Subscription)** | Anthropic Provider | `claude-cli` | Claude (Subscription) | [`claude-cli-provider-entry.ts:24-25`](file:///D:/projects/ptah-extension/libs/shared/src/lib/providers/entries/claude-cli-provider-entry.ts#L24-L25) | Anthropic PBC |
| **Sakana (Fugu)** | Anthropic Provider | `sakana` | Sakana (Fugu) | [`sakana-provider-entry.ts:74-75`](file:///D:/projects/ptah-extension/libs/shared/src/lib/providers/entries/sakana-provider-entry.ts#L74-L75) | Sakana AI Co., Ltd. |
| **Requesty** | Anthropic Provider | `requesty` | Requesty | [`requesty-provider-entry.ts:32-33`](file:///D:/projects/ptah-extension/libs/shared/src/lib/providers/entries/requesty-provider-entry.ts#L32-L33) | Requesty AI |
| **Claude Direct (Virtual)** | Virtual Direct Auth | `anthropic` | Claude / Anthropic | [`provider-registry.ts:495`](file:///D:/projects/ptah-extension/libs/shared/src/lib/providers/provider-registry.ts#L495) | Anthropic PBC |
| **Codex CLI** | CLI Agent Adapter | `codex` | Codex CLI | [`agent-process.types.ts:63`](file:///D:/projects/ptah-extension/libs/shared/src/lib/types/agent-process.types.ts#L63) & [`codex-cli.adapter.ts:444-445`](file:///D:/projects/ptah-extension/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex-cli.adapter.ts#L444-L445) | OpenAI, L.L.C. |
| **Copilot CLI** | CLI Agent Adapter | `copilot` | Copilot CLI | [`agent-process.types.ts:64`](file:///D:/projects/ptah-extension/libs/shared/src/lib/types/agent-process.types.ts#L64) & [`copilot-sdk.adapter.ts:147-148`](file:///D:/projects/ptah-extension/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/copilot-sdk.adapter.ts#L147-L148) | GitHub, Inc. / Microsoft |
| **Cursor** | CLI Agent Adapter | `cursor` | Cursor | [`agent-process.types.ts:65`](file:///D:/projects/ptah-extension/libs/shared/src/lib/types/agent-process.types.ts#L65) & [`cursor-cli.adapter.ts:198-199`](file:///D:/projects/ptah-extension/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cursor-cli.adapter.ts#L198-L199) | Anysphere, Inc. |
| **Antigravity** | CLI Agent Adapter | `antigravity` | Antigravity | [`agent-process.types.ts:66`](file:///D:/projects/ptah-extension/libs/shared/src/lib/types/agent-process.types.ts#L66) & [`antigravity-cli.adapter.ts:255-256`](file:///D:/projects/ptah-extension/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts#L255-L256) | Google LLC |
| **opencode** | CLI Agent Adapter | `opencode` | opencode | [`agent-process.types.ts:67`](file:///D:/projects/ptah-extension/libs/shared/src/lib/types/agent-process.types.ts#L67) & [`opencode-cli.adapter.ts:228-229`](file:///D:/projects/ptah-extension/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.ts#L228-L229) | opencode open-source project |
| **Pi** | CLI Agent Adapter | `pi` | Pi | [`agent-process.types.ts:68`](file:///D:/projects/ptah-extension/libs/shared/src/lib/types/agent-process.types.ts#L68) & [`pi-cli.adapter.ts:151-152`](file:///D:/projects/ptah-extension/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/pi-cli.adapter.ts#L151-L152) | Pi open-source / Inflection |

*Note*: CLI registration happens centrally in `CliDetectionService` at [`cli-detection.service.ts:51-62`](file:///D:/projects/ptah-extension/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-detection.service.ts#L51-L62).

---

## thesvg.org Findings

### What is thesvg.org?
[theSVG](https://thesvg.org/) is an open-source brand SVG icon library and delivery platform created by GLINCKER (GitHub: [`glincker/thesvg`](https://github.com/glincker/thesvg)). It hosts 7,400+ SVG icons across brands, cloud platforms (AWS, Azure, GCP, Kubernetes), and auth badges, distributed via website, npm (`thesvg`, `@thesvg/icons`), CLI, and CDN.

### Repository License vs Distributed Marks License
There is an essential legal division between the repository codebase and the marks it distributes:

1. **Codebase License (MIT)**:
   - **Source**: [`LICENSE`](https://raw.githubusercontent.com/glincker/thesvg/main/LICENSE) (dated 2025).
   - **Quoted Text**:
     > *"Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the 'Software'), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software."*

2. **Trademark Notice and Third-Party Marks**:
   - **Source**: [`LEGAL.md`](https://raw.githubusercontent.com/glincker/thesvg/main/LEGAL.md) & [`TRADEMARK.md`](https://raw.githubusercontent.com/glincker/thesvg/main/TRADEMARK.md).
   - **Quoted Text ([`LEGAL.md`](https://raw.githubusercontent.com/glincker/thesvg/main/LEGAL.md))**:
     > *"All brand names, logos, and trademarks included in this library are the property of their respective owners. theSVG is not affiliated with, endorsed by, or sponsored by any of the companies or organizations whose brand icons appear here."*
     > *"Brand icons are provided for identification and development purposes only, consistent with nominative fair use of trademarks... theSVG does not grant trademark rights - those remain with the brand owner."*
   - **Quoted Text ([`TRADEMARK.md`](https://raw.githubusercontent.com/glincker/thesvg/main/TRADEMARK.md))**:
     > *"Icons in this library are provided strictly for identification and development purposes - helping developers and designers reference brand assets in their projects. This is consistent with nominative fair use of trademarks. We encourage users to review each brand's official guidelines before using their logo in production."*

3. **Maintainer Clarification**:
   - **Source**: [theSVG Discussion #157: "Can I use thesvg icons commercially? (license guide)"](https://github.com/glincker/thesvg/discussions/157) (Maintainer: `thegdsks`, 2026-05-06).
   - **Quoted Text**:
     > *"The wrapper code is MIT. All the package code (`thesvg`, `@thesvg/icons`, `@thesvg/react`, `@thesvg/vue`, `@thesvg/svelte`, `@thesvg/cli`, `@thesvg/mcp-server`) is MIT-licensed. You can use it in any project, commercial or otherwise."*
     > *"Brand icons themselves remain trademarks of their respective owners. thesvg distributes them under the doctrine of nominative fair use — you can use a brand mark to refer to that specific brand without implying endorsement."*
     > *"Each entry in icons.json carries a license field: CC0-1.0, MIT, CC-BY-SA-4.0, brand-use (Brand owner restricts third-party redistribution; nominative fair use only), Proprietary (Brand owner has explicit restrictions; check before using), Apache-2.0."*

### Does it permit redistribution inside a commercial desktop app and VS Code extension?
- **Copyright layer**: The MIT license permits redistributing the SVG files and npm packages.
- **Trademark layer**: **No.** theSVG explicitly disclaims granting any trademark or redistribution rights for the brand marks. A third party redistributing these marks in a commercial product cannot rely on theSVG's MIT license to shield against trademark infringement claims by the underlying brand owners.

---

## The Separate Trademark Problem

Copyright and trademark rights in a logo are orthogonal:
- **Copyright** covers the original vector drawing expression.
- **Trademark** protects the consumer-facing source indicator from confusion, deceptive affiliation, dilution, or unauthorized commercial appropriation.

Even if an SVG drawing is CC0 or MIT, the trademark rights remain 100% with the brand owner. Under trademark law (U.S. Lanham Act § 32 / § 43(a) and equivalent EU/international statutes), third-party usage in software UI is legally defensible only under **nominative fair use**:
1. The product or service cannot be readily identified without naming or showing the mark.
2. Only so much of the mark is used as is reasonably necessary (e.g. wordmark or glyph, not branding trade dress).
3. The user does nothing that would suggest sponsorship or endorsement by the trademark holder.

### Per-Vendor Brand Guidelines & Permissions

| Vendor | Publishes Guidelines? | URL / Reference | Third-Party Product UI Terms |
| :--- | :--- | :--- | :--- |
| **Anthropic** (`claude`, `anthropic`) | Limited publicly; strict press terms | [`anthropic.com/news`](https://www.anthropic.com/news) & Terms of Service | No open license to bundle Claude logos into third-party apps. Permitted to refer textually to Claude model compatibility. Logo use in UI is defensible under nominative fair use only if not suggesting affiliation. |
| **OpenAI** (`openai-codex`, `codex`) | Yes (Strict) | [`openai.com/brand`](https://openai.com/brand) | **Strictly prohibits** standalone logo use: *"Do not incorporate the logo into your own branding, trademark, or design a similar logo. Do not feature our Marks more prominently than your own company's name or logo."* Mandates official badges or text lockups ("Powered by OpenAI") rather than loose icon usage. Direct fetch returns HTTP 403. |
| **Microsoft / GitHub** (`copilot`) | Yes (Detailed) | [`brand.github.com/brand-identity/copilot`](https://brand.github.com/brand-identity/copilot) & [`cobranding`](https://brand.github.com/brand-identity/cobranding) | **Strictly forbids** standalone Copilot icons: *"Beginning in 2025, GitHub Copilot no longer has a standalone logo that heros the Copilot icon... Product names and mascots are trademarked and their use is forbidden without written approval from GitHub."* |
| **Google** (`antigravity`) | Yes (Strict) | [`about.google/brand-resource-center/guidance`](https://about.google/brand-resource-center/guidance/) | *"Don't use Google's brand features in a way that implies endorsement or partnership."* Explicitly forbids incorporating Google product logos or colors into third-party application buttons without written permission (narrow exception for standard "Sign in with Google" button). |
| **Cursor / Anysphere** (`cursor`) | Yes (Brand Toolkit) | [`cursor.com/brand`](https://cursor.com/brand) | Publishes logo/app-icon/avatar vectors (2D/2.5D), but explicitly states: *"Refer to us as Cursor. Not Cursor AI or Cursor Code."* No third-party commercial redistribution license granted; provided for editorial/media reference. |
| **OpenRouter** (`openrouter`) | Yes (Developer assets) | [`openrouter.ai/brand`](https://openrouter.ai/brand) | Publishes official glyph and horizontal marks in SVG/PNG format specifically for integrators and developers referencing OpenRouter endpoints. Most accommodating among commercial providers. |
| **Ollama** (`ollama`, `ollama-cloud`) | No formal UI guideline | [`github.com/ollama/ollama/blob/main/LICENSE`](https://github.com/ollama/ollama/blob/main/LICENSE) | Code is MIT, but the Ollama llama mark is a proprietary trademark with no formal third-party redistribution terms. |
| **LM Studio** (`lm-studio`) | Terms of Service | [`lmstudio.ai`](https://lmstudio.ai) | Proprietary desktop application; terms restrict unauthorized redistribution of visual assets and brand elements. |
| **Moonshot (Kimi)** (`moonshot`) | Console API docs | [`platform.moonshot.ai`](https://platform.moonshot.ai) | No published permissive trademark license for third-party client UI. |
| **Z.AI / Zhipu AI** (`z-ai`) | Console API docs | [`open.z.ai`](https://open.z.ai) | Proprietary enterprise mark; no public trademark redistribution license. |
| **Sakana AI** (`sakana`) | Console API docs | [`sakana.ai`](https://sakana.ai) | Proprietary startup mark; no public trademark redistribution license. |
| **Requesty** (`requesty`) | Router docs | [`docs.requesty.ai`](https://docs.requesty.ai) | Router integration service; no published trademark license. |
| **opencode & Pi** (`opencode`, `pi`) | Open Source | Open source repositories | Community / open source tools with minimal trademark exposure. |

---

## Marketplace-Scanner Assessment

### The Blocking Scanner Rule
[`CLAUDE.md:180-189`](file:///D:/projects/ptah-extension/CLAUDE.md#L180-L189) documents a critical, fatal constraint of the VS Code Marketplace automated ingestion scanner:

> *"Scanner rejects extensions containing trademarked AI product names (`copilot`, `codex`, `claude`, `openai`, `anthropic`) in **non-JS files**.*
> *- JS bundles (`main.mjs`, webview chunks, WASM) pass — these names are safe there.*
> *- `LICENSE.md`, plugin/template markdown, and verbose READMEs are flagged. `.vscodeignore` excludes them.*
> *- Plugins + templates download at runtime via `ContentDownloadService` from GitHub — **never** re-add them as VSIX assets.*
> *- Provider settings with trademarked keys moved to `~/.ptah/settings.json`... Never re-add to `package.json contributes.configuration`.*
> *- **Once an extension ID fails marketplace validation, that ID is permanently burned.** Test throwaway IDs first."*

### Why Loose SVG Files Will Trip the Scanner
1. **SVGs are Non-JS Files**: Files ending in `.svg` are XML documents parsed as text/XML by scanners.
2. **File Paths**: A file named `assets/icons/openai.svg` or `assets/icons/copilot.svg` contains the forbidden tokens in its file path.
3. **Internal XML Content**: Brand SVGs routinely contain `<title>OpenAI</title>`, `<desc>Anthropic Logo</desc>`, `id="claude-icon"`, or trademark metadata comments.
4. **Permanent Failure**: If any non-JS file inside the `.vsix` archive matches the token scanner, the entire extension submission fails validation. **The extension ID is permanently burned** and cannot be salvaged.

### Assessment of Alternatives in the Codebase

| Alternative | Marketplace Scanner Risk | Trademark Risk | Where Alternative Exists in Codebase |
| :--- | :--- | :--- | :--- |
| **1. Loose SVG Asset Files** | **FATAL (ID Burned)** | High | Not used for AI marks. Blocked by [`CLAUDE.md:180-189`](file:///D:/projects/ptah-extension/CLAUDE.md#L180-L189). |
| **2. Inlining in JS/TS Webview Chunks** | **Zero (Safe)** | Low (Nominative Fair Use) | Allowed per [`CLAUDE.md:184`](file:///D:/projects/ptah-extension/CLAUDE.md#L184) (*"JS bundles pass"*). Used throughout Angular components for inlined template templates and `lucide-angular` vector data. |
| **3. `.vscodeignore` Exclusion** | **Zero for VSIX** | N/A for VS Code | [`apps/ptah-extension-vscode/.vscodeignore:47-70`](file:///D:/projects/ptah-extension/apps/ptah-extension-vscode/.vscodeignore#L47-L70) excludes `**/assets/monaco/**`, `**/assets/plugins/**`, `**/templates/**`, `**/assets/harnesses/**`, and `**/LICENSE.md`. (Note: if excluded from VSIX, the VS Code webview cannot display local SVG files). |
| **4. Runtime Download (`ContentDownloadService`)** | **Zero (Safe)** | Low | [`libs/backend/platform-core/src/content-download.service.ts:78-626`](file:///D:/projects/ptah-extension/libs/backend/platform-core/src/content-download.service.ts#L78-L626). Used to fetch plugins and agent templates from GitHub at runtime to `~/.ptah/` to evade packaging non-JS assets into the VSIX. |
| **5. Generic Marks (Lucide Icons)** | **Zero (Safe)** | **Zero (Safe)** | [`auth-config.component.html:25, 60-77`](file:///D:/projects/ptah-extension/libs/frontend/chat/src/lib/settings/auth/auth-config.component.html#L25) and [`auth-config.component.ts:85-101`](file:///D:/projects/ptah-extension/libs/frontend/chat/src/lib/settings/auth/auth-config.component.ts#L85-L101) using `lucide-angular` (`Bot`, `Github`, `Terminal`, `Server`, `Sparkles`, `Zap`, `Globe`). |

---

## Recommendation

### Recommended Approach: Inlined Sanitized SVG Vector Map in JS Bundle + Lucide Generic Fallback

1. **Architecture**:
   - Store sanitized SVG path data as pure TypeScript string constants in a dedicated frontend registry (e.g. `libs/frontend/ui/src/lib/vendor-icons/` or within `libs/frontend/chat/`).
   - Example contract:
     ```typescript
     export const PROVIDER_GLYPH_PATHS: Readonly<Record<string, string>> = {
       openrouter: 'M...',
       moonshot: 'M...',
       ...
     };
     ```
   - Render via a lightweight Angular presentational component `<ptah-provider-icon [providerId]="id" />` that injects the path into a sanitized `<svg>` element with `aria-hidden="true"`.
2. **Sanitization Requirements**:
   - **Strip all non-path XML**: No `<title>`, `<desc>`, comments, metadata, or class names containing trademarked words.
   - **Monochrome `currentColor`**: Render in 24×24 px box with `text-base-content` (as mandated by [`design-spec.md:206-215`](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_523_c3df/design-spec.md#L206-L215)).
   - **Zero loose files**: No `.svg` files placed in `assets/` directories.
3. **Legal Justification (Nominative Fair Use)**:
   - Inlined purely to identify compatible third-party connection endpoints.
   - Equal sizing (24 px), neutral monochrome styling, and equal prominence across all 11 providers prevent any suggestion of endorsement or co-branding.
4. **Mandatory Fallback**:
   - Any unverified provider, custom user endpoint (`isCustom: true`), or provider requesting mark removal falls back to the established `lucide-angular` icons:
     - Local/cloud endpoints (`ollama`, `lm-studio`, custom): `Server`
     - CLI agent lanes (`codex`, `cursor`, `pi`): `Terminal`
     - Main agent assistants (`claude`): `Bot`
     - Custom remote endpoints: `Globe`
5. **Cost**:
   - **Very Low (1–2 engineer days)**. Single TypeScript file in `libs/frontend/ui`, zero build-pipeline modifications, zero backend changes, zero runtime network dependencies.

### Runner-Up Approach (Rejected)

- **Runtime Download via `ContentDownloadService` to `~/.ptah/icons/`**:
  - *Why Considered*: Mirrors the pattern already used for plugins and templates ([`content-download.service.ts`](file:///D:/projects/ptah-extension/libs/backend/platform-core/src/content-download.service.ts#L78-L626)).
  - *Why Rejected*: High architectural complexity, network fragility, and latency. The webview would require either an internal file URI bridge or base64 RPC serialization to render a 16–24 px icon. Settings load would stutter on offline machines or slow connections. Inlining directly into JS completely solves the marketplace scanner risk with none of the runtime overhead.

### Other Rejected Alternatives

- **Loose SVG files in VSIX**:
  - *Why Rejected*: **Fatal.** Triggers the marketplace non-JS scanner and permanently burns the extension ID.
- **Pure Lucide Generic Icons (No Vendor Marks)**:
  - *Why Rejected*: Fails the user's explicit UX requirement in [`context.md:94-96`](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_523_c3df/context.md#L94-L96) ("Auth-providers UI/UX: vendor marks sourced from https://thesvg.org/... and an appealing display of connected providers"). Retained solely as the fallback.

---

## Disagreements

| Point of Disagreement | thesvg.org / Open-Source Repos | Vendor Trademark Policies | Resolution Here |
| :--- | :--- | :--- | :--- |
| **"Free brand icons for commercial use"** | thesvg.org markets itself as "Free brand SVG icons for developers and designers" under MIT. | OpenAI, Google, Microsoft/GitHub explicitly restrict third-party product UI logo usage without prior written authorization. | thesvg.org's MIT license applies only to wrapper code, not trademark rights. Vendor marks can only be used under strict nominative fair use (inlined monochrome glyphs for connection identification), backed by generic fallbacks. |
| **Standalone Copilot Icon** | Many icon repositories distribute the standalone GitHub Copilot "airplane/helmet" logo. | GitHub Brand Toolkit (2025/2026 update) explicitly states Copilot no longer has an approved standalone logo heroing the icon. | In the UI, use GitHub's standard `Github` mark or inlined monochrome Copilot glyph with textual "GitHub Copilot" attribution, or fallback to `Terminal` / `Github`. |

---

## Local Consequences

- [`apps/ptah-extension-vscode/.vscodeignore`](file:///D:/projects/ptah-extension/apps/ptah-extension-vscode/.vscodeignore): Must ensure that no loose SVG or asset folder containing vendor marks is ever included in the VSIX bundle.
- [`libs/frontend/chat/src/lib/settings/auth/auth-config.component.html`](file:///D:/projects/ptah-extension/libs/frontend/chat/src/lib/settings/auth/auth-config.component.html): Current hardcoded Lucide icons (`BotIcon`, `GithubIcon`, `TerminalIcon`, `ServerIcon`, etc. at lines 60–77) will be replaced in the new consolidated Providers UI ([`design-spec.md`](file:///D:/projects/ptah-extension/.ptah/specs/TASK_2026_523_c3df/design-spec.md)) with the inlined glyph component, while preserving the Lucide icons as the standard fallback.
- [`libs/frontend/ui/src/lib/native/`](file:///D:/projects/ptah-extension/libs/frontend/ui/src/lib/native/): Target location for the sanitized inlined SVG vector map constant and `ProviderIconComponent`.

---

## Unknowns

- **Exact Marketplace Scanner Regular Expressions**: Microsoft does not publish the proprietary regexes used by the VS Code Marketplace automated validator. While [`CLAUDE.md:184`](file:///D:/projects/ptah-extension/CLAUDE.md#L184) verifies that JS bundles pass, whether SVG strings inlined into Angular HTML templates vs TypeScript string literals are processed identically by esbuild must be validated on build.
  - *Smallest Experiment*: Verify that esbuild / ng-packagr inlines the template into `main.mjs` / webview chunk JS and run `vsce package` followed by `vsce ls` to assert zero non-JS SVG files exist in the archive.
