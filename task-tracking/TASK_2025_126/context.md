# TASK_2025_126 - Context

## User Request

Implement embedded welcome page for unlicensed users - Replace the VS Code modal popup with an embedded welcome page inside the extension webview. When users don't have a valid license, instead of showing a blocking modal, show an embedded "Welcome" view with Ptah branding, license key entry, pricing links, and trial start options.

## Task Type

**FEATURE** - New functionality to improve user onboarding experience

## Complexity Assessment

**Medium-High** - Multiple files across frontend and backend, new component, RPC handlers

## Affected Areas

1. **Backend (Extension Host)**
   - `apps/ptah-extension-vscode/src/main.ts` - License check flow, webview initialization
   - RPC handlers for license operations from webview

2. **Frontend (Webview)**
   - `libs/frontend/core/src/lib/services/app-state.service.ts` - Add 'welcome' ViewType
   - `libs/frontend/chat/src/lib/components/templates/app-shell.component.html` - Render welcome view
   - New `WelcomeComponent` - Full-page onboarding UI

3. **Shared Types**
   - May need new message types for license RPC

## Current Behavior

When extension activates with no valid license:
1. `showLicenseRequiredUI()` shows VS Code modal popup with `vscode.window.showWarningMessage()`
2. Modal has buttons: "Start Trial", "Enter License Key", "View Pricing", "Cancel"
3. Extension activation is blocked - webview never shown

## Desired Behavior

When extension activates with no valid license:
1. Webview is shown with `initialView: 'welcome'`
2. Welcome page displays embedded inside the webview:
   - Ptah branding/logo
   - "Enter License Key" action
   - "View Pricing" action
   - "Start Trial" action
   - Feature highlights/benefits
3. After successful license entry, navigate to 'chat' view

## Strategy

**FEATURE Strategy**: PM → Architect → Team-Leader → QA

## Created

2026-01-27

## Status

📋 Initialized - Ready for Project Manager
