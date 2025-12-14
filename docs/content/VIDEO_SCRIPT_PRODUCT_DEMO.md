# Video Script: Ptah Product Demo

## Metadata

- **Length**: 3-4 minutes
- **Type**: Product Demo
- **Audience**: Developers using or interested in Claude Code
- **Goal**: Show Ptah in action, drive VS Code Marketplace installs

---

## HOOK (0:00-0:15)

### Visual

_VS Code opens with Ptah sidebar visible. A chat interface with Claude appears._

### Narration

"Love Claude Code? Imagine it native to VS Code - powered by the official Agent SDK, with superpowers you can't get anywhere else."

### Action

_Quick montage: typing a message → instant response streaming → file creation → code highlighting_

---

## THE WISH (0:15-0:45)

### Visual

_Developer working in VS Code, then switching to terminal for Claude Code_

### Narration

"You love Claude Code. But sometimes you wish it was right here in your editor - without switching contexts. Visual session management. Your workspace automatically understood. And some extra abilities Claude doesn't have out of the box."

### B-Roll

- [ ] Developer alt-tabbing between VS Code and terminal
- [ ] Looking at file tree while typing in terminal
- [ ] Scrolling through conversation history

### Visual

_Smooth transition to integrated experience_

### Narration

"That's what Ptah is built for."

---

## SOLUTION INTRO (0:45-1:15)

### Visual

_Clean transition to Ptah interface in VS Code_

### Narration

"Ptah brings Claude Code's power directly into VS Code. Built on the official Agent SDK. Native integration. Real-time streaming. Plus some unique superpowers."

### Key Visual

_Hero shot: Ptah chat panel with conversation, sidebar with session history_

### Action

_Mouse hovers over different UI elements: chat input, session tabs, settings_

---

## DEMO SEGMENT 1: SDK Integration (1:15-1:45)

### Visual

_Start new session in Ptah_

### Narration

"Ptah is built directly on the official Claude Agent SDK. That means native TypeScript integration - fast session creation, smooth streaming, and direct access to SDK features."

### Action

_Click "New Session" → immediate response_

### Narration

"Everything feels responsive and integrated because it's using the SDK the way it was designed to be used."

### Code Callout (on screen):

```
Powered by @anthropic-ai/claude-agent-sdk
├── Native TypeScript integration
├── Direct streaming support
├── Session management built-in
└── Official Anthropic SDK
```

---

## DEMO SEGMENT 2: MCP Superpowers (1:45-2:30)

### Visual

_Type a complex request in chat_

### Narration

"But speed is just the beginning. Ptah includes an MCP server that gives Claude abilities it doesn't have in vanilla Claude Code."

### Action

_Type: "Find all authentication-related files in this project and explain how auth works"_

### Visual

_Claude's response showing it queried ptah.search and ptah.symbols_

### Narration

"Watch this. I asked Claude to find auth files. It didn't ask me to list them - it queried Ptah's API directly. Search, symbols, diagnostics, git - 8 APIs at Claude's fingertips."

### Code Callout (on screen):

```typescript
// Claude executed:
const files = await ptah.search.findFiles({
  query: 'authentication',
  maxResults: 10,
});
// Found 7 relevant files automatically
```

---

## DEMO SEGMENT 3: Workspace Intelligence (2:30-3:00)

### Visual

_Open a new project, show Ptah's project detection_

### Narration

"Ptah understands your project. Watch what happens when I open an Nx monorepo."

### Action

_Open folder → Ptah status shows "Angular project detected | Nx monorepo | 12 packages"_

### Narration

"13 project types. 6 monorepo tools. Automatically detected. Claude starts every conversation knowing your tech stack."

### Visual

_Show project info panel: frameworks, dependencies, structure_

---

## PROOF (3:00-3:30)

### Visual

_Side-by-side: Ptah vs CLI interaction_

### Narration

"The result? Less explaining, more building. Claude answers based on your actual code, not guesses. Errors get fixed because Claude can see your diagnostics panel. Context-building theater is eliminated."

### Data Points (on screen):

```
12 specialized backend libraries
48+ Angular UI components
8 Ptah API namespaces for Claude
5 LLM providers supported
```

### Narration

"This isn't a pretty wrapper. It's 12 specialized libraries working together to make AI coding actually fast."

---

## CTA (3:30-4:00)

### Visual

_VS Code Marketplace page for Ptah_

### Narration

"Ptah is free to install from the VS Code Marketplace. If you're using Claude Code, you owe it to yourself to try this."

### On-Screen

- URL: marketplace.visualstudio.com/items/ptah
- Button: "Install Free"

### Narration

"Link in the description. Your Claude agent is about to get a lot more powerful."

### Visual

_End card with Ptah logo, social links, "Try Now" button_

---

## B-ROLL SHOT LIST

| Timestamp | Description                         | Source                     |
| --------- | ----------------------------------- | -------------------------- |
| 0:15      | Terminal with visible latency       | Screen recording           |
| 0:30      | Copy-paste workflow                 | Screen recording           |
| 1:15      | Session creation with timer overlay | Screen recording + graphic |
| 1:45      | MCP server response                 | Ptah chat interface        |
| 2:30      | Project detection notification      | Ptah UI                    |
| 3:00      | Side-by-side comparison             | Split screen recording     |

## TECHNICAL REQUIREMENTS

### Code Snippets Needed

1. Performance comparison graphic (CLI vs SDK)
2. ptah.search example code overlay
3. Project detection stats

### UI Screenshots/Recordings

1. Ptah chat interface (clean, no distractions)
2. Session tabs / history panel
3. Project info panel
4. Settings page

### Diagrams to Create

1. "8 Ptah API namespaces" visual
2. Performance comparison bar chart
3. Architecture flow (optional)

---

## NARRATION NOTES

- **Pace**: Fast in hook, slower during demos
- **Tone**: Confident, technical, not salesy
- **Avoid**: "Revolutionary", "Amazing", "Best" - show, don't tell
- **Include**: Specific numbers, actual code, real UI

## MUSIC/SOUND

- Hook: Upbeat, attention-grabbing
- Demo: Lower, background
- CTA: Return to upbeat

---

## Technical Validation Checklist

- [x] Performance numbers match agent-sdk CLAUDE.md
- [x] MCP API namespaces accurate (8 total)
- [x] Project detection claims verifiable (13+ types, 6 monorepo)
- [x] All UI shown is actual Ptah interface
- [x] No features shown that don't exist
