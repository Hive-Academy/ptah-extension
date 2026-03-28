# TASK_2025_230: Open Source Preparation — FSL License + Security Audit

## User Intent

Prepare the Ptah extension codebase for source-available open sourcing under FSL-1.1-MIT license. Two critical workstreams must be completed before the repository can be made public.

## Workstream 1: Security Audit

Full security sweep to ensure NO production secrets would leak:

- Hardcoded secrets/keys/tokens in source files
- Production URLs, database connection strings
- Private signing keys (Ed25519 for license signing)
- .env files, credentials in git history
- License server production config
- Paddle/WorkOS/Resend API keys or webhook secrets
- Hardcoded IPs, internal infrastructure URLs

## Workstream 2: FSL License Migration

Switch from MIT to FSL-1.1-MIT:

- Draft LICENSE file with official FSL-1.1-MIT text
- Update package.json license fields
- Add license header template
- Update README with license section
- Configure CLA for GitHub contributions

## Strategy

- Type: DEVOPS + RESEARCH (hybrid)
- Depth: Partial (skip PM, parallel execution)
- Agents: researcher-expert (security) || researcher-expert (FSL) → devops-engineer → code-logic-reviewer

## Motivation

- VS Code Marketplace flagged extension for "suspicious content" — open sourcing builds trust
- $5/month Pro model means open sourcing is net positive for adoption
- FSL-1.1-MIT protects against competing forks while allowing full source visibility
