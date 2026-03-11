# TASK_2025_128: Freemium Model Reversion

## User Request (Verbatim)

> Based on task 121 and 124, I have added and gated all of our extensions against our basic and pro subscription. I want to revert this and go back to only one plan, the current pro plan. The current basic plan should be the free plan, without any need for adding a credit card or doing anything. It should work without any requirements. This will have us to orchestrate a new approval workflow because I have made quite some changes into the extension itself, and also into our back-end, license server, and front-end server. Let's make sure to plan this very carefully.

## Strategy Selection

- **Detected Type**: REFACTORING (revert, change business model)
- **Confidence**: 85%
- **Complexity**: Complex (>8h) - Multi-codebase changes, business model shift

## Current State (Two-Tier Paid Model)

From TASK_2025_121:

- Basic: $3/mo - Core features
- Pro: $5/mo - Premium features (MCP, advanced AI, etc.)
- Both require subscription/credit card

## Target State (Freemium Model)

- Free: Current Basic features - NO login/payment required, works immediately
- Pro: $5/mo - Current Pro features - Requires subscription

## Affected Systems

1. **VS Code Extension** (`ptah-extension-vscode`)

   - License enforcement in welcome flow
   - Feature gating logic
   - Premium checks for MCP, advanced features

2. **License Server** (`ptah-license-server`)

   - Plan definitions
   - License creation/verification
   - Trial handling logic

3. **Landing Page** (`ptah-landing-page`)
   - Pricing page (one paid plan instead of two)
   - Marketing copy
   - Checkout flow (Pro only)

## Key Considerations

1. **Existing Basic Subscribers**: How to handle users who paid for Basic?

   - Option A: Automatically upgrade to Pro (they paid, give them more)
   - Option B: Refund and convert to free tier
   - Option C: Honor until period ends, then convert to free

2. **Extension Behavior Change**:

   - Current: Requires license for ALL usage
   - Target: Works immediately, Pro features gated

3. **Backend Changes**:
   - Plan definitions need update
   - License verification logic changes
   - May need migration for existing users

## Related Tasks

- TASK_2025_121: Two-Tier Paid Extension Model (to be reverted)
- TASK_2025_124: Subscription Enforcement Audit
- TASK_2025_126: Embedded Welcome Page (may need updates)

## User Decisions

### Migration (Not Applicable)

- Not live yet, no existing subscribers to migrate

### Tier Naming

- Free tier: **Community**
- Paid tier: **Pro** ($5/mo, $50/yr)

### Pricing Page UI

- **Community + Pro comparison**: Show both tiers side-by-side so users understand what's free vs paid

### Upsell Strategy

- **Subtle status bar indicator**: Small 'Community' badge in status bar that links to upgrade when clicked
- No intrusive popups or modals

## Research Complete

See `research-findings.md` for comprehensive analysis of:

- 18+ files requiring changes across 4 codebases
- 5-phase implementation approach
- Risk analysis and success metrics

## Next Step

Invoke project-manager for detailed requirements document
