# TASK_2025_129 Context

## User Request

Investigate and plan improvements to Claude agent authentication settings in the Ptah extension.

## Three Key Areas

1. **OpenRouter Premium Gating**: OpenRouter authentication is currently gated as a Premium/Pro feature but should be available to all users (Community tier included)
2. **User Profile Display**: No way to display the currently authenticated user's information in the extension settings page
3. **Authentication Flow Review**: Review the overall authentication flow (OpenRouter, OAuth, API Key) and how users authenticate with the Claude SDK

## Context

- Extension uses freemium model: Community (free) + Pro ($5/mo)
- All users have internet access (requirement for Claude Code)
- License server API exists and could return user information
- Settings page currently shows auth method selector but no user identity
- Log file shows AuthManager errors when no auth configured
- OpenRouter appears gated behind Pro tier in some places

## Strategy

RESEARCH → Conditional FEATURE implementation

## Task ID

TASK_2025_129

## Created

2026-01-29
