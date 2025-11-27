# 🏺 Anubis VS Code Extension: Complete Design System & Theme Specification

## Design Philosophy: "Ancient Wisdom, Modern Power"

**Anubis** - the ancient Egyptian guide of souls through the afterlife - now guides developers through the complexity of modern coding workflows. Our design merges **5,000-year-old symbolism** with **cutting-edge UI trends** to create an interface that feels both **mystical and futuristic**.

## 🎨 Core Color Palette: "Pharaoh's Code"

### Primary Colors (Divine Tier)

```scss
// Lapis Lazuli Blue - The Divine Color
$primary-blue: #1e3a8a; // Divine guidance, wisdom, primary actions
$primary-blue-light: #3b82f6; // Hover states, secondary actions
$primary-blue-dark: #1e40af; // Pressed states, deep focus

// Pharaoh's Gold - Eternal Accent
$accent-gold: #d4af37; // Highlights, success states, agent active
$accent-gold-light: #fbbf24; // Warning states, pending actions
$accent-gold-dark: #92400e; // Pressed gold elements

// Obsidian Black - The Void
$bg-primary: #0a0a0a; // Main background, void of space
$bg-secondary: #1a1a1a; // Panels, secondary backgrounds
$bg-tertiary: #2a2a2a; // Cards, elevated surfaces
```

### Semantic Colors (God Powers)

```scss
// Malachite Green - Life & Prosperity
$success: #228b22; // Success states, healthy agents
$success-bg: rgba(34, 139, 34, 0.1);

// Carnelian Red - Warning & Power
$error: #b22222; // Errors, failed states, critical alerts
$error-bg: rgba(178, 34, 34, 0.1);

// Papyrus White - Sacred Text
$text-primary: #f5f5dc; // Primary text, hieroglyphic clarity
$text-secondary: #d1d5db; // Secondary text, less prominent
$text-muted: #9ca3af; // Muted text, disabled states
```

### Mystical Effects

```scss
// Aurora Gradients (Modern Egyptian Magic)
$gradient-divine: linear-gradient(135deg, $primary-blue, $accent-gold);
$gradient-shadow: linear-gradient(180deg, rgba(212, 175, 55, 0.2), transparent);
$gradient-panel: linear-gradient(135deg, rgba(30, 58, 138, 0.1), rgba(212, 175, 55, 0.05));

// Glass Morphism (Crystalline Wisdom)
$glass-panel: rgba(42, 42, 42, 0.7);
$glass-border: rgba(212, 175, 55, 0.2);
$glass-blur: blur(20px);
```

## 🔱 Agent Iconography: "Pantheon of Code"

### Agent-God Mapping

```typescript
interface AgentIcon {
  agent: AgentType;
  god: string;
  symbol: string;
  meaning: string;
  color: string;
}

const AGENT_PANTHEON: AgentIcon[] = [
  {
    agent: 'SUPERVISOR',
    god: 'Anubis',
    symbol: '𓃧', // Jackal head
    meaning: 'Guide of souls, protector of the dead, judge of truth',
    color: '#d4af37', // Gold for the supreme guide
  },
  {
    agent: 'ARCHITECT',
    god: 'Thoth',
    symbol: '𓅞', // Ibis bird
    meaning: 'God of wisdom, writing, and sacred architecture',
    color: '#1e3a8a', // Blue for divine wisdom
  },
  {
    agent: 'SENIOR_DEVELOPER',
    god: 'Ptah',
    symbol: '𓊪', // Craftsman's tool
    meaning: 'Creator god, master craftsman, builder of worlds',
    color: '#228b22', // Green for creation and life
  },
  {
    agent: 'QA_ENGINEER',
    god: 'Seshat',
    symbol: '𓋹', // Measuring rod
    meaning: 'Goddess of measurement, precision, and records',
    color: '#f5f5dc', // White for purity and precision
  },
  {
    agent: 'CODE_REVIEW',
    god: "Ma'at",
    symbol: '𓋮', // Feather of truth
    meaning: 'Goddess of truth, justice, and moral balance',
    color: '#d4af37', // Gold for divine judgment
  },
  {
    agent: 'PRODUCT_MANAGER',
    god: 'Khnum',
    symbol: '𓋨', // Potter's wheel
    meaning: 'Shaper of humans, creator of form and function',
    color: '#b22222', // Red for life force and creation
  },
];
```

