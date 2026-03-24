# Research Report: Anthropic Claude OAuth Policy Changes for Third-Party Extensions

**Date**: 2026-03-13
**Confidence Level**: 95% (based on official documentation + 20+ corroborating sources)
**Classification**: STRATEGIC - Direct impact on Ptah extension architecture

---

## Executive Summary

Anthropic has officially banned all third-party tools from using Claude consumer subscription OAuth tokens. As of January 9, 2026, server-side enforcement blocks any non-Claude-Code application from authenticating via OAuth tokens obtained through Free, Pro, or Max subscriptions. The policy was formally documented on February 19, 2026. This directly impacts any VS Code extension (including Ptah) that planned to authenticate users via Claude OAuth and piggyback on their Claude subscriptions.

---

## 1. What Changed

Anthropic introduced both **technical enforcement** and **policy documentation** restricting OAuth token usage to first-party products only.

### The Official Policy (Exact Quote)

From Anthropic's [Legal and Compliance documentation](https://code.claude.com/docs/en/legal-and-compliance):

> **OAuth authentication** (used with Free, Pro, and Max plans) is intended exclusively for Claude Code and Claude.ai. Using OAuth tokens obtained through Claude Free, Pro, or Max accounts in any other product, tool, or service -- including the Agent SDK -- is not permitted and constitutes a violation of the Consumer Terms of Service.

> **Developers** building products or services that interact with Claude's capabilities, including those using the Agent SDK, should use API key authentication through Claude Console or a supported cloud provider. Anthropic does not permit third-party developers to offer Claude.ai login or to route requests through Free, Pro, or Max plan credentials on behalf of their users.

> Anthropic reserves the right to take measures to enforce these restrictions and may do so without prior notice.

### Key Points

- OAuth tokens from Free/Pro/Max accounts are **exclusively** for Claude Code and Claude.ai
- The ban explicitly includes Anthropic's own **Agent SDK** when used by third parties
- Third-party developers **cannot** offer Claude.ai login flows
- Third-party developers **cannot** route requests through consumer plan credentials
- Enforcement can happen **without prior notice**

---

## 2. Timeline

| Date                  | Event                                                                                                                                                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **January 9, 2026**   | Anthropic deployed server-side checks blocking third-party tools from using subscription OAuth tokens. Tools received error: "This credential is only authorized for use with Claude Code and cannot be used for other API requests." |
| **January 15, 2026**  | George Hotz published criticism: "Anthropic is making a huge mistake"                                                                                                                                                                 |
| **February 19, 2026** | Anthropic formally updated documentation at code.claude.com/docs/en/legal-and-compliance to codify the OAuth restriction policy                                                                                                       |
| **February 20, 2026** | Major press coverage (The Register, VentureBeat, Gigazine, etc.)                                                                                                                                                                      |

---

## 3. What Was the Old Behavior

Before January 9, 2026:

- Third-party tools could authenticate via Claude OAuth and use the user's subscription
- Tools like OpenCode spoofed Claude Code's client identity via HTTP headers to appear as official Claude Code
- Extensions like Cline, Roo Code, Continue.dev, and custom Agent SDK implementations could leverage consumer OAuth tokens
- Users paying $200/month for Claude Max could use their subscription across any tool
- There was no explicit documentation prohibiting this usage pattern

The economic problem: Claude Max at $200/month is a flat-rate subscription with built-in rate limits in Claude Code. Third-party tools removed those rate limits, enabling autonomous overnight loops that consumed tokens far exceeding the subscription's value. Claude Opus API pricing is $15/M input tokens and $75/M output tokens -- an active agent can burn millions of tokens per day.

---

## 4. What Is the New Policy

### Allowed

