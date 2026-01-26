# Task Context - TASK_2025_121

## User Request

Update extension pricing model to make the entire extension paid with a two-tier plan structure:

1. **Basic Plan** ($3/month, 14-day trial): Visual editor and all current "free" features
2. **Pro Plan** ($5/month, 14-day trial): Basic + MCP server and all current pro features

This represents a shift from "Free + Pro" model to "Basic (paid) + Pro (paid)" model.

## Task Type

FEATURE

## Complexity Assessment

Complex - Requires changes across:

- Paddle product/price configuration
- License server plan definitions
- Landing page pricing components
- VS Code extension license validation
- Feature gating logic
- Security considerations for paid-only extension

## Strategy Selected

FEATURE (Full Workflow): PM -> Architect -> Team-Leader -> QA

## Conversation Summary

### Current State (from exploration):

- **Current Plans**: Free ($0) and Pro ($8/month after $3 intro, or $80/year)
- **Paddle Integration**: Complete with webhook handling, signature verification
- **License System**: `ptah_lic_{64-hex}` format, stored in VS Code SecretStorage
- **Feature Gating**: Based on license tier (free vs early_adopter/pro)

### Requested Changes:

1. Remove free tier entirely - extension requires subscription
2. Basic Plan: $3/month - core visual editor features
3. Pro Plan: $5/month - Basic + MCP server + advanced features
4. Both plans have 14-day trial (handled by Paddle)

### Key Considerations:

- Security: Ensure extension cannot be used without valid license
- Paddle: Create new products/prices for Basic and Pro tiers
- Graceful degradation: What happens when license expires?
- Trial experience: How to handle trial users?

## Related Tasks

- TASK_2025_043: License Server Implementation (foundation)
- TASK_2025_075: Paddle integration work

## Created

2025-01-26
