# Ptah Core Prompt - Mapping to Claude Code Preset

**TASK_2025_137 Batch 1 Analysis**

This document maps Anthropic's `claude_code` preset sections to our `PTAH_CORE_SYSTEM_PROMPT` strategy.

---

## Mapping Strategy

| Claude Code Section          | Ptah Strategy      | Notes                                    |
| ---------------------------- | ------------------ | ---------------------------------------- |
| **Identity Preamble**        | ADAPT              | Change "CLI" → "VS Code Extension"       |
| **Tone and Style**           | ADAPT              | Keep, but add webview rendering context  |
| **Professional Objectivity** | KEEP AS-IS         | Excellent guidance, no changes needed    |
| **No Time Estimates**        | KEEP AS-IS         | Excellent guidance, no changes needed    |
| **Asking Questions**         | ENHANCE            | AskUserQuestion is CRITICAL for Ptah UX  |
| **Doing Tasks**              | KEEP AS-IS         | Excellent guidance, critical for quality |
| **Tool Usage Policy**        | ADAPT              | Keep, but Ptah-specific tool notes       |
| **Git Workflows**            | KEEP AS-IS         | Essential, no extension-specific changes |
| **PR Workflows**             | KEEP AS-IS         | Essential, no extension-specific changes |
| **Code References**          | KEEP AS-IS         | file_path:line_number pattern            |
| **Dynamic Sections**         | PROVIDED BY PRESET | Still use `preset: 'claude_code'`        |

---

## What the `claude_code` Preset Still Provides

When we use `preset: 'claude_code'`, we get these automatically:

- Tool definitions (Read, Write, Edit, Bash, Glob, Grep, Task, etc.)
- Dynamic environment info (working directory, platform, date)
- Model info injection
- MCP server instructions
- CLAUDE.md file loading
- Skill definitions

**We do NOT need to replicate these in PTAH_CORE_SYSTEM_PROMPT.**

---

## What PTAH_CORE_SYSTEM_PROMPT Should Override/Append

### 1. Identity (Override)

- **Claude Code**: "CLI tool"
- **Ptah**: "VS Code Extension with webview interface"

### 2. Output Context (Override)

- **Claude Code**: "command line interface, monospace font"
- **Ptah**: "webview panel with enhanced markdown rendering"

### 3. AskUserQuestion (Enhance)

- **Claude Code**: Brief mention
- **Ptah**: MANDATORY with schema, examples, and strict rules

### 4. Rich Formatting (Add)

- **Claude Code**: Basic markdown
- **Ptah**: Callouts, gold dividers, step cards, language badges

### 5. Everything Else (Keep via Append)

- Professional Objectivity
- No Time Estimates
- Doing Tasks (full section)
- Tool Usage Policy
- Git Safety Protocol
- Commit Workflow
- PR Workflow
- Code References

---

## Token Budget Analysis

| Section                    | Est. Tokens | Include?            |
| -------------------------- | ----------- | ------------------- |
| Identity + Environment     | ~150        | Yes (adapted)       |
| AskUserQuestion (enhanced) | ~400        | Yes (critical)      |
| Tone and Style             | ~200        | Yes (adapted)       |
| Professional Objectivity   | ~150        | Yes (keep)          |
| No Time Estimates          | ~100        | Yes (keep)          |
| Doing Tasks                | ~400        | Yes (keep)          |
| Tool Usage Policy          | ~250        | Yes (keep)          |
| Git Safety + Workflow      | ~500        | Yes (keep)          |
| PR Workflow                | ~350        | Yes (keep)          |
| Code References            | ~50         | Yes (keep)          |
| Rich Formatting            | ~200        | Yes (Ptah-specific) |
| **Total**                  | **~2,750**  |                     |

This is larger than our initial 900-token prompt, but it preserves Anthropic's carefully crafted behavioral guidance that drives quality.

---

## Recommendation

**Update PTAH_CORE_SYSTEM_PROMPT to be comprehensive (~2,500-3,000 tokens):**

1. **Adapt** identity and output context for VS Code extension
2. **Enhance** AskUserQuestion with mandatory usage rules
3. **Add** Ptah-specific rich formatting guidelines
4. **Include** all of Anthropic's behavioral guidance (they've refined this extensively)

The `claude_code` preset still provides tool definitions and dynamic sections. Our prompt adds extension-specific context and preserves behavioral excellence.

---

## Architecture Decision

```
┌─────────────────────────────────────────────────────────────┐
│  SDK Query Configuration                                     │
├─────────────────────────────────────────────────────────────┤
│  systemPrompt: {                                             │
│    type: 'preset',                                           │
│    preset: 'claude_code',  ← Provides tools + dynamic info   │
│    append: PTAH_CORE_SYSTEM_PROMPT  ← Our comprehensive      │
│            + power-ups + custom sections    behavioral guide │
│  }                                                           │
└─────────────────────────────────────────────────────────────┘
```

This approach:

- Preserves Anthropic's tool infrastructure
- Overrides/enhances behavioral guidance
- Adapts for extension context
- Maintains quality standards

---

## Next Steps

1. Expand PTAH_CORE_SYSTEM_PROMPT with full behavioral guidance
2. Keep it organized with clear sections
3. Ensure AskUserQuestion is prominently featured
4. Include git/PR workflows (users love these)