- OAuth authentication for **Claude Code** (Anthropic's official CLI/VS Code extension)
- OAuth authentication for **Claude.ai** (Anthropic's web interface)
- API key authentication for **any** third-party tool via Claude Console
- Cloud provider authentication (Amazon Bedrock, Google Vertex AI, Microsoft Foundry)
- Claude for Teams/Enterprise subscriptions with centralized billing

### Explicitly Banned

- Third-party tools using consumer OAuth tokens (Free, Pro, Max plans)
- Third-party tools offering Claude.ai login flows
- Third-party tools routing requests through consumer plan credentials
- Using the Agent SDK with consumer OAuth tokens in third-party products
- Any workaround that presents a third-party tool as Claude Code to Anthropic's servers

---

## 5. Impact on VS Code Extensions

### Directly Affected Tools

| Tool                              | Impact                                               | Status                       |
| --------------------------------- | ---------------------------------------------------- | ---------------------------- |
| **OpenCode** (107k+ GitHub stars) | Primary casualty -- was spoofing Claude Code headers | Blocked, pivoted to API keys |
| **OpenClaw / NanoClaw**           | OAuth routing blocked                                | Blocked                      |
| **Cline**                         | Consumer OAuth broken                                | Must use API keys            |
| **Roo Code**                      | Consumer OAuth broken                                | Must use API keys            |
| **Continue.dev**                  | Consumer OAuth broken                                | Must use API keys            |
| **Custom Agent SDK tools**        | OAuth explicitly banned even for SDK                 | Must use API keys            |

### Impact on Ptah Extension

**Critical**: If Ptah's Copilot OAuth provider feature was designed to authenticate users via Claude's consumer OAuth flow and use their subscription, this approach is now explicitly prohibited by Anthropic's terms of service and technically blocked at the server level.

The current branch `feature/copilot-oauth-provider` should be evaluated against this policy change.

---

## 6. Anthropic's Official Documentation

### Authentication Page (code.claude.com/docs/en/authentication)

Lists these valid authentication methods:

1. **Claude Pro or Max subscription** -- log in with Claude.ai account (for Claude Code only)
2. **Claude for Teams or Enterprise** -- log in with team account
3. **Claude Console** -- API key authentication
4. **Cloud providers** -- Bedrock, Vertex AI, Foundry environment variables

### Legal and Compliance Page (code.claude.com/docs/en/legal-and-compliance)

Contains the explicit OAuth restriction policy quoted above.

### Third-Party Integrations Page (code.claude.com/docs/en/third-party-integrations)

Focuses on enterprise deployment options. Authentication options listed:

- Claude for Teams/Enterprise: Claude.ai SSO or email
- Anthropic Console: API key
- Amazon Bedrock: API key or AWS credentials
- Google Vertex AI: GCP credentials
- Microsoft Foundry: API key or Microsoft Entra ID

**No consumer OAuth option is listed for third-party integrations.**

---

## 7. Recommended Alternatives for Third-Party Tools

Based on Anthropic's documentation and community analysis:

### Option A: Anthropic API Keys (Recommended by Anthropic)

- Users create an API key at console.anthropic.com
- Pay-as-you-go billing ($15/M input, $75/M output for Opus)
- No rate limit gaming -- you pay for what you use
- Supported via `ANTHROPIC_API_KEY` environment variable

### Option B: Cloud Provider Pass-Through

- Amazon Bedrock, Google Vertex AI, Microsoft Foundry
- Users authenticate via their cloud provider credentials
- Billing through existing cloud accounts
- Requires cloud provider setup

### Option C: Claude for Teams/Enterprise

- $150/seat (Premium) with PAYG available
- Centralized billing and team management
- Users get both Claude Code and Claude on web
- SSO support for Enterprise tier

### Option D: VS Code Language Model API (GitHub Copilot)

- Use VS Code's `vscode.lm` API to access models provided by GitHub Copilot
- Not directly related to Anthropic OAuth -- uses Copilot's own authentication
- Limited to models Copilot makes available (currently includes Claude via Copilot)
- Rate limits and policies controlled by GitHub/Microsoft

### Option E: No OAuth at All

- The "missing piece" identified by the community: Anthropic has no sanctioned OAuth flow for third-party applications
- The only option is to ask users to generate an API key and paste it into the tool's settings

---

## 8. Community Response

### Developer Backlash

- **245+ points** on Hacker News across multiple threads
- **147+ reactions** on OpenCode GitHub issue #6930
- Multiple developers **canceled $200/month Max subscriptions**
- GitHub issue #17118 on anthropic/claude-code filled with angry comments

### Notable Criticism

- **George Hotz** (comma.ai, tinygrad founder): "You will not convert people back to Claude Code, you will convert people to other model providers."
- **David Heinemeier Hansson** (Rails creator): "Seems very customer hostile"
- Common sentiment: "Using Claude Code is like going back to the stone age compared to tools like OpenCode"

### Press Coverage

- The Register, VentureBeat, Gigazine, WinBuzzer, The New Stack, and numerous others covered the ban
- Generally framed as Anthropic building a "walled garden"

### Anthropic's Defense

- Anthropic's Thariq Shihipar advised developers to use API keys instead
- Anthropic characterized the documentation update as "clarifying existing policy language"
- The economic argument: flat-rate subscriptions were being exploited for unlimited API-equivalent access

---

## 9. Implications for Ptah Extension

### Direct Impact

1. **Cannot use Claude consumer OAuth** for any Ptah feature that routes requests to Anthropic
2. **Cannot offer "Sign in with Claude"** as an authentication method for end users
3. **Cannot piggyback on user subscriptions** -- even via the Agent SDK

### Recommended Ptah Strategy

1. **API Key Authentication**: Support ANTHROPIC_API_KEY for direct Anthropic access (PAYG)
2. **VS Code LM API**: Continue supporting the `vscode.lm` API for Copilot-provided models (separate from Anthropic OAuth)
3. **Cloud Provider Support**: Support Bedrock/Vertex/Foundry for enterprise users
4. **Multi-Provider Architecture**: The existing multi-provider approach in llm-abstraction is the correct strategy -- it avoids dependency on any single auth mechanism
5. **Remove/Pivot Copilot OAuth for Claude**: If the `feature/copilot-oauth-provider` branch was specifically about authenticating with Anthropic via OAuth, this needs to be reconsidered

### What Still Works

- GitHub Copilot's own OAuth (for Copilot-provided models, not Anthropic directly)
- Anthropic API keys (console.anthropic.com)
- Cloud provider credentials (Bedrock, Vertex, Foundry)
- Claude for Teams/Enterprise accounts

---

## Sources

- [Anthropic Legal and Compliance - Official Policy](https://code.claude.com/docs/en/legal-and-compliance)
- [Anthropic Authentication Documentation](https://code.claude.com/docs/en/authentication)
- [Anthropic Third-Party Integrations](https://code.claude.com/docs/en/third-party-integrations)
- [The Register - Anthropic clarifies ban on third-party tool access](https://www.theregister.com/2026/02/20/anthropic_clarifies_ban_third_party_claude_access/)
- [VentureBeat - Anthropic cracks down on unauthorized Claude usage](https://venturebeat.com/technology/anthropic-cracks-down-on-unauthorized-claude-usage-by-third-party-harnesses)
- [Hacker News Discussion Thread](https://news.ycombinator.com/item?id=47069299)
- [Awesome Agents - Claude Code OAuth Policy Crackdown](https://awesomeagents.ai/news/claude-code-oauth-policy-third-party-crackdown/)
- [Natural 20 - Anthropic Banned OpenClaw](https://natural20.com/coverage/anthropic-banned-openclaw-oauth-claude-code-third-party)
- [ByteIota - Anthropic Blocks Claude Max in OpenCode](https://byteiota.com/anthropic-blocks-claude-max-in-opencode-devs-cancel-200-month-plans/)
- [WinBuzzer - Anthropic Bans Claude Subscription OAuth](https://winbuzzer.com/2026/02/19/anthropic-bans-claude-subscription-oauth-in-third-party-apps-xcxwbn/)
- [The New Stack - Anthropic Agent SDK Confusion](https://thenewstack.io/anthropic-agent-sdk-confusion/)
- [Medium - The Missing Piece in Anthropic's Ecosystem](https://medium.com/@em.mcconnell/the-missing-piece-in-anthropics-ecosystem-third-party-oauth-ccb5addb8810)
- [OpenClaw Blog - Anthropic Banned Third-Party Tools](https://openclaw.rocks/blog/anthropic-oauth-ban)
- [Dev.to - Continue.dev + Claude Max Ban Fix](https://dev.to/robinbanner/continuedev-claude-max-ban-fix-in-60-seconds-1fpo)
- [Gigazine - Anthropic officially bans third-party subscription authentication](https://gigazine.net/gsc_news/en/20260220-anthropic-third-party-block/)
