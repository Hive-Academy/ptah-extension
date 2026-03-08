# Task Context - TASK_2025_105

## User Intent

Add Setup Wizard and OpenRouter Model Mapping showcase sections to the landing page to highlight premium features not covered in TASK_2025_104.

## Conversation Summary

- TASK_2025_104 focuses on core landing page redesign with angular-3d and angular-gsap
- During TASK_2025_104 planning, identified two premium features not prominently featured:
  1. Setup Wizard (6-step intelligent agent generation)
  2. OpenRouter Model Mapping (200+ models, tier overrides)
- User approved splitting these into a complementary task

## Technical Context

- Branch: TBD (after TASK_2025_104 merges)
- Created: 2026-01-19
- Type: FEATURE (UI Enhancement)
- Complexity: Medium
- Dependency: TASK_2025_104 must complete first

## Features to Implement

### 1. Setup Wizard Showcase Section

**Source Library**: `libs/frontend/setup-wizard`

**Key Features to Highlight**:

- **6-Step Flow**: Welcome → Scan → Analysis → Agent Selection → Generation → Completion
- **Smart Recommendations**: Agent suggestions based on detected project type
- **AI-Powered Generation**: LLM creates customized agent rules
- **Real-Time Progress**: Visual feedback during generation
- **Error Recovery**: Built-in retry mechanisms

**Visual Treatment Options**:

- Animated step-through demo using `hijackedScrollItem`
- Interactive wizard preview
- Before/after showing generic vs customized agents

**Content Evidence** (from setup-wizard CLAUDE.md):

```typescript
// Available agents with smart recommendations
readonly availableAgents = computed(() => {
  const projectType = this.projectType();
  return [
    { name: 'frontend-developer', recommended: projectType.includes('Angular') },
    { name: 'backend-developer', recommended: projectType.includes('Node.js') },
    { name: 'software-architect', recommended: true },
    { name: 'senior-tester', recommended: true },
  ];
});
```

### 2. OpenRouter Model Mapping Showcase Section

**Source Library**: `libs/frontend/chat/src/lib/settings/openrouter-model-selector.component.ts`

**Key Features to Highlight**:

- **Tier System**: Override Sonnet/Opus/Haiku with any model
- **200+ Models**: Full OpenRouter catalog with search
- **Tool Use Indicators**: Visual warnings for incompatible models
- **Autocomplete Search**: Fast model discovery
- **Environment Variables**: Persisted via `ANTHROPIC_DEFAULT_*_MODEL`

**Visual Treatment Options**:

- Model selector demo component
- Comparison showing default Anthropic vs OpenRouter alternatives
- "Use DeepSeek as Haiku" example scenario

**Content Evidence** (from openrouter-model-selector.component.ts):

```typescript
const TIER_CONFIGS: TierConfig[] = [
  { tier: 'sonnet', label: 'Sonnet', description: 'Best for everyday tasks' },
  { tier: 'opus', label: 'Opus', description: 'Most capable for complex work' },
  { tier: 'haiku', label: 'Haiku', description: 'Fast and cost-effective' },
];
```

## Proposed Architecture

### Option A: Add to Features Hijacked Scroll

- Expand from 6 to 8 feature slides
- Setup Wizard as slide 7
- OpenRouter as slide 8

### Option B: Separate "Premium Features" Section

- New section after Comparison
- Two side-by-side showcases
- Uses `agsp-parallax-split-scroll` like comparison

### Option C: Interactive Demo Section

- New pinned section with tabs
- Tab 1: Wizard walkthrough
- Tab 2: Model selector demo
- Uses `scrollSectionPin` for pinning

## Dependencies

- TASK_2025_104 must complete first (landing page foundation)
- May need assets: wizard screenshots, model icons
- May need demo data: sample project analysis results

## Success Criteria

1. Setup Wizard feature prominently showcased
2. OpenRouter model mapping explained visually
3. Consistent with TASK_2025_104 design language
4. Uses angular-gsap advanced components
5. Mobile responsive
6. Build passes with no errors

## Related Files

### Setup Wizard

- `libs/frontend/setup-wizard/CLAUDE.md` - Full documentation
- `libs/frontend/setup-wizard/src/lib/components/` - All 6 step components
- `libs/frontend/setup-wizard/src/lib/services/setup-wizard-state.service.ts`

### OpenRouter

- `libs/frontend/chat/src/lib/settings/openrouter-model-selector.component.ts`
- `libs/backend/agent-sdk/src/lib/openrouter-models.service.ts`
- `apps/ptah-extension-vscode/src/services/rpc/handlers/openrouter-rpc.handlers.ts`

## Notes

- This is a complementary task to TASK_2025_104
- Can be started after TASK_2025_104 reaches development phase
- May inform content updates to `docs/content/LANDING_PAGE.md`