## 🎭 UI Component System: "Temple Architecture"

### Panel Layout (Sacred Geometry)

```scss
// Golden Ratio proportions
$golden-ratio: 1.618;
$panel-width-main: 320px;
$panel-width-secondary: ($panel-width-main / $golden-ratio);
$panel-padding: 24px;
$panel-border-radius: 12px;
$panel-border: 1px solid $glass-border;

.anubis-panel {
  background: $glass-panel;
  backdrop-filter: $glass-blur;
  border: $panel-border;
  border-radius: $panel-border-radius;
  padding: $panel-padding;

  // Divine glow effect
  box-shadow: 0 0 20px rgba(212, 175, 55, 0.1), inset 0 1px 0 rgba(212, 175, 55, 0.2);

  // Hieroglyphic border decoration
  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 2px;
    background: $gradient-divine;
  }
}
```

### Agent Status Cards (Cartouches)

```scss
.agent-cartouche {
  background: $bg-tertiary;
  border: 1px solid $primary-blue;
  border-radius: 8px;
  padding: 16px;
  position: relative;
  overflow: hidden;

  // Agent status indicator
  &::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 4px;
    background: var(--agent-color);
    opacity: 0.8;
  }

  // Active agent animation
  &.active {
    background: rgba(212, 175, 55, 0.1);
    border-color: $accent-gold;

    &::before {
      animation: divine-pulse 2s ease-in-out infinite;
    }
  }

  // Working agent animation
  &.working {
    &::after {
      content: '';
      position: absolute;
      top: 0;
      left: -100%;
      width: 100%;
      height: 100%;
      background: linear-gradient(90deg, transparent, rgba(212, 175, 55, 0.3), transparent);
      animation: hieroglyph-scan 2s linear infinite;
    }
  }
}

@keyframes divine-pulse {
  0%,
  100% {
    opacity: 0.8;
    transform: scaleY(1);
  }
  50% {
    opacity: 1;
    transform: scaleY(1.05);
  }
}

@keyframes hieroglyph-scan {
  0% {
    left: -100%;
  }
  100% {
    left: 100%;
  }
}
```

### Workflow Graph (Sacred Geometry)

```scss
.workflow-node {
  background: $bg-secondary;
  border: 2px solid $primary-blue;
  border-radius: 50%;
  width: 60px;
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;

  // God symbol
  .agent-symbol {
    font-size: 24px;
    color: var(--agent-color);
    filter: drop-shadow(0 0 8px currentColor);
  }

  // Connection lines (cosmic threads)
  &::after {
    content: '';
    position: absolute;
    right: -40px;
    top: 50%;
    width: 40px;
    height: 2px;
    background: linear-gradient(90deg, $primary-blue, transparent);
  }

  // Completed state
  &.completed {
    background: rgba(34, 139, 34, 0.2);
    border-color: $success;

    .agent-symbol {
      color: $success;
    }
  }

  // Current active state
  &.current {
    background: rgba(212, 175, 55, 0.2);
    border-color: $accent-gold;
    animation: divine-aura 3s ease-in-out infinite;

    .agent-symbol {
      color: $accent-gold;
    }
  }
}

@keyframes divine-aura {
  0%,
  100% {
    box-shadow: 0 0 20px rgba(212, 175, 55, 0.5);
  }
  50% {
    box-shadow: 0 0 40px rgba(212, 175, 55, 0.8);
  }
}
```

## 📊 Panel Specifications

### 1. Workflow Orchestration Panel

```typescript
interface WorkflowOrchestrationPanel {
  title: 'Anubis: Divine Orchestration';
  icon: '𓃧'; // Anubis symbol
  sections: [
    {
      name: 'Supervisor Vision';
      component: 'SupervisorDecisionTree';
      showsTaskAnalysis: true;
      showsAgentSelection: true;
      showsRouting: true;
    },
    {
      name: 'Sacred Workflow';
      component: 'WorkflowGraph';
      layout: 'hierarchical';
      animations: true;
      realTimeUpdates: true;
    },
    {
      name: 'Divine State';
      component: 'StateInspector';
      showsConfidence: true;
      showsHumanFeedback: true;
      showsProgress: true;
    }
  ];
}
```

