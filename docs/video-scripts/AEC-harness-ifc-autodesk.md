# AEC Harness — IFC + Autodesk — Full Script

**Length:** 4–5 min · **Runtime:** Ptah Desktop (Electron) · **Orchestrator:** (your default desktop model — [VERIFY badge on camera])
**Goal:** Build an AEC project-delivery harness in the harness builder, then demo it reading a real IFC model and pulling Revit / element data from Autodesk via existing MCP servers.
**Controlling thesis:** AEC teams already have the data — in IFC models and Autodesk Construction Cloud — getting answers out of it is the slow part.

> Standalone promo, not part of the SaaS-on-open-weights series — no trial-day counter or open-weights thesis. It still follows the shared style guide for voice and format.

## Pre-record checklist

The harness builder assembles a specialist **around MCP servers that are connected to the workspace**. The servers used here already exist — you install/connect them first (via `.mcp.json`), then let the builder wire them into the harness on camera. No custom connector engineering required.

- **Autodesk MCP** connected — use Autodesk's own servers (Revit MCP is a tech preview; Fusion MCP is live), or the official APS reference server `autodesk-platform-services/aps-mcp-server-nodejs` around the AEC Data Model / Model Derivative APIs. Needs a free Autodesk Platform Services dev app (client ID/secret). [VERIFY which Autodesk MCP you'll demo and its current preview status on record day.]
- **IFC MCP** connected — a community IFC server (e.g. `ifc-mcp` on npm, or `ifcMCP` by Jia-Rui Lin) wrapping IfcOpenShell to extract entities, properties, spatial relationships, and quantities from a `.ifc` file. Note on camera that these are community projects.
- **Sample model** ready — a free public `.ifc` (e.g. a buildingSMART sample) for the IFC server, and the same/another model in an APS bucket or demo ACC project for the Autodesk pull.
- Both servers registered in `.mcp.json` so the builder detects them via `harness_list_installed_mcp`.
- Harness-builder prompt drafted and ready to paste.
- Autodesk client secret blurred/omitted — no secrets on screen.

## Assets / overlays

- Lower-thirds for each sub-agent as it's created (model-data analyst, RFI drafter, spec analyst).
- Callout box for the IFC object IDs and the Autodesk property panel (the "this is real data" proof frame).
- A small "tech preview / community server" caption when the Autodesk and IFC tools first appear — honest about maturity.
- End card: Ptah logo · GitHub repo URL · "Download Ptah → ptah.live".

---

### [00:00–00:20] Cold open

- **VISUAL:** Ptah Desktop chat. A `.ifc` model file in the workspace tree; an Autodesk MCP server visible in the connected-tools list.
- **VO:** "In AEC, the data lives in Revit, in IFC models, in Autodesk Construction Cloud. Getting answers out of it — door counts, missing properties, spec conflicts — still takes hours. I connected an IFC server and Autodesk's own MCP to Ptah, then asked it to build an assistant that reads them."
- **ON-SCREEN:** (none)

### [00:20–00:55] The connected tools

- **VISUAL:** Briefly show the connected IFC server and Autodesk MCP in Ptah's tool list. [VERIFY exact location of the connected-tools / MCP list in Ptah Desktop.]
- **VO:** "Two things are connected. One reads IFC files — the open format every BIM tool exports to; this is a community server built on IfcOpenShell. The other is Autodesk's own MCP, reaching model data through their platform — the Revit side is still a tech preview. The harness builder is going to assemble a specialist around both."
- **ON-SCREEN (lower-third):** "Connected: IFC server (community) · Autodesk MCP (preview)"

### [00:55–01:35] The prompt

- **VISUAL:** Open the harness builder and paste the AEC prompt. Scroll through it — persona, sub-agents, the two servers. [VERIFY harness-builder open path / label on camera.]
- **VO:** "I'm describing the job, not the wiring. Be an AEC delivery specialist. Read my IFC models, pull data from Autodesk, draft RFIs, answer spec and quantity questions, and cite the source object or spec section. Use the tools that are already connected."
- **VISUAL:** Submit.
- **ON-SCREEN:** Pasted prompt visible.

