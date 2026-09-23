# Interactive Prototypes for User Confirmation

## Purpose

The UI/UX designer **owns building an interactive, clickable prototype** for user confirmation before any implementation code is written.

Prototypes prevent design drift and unapproved lane assumptions. A lane must never ship or implement a UI design that the user has not seen and confirmed. The approved prototype serves as the visual source of truth for developers and reviewers throughout the lifecycle of the task.

---

## Folder Layout

Every UI task creates a self-contained static prototype directory inside the task folder:

```text
<taskFolder>/prototype/
├── index.html            # Main entry point (single screen or in-page tab/screen navigation)
├── [screen-name].html    # Optional per-screen HTML files for multi-page flows
├── README.md             # How to open, screen/state list, interactive parts, constraints, parity mapping
└── screenshots/          # Static screenshot captures across themes and viewports
```

### Technical Constraints for Prototypes
- **Zero build step**: Pure static HTML, CSS, and plain JavaScript. No bundlers, compilers, or Node runtimes required to view.
- **Zero backend**: Mock all data and interactions locally in client-side script. No API calls or database connections.
- **Never imported**: The prototype lives solely in the task folder (`.ptah/specs/<TASK_FOLDER>/prototype/`) and is never imported or bundled by application code.
- **Token and component fidelity**: Use the project's real design tokens and component library (e.g., Tailwind CSS + daisyUI themes from the project's configuration; a CDN build with matching theme names and color definitions is acceptable).

---

## Minimal HTML Skeleton

Below is a minimal, production-grade template demonstrating theme switching, container width toggling, and component fidelity. This example demonstrates the pattern using Tailwind CSS + daisyUI; substitute the target project's own token and component system, keeping the toggle and state-switcher pattern:

```html
<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Prototype - TASK_TITLE</title>
  <!-- Tailwind CSS + daisyUI CDN (defaults to standard dark/light themes out of the box) -->
  <link href="https://cdn.jsdelivr.net/npm/daisyui@4.12.10/dist/full.min.css" rel="stylesheet" type="text/css" />
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    /*
     * THEME FIDELITY INSTRUCTIONS:
     * Read the target project's Tailwind / daisyUI config (or design token system)
     * and paste custom CSS properties under [data-theme="<name>"] so the prototype
     * mirrors the project's real colors and styling.
     *
     * Example custom theme block (uncomment and populate with project tokens):
     * [data-theme="custom-dark"] {
     *   --p: <from project config (primary)>;
     *   --s: <from project config (secondary)>;
     *   --a: <from project config (accent)>;
     *   --n: <from project config (neutral)>;
     *   --b1: <from project config (base-100)>;
     *   --b2: <from project config (base-200)>;
     *   --b3: <from project config (base-300)>;
     *   --bc: <from project config (base-content)>;
     *   --su: <from project config (success)>;
     *   --wa: <from project config (warning)>;
     *   --er: <from project config (error)>;
     * }
     */
    .viewport-sidebar {
      max-width: 400px;
      margin: 0 auto;
      border-left: 1px dashed oklch(var(--bc, 0.5 0 0) / 0.2);
      border-right: 1px dashed oklch(var(--bc, 0.5 0 0) / 0.2);
    }
    .viewport-wide {
      max-width: 100%;
      margin: 0 auto;
    }
  </style>
</head>
<body class="bg-base-100 text-base-content min-h-screen">
  <!-- Prototype Toolbar: Theme & Viewport Controls -->
  <header class="bg-base-200 border-b border-base-300 px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
    <div class="flex items-center gap-2">
      <span class="font-bold">Prototype Controls:</span>
      <button id="themeToggle" class="btn btn-xs btn-outline">Toggle Theme (Dark / Light)</button>
      <button id="widthToggle" class="btn btn-xs btn-outline">Toggle Viewport (Sidebar ≈400px / Wide)</button>
    </div>
    <div class="flex items-center gap-2">
      <span>State:</span>
      <select id="stateSelector" class="select select-xs select-bordered">
        <option value="populated">Populated (Default)</option>
        <option value="empty">Empty</option>
        <option value="loading">Loading</option>
        <option value="error">Error</option>
      </select>
    </div>
  </header>

  <!-- Prototype Container -->
  <main id="prototypeContainer" class="viewport-wide p-6 transition-all duration-200">
    <!-- Screen Surface (Example using project's component patterns) -->
    <div class="space-y-6">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-xl font-bold">Surface Title</h1>
          <p class="text-xs text-base-content/70">Secondary descriptive context</p>
        </div>
        <!-- Exactly one primary action per surface -->
        <button class="btn btn-primary btn-sm">Primary Action</button>
      </div>

      <!-- State Views -->
      <div id="view-populated" class="state-view">
        <div class="card bg-base-200 shadow-sm border border-base-300">
          <div class="card-body p-4 space-y-3">
            <div class="flex items-center justify-between">
              <span class="font-medium">Active Item</span>
              <!-- Status info uses hints, badges, or tooltips — never buttons -->
              <span class="badge badge-success badge-sm gap-1">Connected</span>
            </div>
            <p class="text-sm text-base-content/80">Item details with tooltip support.</p>
            <div class="card-actions justify-end">
              <button class="btn btn-ghost btn-xs" title="Secondary affordance">Details</button>
            </div>
          </div>
        </div>
      </div>

      <div id="view-empty" class="state-view hidden">
        <div class="text-center py-12 border border-dashed border-base-300 rounded-box p-6">
          <p class="text-sm text-base-content/60">No items configured yet.</p>
          <button class="btn btn-outline btn-sm mt-3">Add Item</button>
        </div>
      </div>

      <div id="view-loading" class="state-view hidden">
        <div class="flex flex-col items-center justify-center py-12 gap-3">
          <span class="loading loading-spinner loading-md text-primary"></span>
          <span class="text-xs text-base-content/60">Loading surface data...</span>
        </div>
      </div>

      <div id="view-error" class="state-view hidden">
        <div class="alert alert-error text-xs shadow-sm">
          <span>Failed to load configuration. Network connection timed out.</span>
          <button class="btn btn-ghost btn-xs">Retry</button>
        </div>
      </div>
    </div>
  </main>

  <script>
    // Theme toggle logic (dark <-> light)
    const root = document.documentElement;
    document.getElementById('themeToggle').addEventListener('click', () => {
      const current = root.getAttribute('data-theme');
      root.setAttribute('data-theme', current === 'dark' ? 'light' : 'dark');
    });

    // Viewport toggle logic (sidebar ≈400px <-> wide)
    const container = document.getElementById('prototypeContainer');
    document.getElementById('widthToggle').addEventListener('click', () => {
      if (container.classList.contains('viewport-wide')) {
        container.classList.replace('viewport-wide', 'viewport-sidebar');
      } else {
        container.classList.replace('viewport-sidebar', 'viewport-wide');
      }
    });

    // State switcher logic
    const states = ['populated', 'empty', 'loading', 'error'];
    document.getElementById('stateSelector').addEventListener('change', (e) => {
      const selected = e.target.value;
      states.forEach((st) => {
        const el = document.getElementById(`view-${st}`);
        if (el) el.classList.toggle('hidden', st !== selected);
      });
    });
  </script>
</body>
</html>
```

---

## State Checklist

Every prototype must explicitly implement and showcase:

| State | Required Coverage | Visual Proof |
| --- | --- | --- |
| **Populated** | Realistic default content, multi-item lists, edge-case text lengths | Screenshot in screenshots/ |
| **Empty** | First-run state, helpful copy, clear onboarding action | Screenshot in screenshots/ |
| **Loading** | Visible spinners, skeletons, or progress indicators | Screenshot in screenshots/ |
| **Error** | Actionable error alert, retry affordance, clear failure explanation | Screenshot in screenshots/ |
| **Dark Theme** | Primary dark theme (e.g. `dark` or project dark theme) validated for contrast | Screenshot in screenshots/ |
| **Light Theme** | Primary light theme (e.g. `light` or project light theme) validated for contrast | Screenshot in screenshots/ |
| **Narrow Width** | Sidebar width (≈400px), no horizontal overflow, wrapped actions | Screenshot in screenshots/ |
| **Wide Width** | Expanded desktop/editor width, balanced grid or flex spacing | Screenshot in screenshots/ |

---

## Prototype Rules

When creating prototypes and design specifications, the designer must strictly adhere to these rules:

1. **Reuse project components**: Always prefer the project's existing design tokens and component library (e.g., daisyUI buttons, badges, alerts, tabs, tooltips, modals) over custom ad-hoc CSS or reinvented markup.
2. **Never ban a project component wholesale**: A lane or designer must **never** ban an existing project component (such as "no badges", "no tooltips", "no primary buttons"). Accessibility concerns are resolved via tokens, contrast tuning, and ARIA attributes — never by banning components. Any component prohibition requires documented empirical evidence and explicit user approval.
3. **Status is a hint, badge, or tooltip — not a button**: Status, state indications, and secondary information must be presented using badges, status dots, hint labels, or tooltips. Never render status indicators as clickable action buttons.
4. **One primary action per surface**: Each view or surface has exactly one prominent primary button (`btn-primary`). Secondary or destructive affordances must use secondary, outline, or ghost styles (`btn-outline`, `btn-ghost`, `btn-error btn-outline`) to maintain clear visual hierarchy.

---

## Screenshot Capture Step

Screenshots provide immediate visual evidence for checkpoints and reviews without requiring the user to run a local web server:

1. Use `ptah_browser_navigate` to open the file URL: `file:///<absolute-path-to-taskFolder>/prototype/index.html`.
2. Capture screenshots across the state and viewport matrix using `ptah_browser_screenshot`:
   - `screenshots/dark-populated-wide.png`
   - `screenshots/dark-populated-sidebar.png`
   - `screenshots/light-populated-wide.png`
   - `screenshots/dark-empty.png`
   - `screenshots/dark-error.png`
3. If browser tools (`ptah_browser_*`) are unadvertised or unavailable in the harness, state this explicitly in `prototype/README.md` and instruct the user to view `index.html` directly in their browser.

---

## README Template (`prototype/README.md`)

Every prototype folder must contain a `README.md` structured as follows:

````markdown
# Prototype - TASK_YYYY_NNN

## How to Open
Open `index.html` directly in any web browser:
```bash
# Via browser or system launcher
file:///<absolute-path-to-taskFolder>/prototype/index.html
```

## Screens & States
- **Screen 1**: [Description]
  - Populated state (default)
  - Empty state
  - Loading state
  - Error state
- **Themes demonstrated**: Dark (`dark`), Light (`light`)
- **Viewports demonstrated**: Sidebar (400px), Wide (desktop)

## Interactive Features
- Viewport toggle (switch between 400px sidebar and wide desktop).
- Theme switcher (switch between dark and light themes).
- State dropdown (switch between populated, empty, loading, error).
- Clickable modals, tabs, or accordions.

## Lane-introduced constraints
List every design rule, boundary, or constraint present in the design, tagged by origin:
- `[user-requested]`: Explicitly requested by the user prompt or issue.
- `[project-rule]`: Mandated by project architecture, design system, or coding guidelines.
- `[lane-proposed]`: Introduced by the agent/lane. **Requires explicit user approval at Gate 1.7.**

| Constraint | Tag | Rationale |
| --- | --- | --- |
| Single primary action per card | `[project-rule]` | Visual hierarchy standard |
| Provider status shown as badge | `[project-rule]` | Status info must not be action buttons |
| Collapsible advanced settings | `[lane-proposed]` | Keeps initial view uncluttered; pending approval |

## Parity Mapping
Cross-reference against `parity-inventory.md` to prove all retained capabilities are accounted for:

| Capability from parity-inventory.md | Prototype Location | Visual Treatment |
| --- | --- | --- |
| Set API Key | Settings card -> API Key field | Password input with toggle visibility |
| Test connection | Card actions | Outline button with loading spinner |
| Active model selector | Model picker dropdown | Select dropdown with status badge |
````

---

## Iteration Loop and Orchestration Gate 1.7

The prototype is not just documentation; it is an active review gate:

1. **Produce prototype & screenshots**: The UI/UX designer creates `prototype/index.html`, `prototype/README.md`, and captures screenshots.
2. **Present at Gate 1.7**: The orchestrator presents the prototype path, screenshots, `Lane-introduced constraints`, and parity mapping to the user.
3. **Iterate until approved**:
   - If the user requests adjustments, the designer modifies the prototype in place.
   - The loop continues until the user explicitly replies **`APPROVED`**.
4. **Handoff to engineering**: Once approved at Gate 1.7, the prototype becomes the visual contract. Developers and visual reviewers match the running application directly to this approved prototype.