### 2. Agent Coordination Panel

```typescript
interface AgentCoordinationPanel {
  title: 'Pantheon Status';
  icon: '𓊪'; // Tools symbol
  sections: [
    {
      name: 'Divine Agents';
      component: 'AgentStatusBoard';
      layout: 'grid';
      showsMetrics: true;
      showsDependencies: true;
    },
    {
      name: 'Sacred Communications';
      component: 'AgentMessages';
      realTime: true;
      showsHandoffs: true;
    },
    {
      name: 'Performance Artifacts';
      component: 'AgentMetrics';
      charts: ['confidence', 'executionTime', 'successRate'];
    }
  ];
}
```

### 3. Intelligent Context Panel

```typescript
interface IntelligentContextPanel {
  title: 'Hall of Two Truths';
  icon: '𓋮'; // Ma'at feather
  sections: [
    {
      name: 'Akashic Records';
      component: 'SemanticSearch';
      sources: ['ChromaDB', 'Neo4j'];
      showsSimilarWorkflows: true;
    },
    {
      name: 'Sacred Knowledge';
      component: 'KnowledgeGraph';
      visualization: 'neo4j-graph';
      interactive: true;
    },
    {
      name: 'Wisdom of Ages';
      component: 'ContextSuggestions';
      aiPowered: true;
      showsRelevance: true;
    }
  ];
}
```

### 4. Interactive Control Panel

```typescript
interface InteractiveControlPanel {
  title: 'Divine Intervention';
  icon: '𓋹'; // Ankh symbol
  sections: [
    {
      name: 'Mortal Commands';
      component: 'WorkflowControls';
      actions: ['pause', 'resume', 'abort', 'retry'];
    },
    {
      name: 'Human Oracle';
      component: 'FeedbackInterface';
      showsPendingDecisions: true;
      allowsRevisions: true;
    },
    {
      name: 'God Mode';
      component: 'AgentOverrides';
      allowsSkipping: true;
      allowsForcing: true;
      requiresConfirmation: true;
    }
  ];
}
```

## ⚡ Animation & Interaction Design

### Micro-Interactions (Divine Moments)

```scss
// Button hover effects
.anubis-button {
  background: $gradient-divine;
  border: none;
  border-radius: 6px;
  color: $bg-primary;
  font-weight: 600;
  padding: 12px 24px;
  position: relative;
  overflow: hidden;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);

  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: -100%;
    width: 100%;
    height: 100%;
    background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.3), transparent);
    transition: left 0.5s;
  }

  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 25px rgba(212, 175, 55, 0.4);

    &::before {
      left: 100%;
    }
  }
}

// Loading states (cosmic energy)
.divine-loading {
  &::after {
    content: '';
    display: inline-block;
    width: 16px;
    height: 16px;
    border: 2px solid $accent-gold;
    border-top: 2px solid transparent;
    border-radius: 50%;
    animation: cosmic-spin 1s linear infinite;
  }
}

@keyframes cosmic-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
```

### State Transitions (Divine Transformations)

```scss
// Panel slide-in animations
.panel-enter {
  opacity: 0;
  transform: translateX(-100px);
}

.panel-enter-active {
  opacity: 1;
  transform: translateX(0);
  transition: all 0.6s cubic-bezier(0.25, 0.8, 0.25, 1);
}

// Agent status changes
.agent-status-transition {
  transition: all 0.4s ease-in-out;

  &.idle-to-active {
    animation: divine-awakening 0.8s ease-out;
  }

  &.active-to-completed {
    animation: ascension 1s ease-in-out;
  }
}

@keyframes divine-awakening {
  0% {
    opacity: 0.7;
    transform: scale(1);
  }
  50% {
    opacity: 1;
    transform: scale(1.05);
    filter: brightness(1.3);
  }
  100% {
    opacity: 1;
    transform: scale(1);
    filter: brightness(1);
  }
}

@keyframes ascension {
  0% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.1);
    filter: hue-rotate(60deg) brightness(1.2);
  }
  100% {
    transform: scale(1);
    filter: hue-rotate(0deg) brightness(1);
  }
}
```