### [01:35–02:25] The build

- **VISUAL:** Build streams. Show the real output — server detection, sub-agent creation, the CLAUDE.md being written. Speed-ramp the dead time.
- **VO:** "It picks up the connected servers — the IFC reader, the Autodesk MCP — and wires them in. It creates the specialists: a model-data analyst, an RFI drafter, a spec analyst. And it writes the domain knowledge into the harness — ISO 19650, how RFIs and submittals work. I didn't configure any of that by hand."
- **ON-SCREEN (lower-thirds, as each appears):** "model-data analyst" · "rfi-drafter" · "spec-analyst"

### [02:25–03:15] IFC, live

- **VISUAL:** The finished harness. Load the real `.ifc`. Type the question on camera.
- **VO:** "Here's a real building model. I'll ask it directly: how many doors are on level two, and what's the total floor area of the office spaces?"
- **VISUAL:** Answer streams in; it references the IFC objects it read.
- **VO:** "It read the model — counted the door instances, summed the space quantities, and pointed at the IFC objects it used."
- **ON-SCREEN (callout):** Highlight the cited IFC object IDs.

### [03:15–03:55] Autodesk

- **VISUAL:** Switch to the Autodesk MCP pull. Type the question on camera.
- **VO:** "Now Autodesk. The same model's data is reachable through their MCP. I'll ask it to pull the curtain-wall element properties and flag anything missing fire-rating data."
- **VISUAL:** Answer streams in; show the elements flagged.
- **VO:** "It went through Autodesk's MCP, pulled the properties, and listed the elements with no fire-rating value."
- **ON-SCREEN (callout):** Highlight the Autodesk property panel / flagged elements.

### [03:55–04:30] CTA / End screen

- **VISUAL:** GitHub repo and README; the sample IFC in the repo.
- **VO:** "The whole harness is shareable. The repo has the harness, a free sample IFC model, and setup steps. To run it yourself: download Ptah, get a free Autodesk developer account, connect the IFC server and Autodesk's MCP, and import the harness. This covers the document and coordination side — RFIs, specs, quantities. Procore has its own MCP too — that's a natural next step."
- **ON-SCREEN:** End card — Ptah logo · repo URL · "Download Ptah → ptah.live".

---

## Shot list (quick capture summary)

1. Cold open: Ptah Desktop, `.ifc` in workspace, Autodesk MCP visible.
2. Connected-tools list — IFC server + Autodesk MCP.
3. Harness builder open; paste prompt; scroll persona / sub-agents / servers.
4. Submit; build streams (speed-ramp the dead time).
5. Sub-agents appearing — lower-thirds per agent.
6. CLAUDE.md / domain knowledge being written.
7. Finished harness; load the `.ifc`.
8. IFC question typed; answer with cited object IDs — callout.
9. Autodesk pull; question typed; flagged elements — callout.
10. GitHub repo + README + sample IFC.
11. End card.

## [VERIFY] flags

- Which Autodesk MCP to demo and its maturity on record day — Revit MCP is a **tech preview**, Fusion MCP is live; the APS Node reference server (`autodesk-platform-services/aps-mcp-server-nodejs`) is the fallback. Confirm tool names/behavior before recording.
- Which IFC MCP to use (`ifc-mcp` npm vs `ifcMCP` / others) and that it returns the queried entities — these are community projects, maturity varies.
- These AEC servers are **not** in `registry.modelcontextprotocol.io`, so connect them locally via `.mcp.json` — the harness builder detects connected servers; it won't discover these via online registry search (today).
- Exact Ptah Desktop location of the connected-tools / MCP server list to show in Scene 2.
- Exact harness-builder open path and on-screen behavior when a prompt is submitted (skill card, banner, streaming view?).
- Confirm the chosen sample IFC actually contains the queried entities (level-2 doors, office spaces, a curtain wall with fire-rating properties) so Scenes 5–6 are correct on camera.
- Autodesk API/translation latency — pre-warm before recording; speed-ramp if slow.
- No secrets on screen — blur the Autodesk client secret / any tokens.