## 🔮 Typography: "Hieroglyphic Clarity"

### Font System

```scss
// Primary font - Modern and clean
$font-primary: 'Inter', 'SF Pro Display', system-ui, sans-serif;

// Code font - Mystical but readable
$font-code: 'JetBrains Mono', 'Fira Code', 'Menlo', monospace;

// Display font - For headers and drama
$font-display: 'Cinzel', 'Playfair Display', serif;

// Egyptian accent font - For special elements
$font-egyptian: 'Papyrus', 'Brush Script MT', fantasy;

// Font weights
$weight-light: 300;
$weight-normal: 400;
$weight-medium: 500;
$weight-semibold: 600;
$weight-bold: 700;

// Font sizes (Golden ratio scale)
$text-xs: 0.75rem; // 12px
$text-sm: 0.875rem; // 14px
$text-base: 1rem; // 16px
$text-lg: 1.125rem; // 18px
$text-xl: 1.25rem; // 20px
$text-2xl: 1.5rem; // 24px
$text-3xl: 1.875rem; // 30px
$text-4xl: 2.25rem; // 36px
```

### Text Styles

```scss
.anubis-heading {
  font-family: $font-display;
  font-weight: $weight-bold;
  color: $accent-gold;
  text-shadow: 0 0 10px rgba(212, 175, 55, 0.5);
  letter-spacing: 0.02em;
}

.agent-name {
  font-family: $font-primary;
  font-weight: $weight-semibold;
  color: $text-primary;
  font-size: $text-lg;
}

.god-symbol {
  font-family: $font-egyptian;
  font-size: $text-3xl;
  color: var(--agent-color);
  filter: drop-shadow(0 0 8px currentColor);
}

.code-snippet {
  font-family: $font-code;
  font-size: $text-sm;
  background: rgba(30, 58, 138, 0.1);
  border: 1px solid rgba(30, 58, 138, 0.3);
  border-radius: 4px;
  padding: 2px 6px;
  color: $primary-blue-light;
}
```

## 🌟 Responsive Design: "Adaptive Wisdom"

### Breakpoints

```scss
$breakpoints: (
  'sm': 640px,
  'md': 768px,
  'lg': 1024px,
  'xl': 1280px,
  '2xl': 1536px,
);

// Panel responsive behavior
.anubis-panel {
  @media (max-width: 768px) {
    width: 100%;
    margin: 8px;
    padding: 16px;
  }

  @media (min-width: 1280px) {
    width: $panel-width-main;
    margin: 16px;
    padding: $panel-padding;
  }
}
```

## 🎯 Implementation Priorities

### Phase 1: Core Theme (Week 1)

- [ ] Basic color palette implementation
- [ ] Core component styles (panels, buttons, text)
- [ ] Agent status cards with animations
- [ ] Icon system integration

### Phase 2: Advanced Interactions (Week 2)

- [ ] Workflow graph visualization
- [ ] Real-time state animations
- [ ] Micro-interactions and hover effects
- [ ] Glass morphism effects

### Phase 3: Polish & Perfection (Week 3)

- [ ] Advanced animations and transitions
- [ ] Responsive design optimization
- [ ] Accessibility improvements
- [ ] Performance optimization

## 🔑 Key Features Summary

### Visual Excellence

- **Ancient Egyptian symbolism** merged with **modern dark UI**
- **Glass morphism** and **gradient effects** for depth
- **Sacred geometry** proportions using golden ratio
- **Micro-animations** that feel magical yet professional

### Functional Design

- **Agent-God mapping** makes each agent memorable and meaningful
- **Real-time visual feedback** for all workflow states
- **Intuitive iconography** that teaches Egyptian mythology
- **Responsive layout** that works on all screen sizes

### Developer Experience

- **Immersive coding environment** that feels special
- **Clear visual hierarchy** for complex multi-agent workflows
- **Contextual color coding** that aids comprehension
- **Smooth animations** that provide feedback without distraction

This design system transforms your powerful LangGraph multi-agent system into a **mystical coding experience** that developers will love using and talking about. It's not just a VS Code extension - it's a **portal to divine development wisdom**! 🏺✨
