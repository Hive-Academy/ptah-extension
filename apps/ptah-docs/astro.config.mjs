// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightLinksValidator from 'starlight-links-validator';

const GITHUB_REPO = 'https://github.com/Hive-Academy/PtahCode';
const EDIT_BASE = `${GITHUB_REPO}/edit/main/apps/ptah-docs/`;

export default defineConfig({
  site: 'https://docs.ptah.live',
  redirects: {
    // Setup Wizard moved out of the Agents section into its own Setup group.
    '/agents/setup-wizard': '/setup/setup-wizard/',
    // The file tree page documented @ptah-extension/editor's left-sidebar
    // panel. That library is being retired (TASK_2026_385); the git surface
    // it used to host lives in the Git dock now.
    '/workspace/file-tree': '/git/git-status/',
    '/vscode-extension': '/getting-started/installation/',
    '/cli': '/agents/cli-agents/',
    '/cli/commands': '/agents/cli-agents/',
    '/reference/cli-flags': '/getting-started/installation/',
    '/mcp-and-skills/driving-ptah-via-mcp': '/mcp-and-skills/',
    // Pages removed by the TASK_2026_889 evidence sweep: their topic no
    // longer exists in the desktop app, or the parent page now covers it.
    '/providers/switching': '/chat/switching-models/',
    '/settings/api-keys': '/settings/',
    '/settings/why-not-package-json': '/settings/',
    '/troubleshooting/license-issues': '/getting-started/signing-in/',
    '/reference/tier-comparison': '/reference/',
    '/reference/changelog': '/reference/',
    '/sessions/metadata': '/sessions/',
    '/agents/importing-history': '/agents/',
    '/git/branch-awareness': '/git/',
    '/automation/messaging/stream-coalescing': '/automation/messaging/',
    '/automation/messaging/voice-messages': '/automation/messaging/',
    '/browser-automation/launching-a-browser': '/browser-automation/',
    '/browser-automation/navigation': '/browser-automation/',
    '/browser-automation/interacting': '/browser-automation/',
    '/browser-automation/reading-content': '/browser-automation/',
    '/browser-automation/network-monitoring': '/browser-automation/',
    '/browser-automation/screenshots': '/browser-automation/',
    '/browser-automation/recording': '/browser-automation/',
    '/plugins/managing': '/plugins/',
    '/skill-synthesis/background-learning': '/skill-synthesis/',
    '/skill-synthesis/reviewing-candidates': '/skill-synthesis/',
  },
  integrations: [
    starlight({
      title: 'PtahCode Documentation',
      description:
        'The AI dev team that ships production SaaS — user guide for the PtahCode desktop app',
      favicon: '/favicon.svg',
      customCss: ['./src/styles/brand.css'],
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: GITHUB_REPO,
        },
      ],
      editLink: {
        baseUrl: EDIT_BASE,
      },
      // Fails `astro build` (and so the CI docs-build job) on any broken
      // internal link or heading anchor.
      plugins: [starlightLinksValidator()],
      sidebar: [
        {
          label: 'Getting Started',
          items: [{ autogenerate: { directory: 'getting-started' } }],
        },
        {
          label: 'Chat',
          items: [{ autogenerate: { directory: 'chat' } }],
        },
        {
          label: 'Orchestra Canvas',
          items: [
            { label: 'Overview', slug: 'canvas' },
            { label: 'Session Details', slug: 'canvas/session-inspector' },
          ],
        },
        {
          label: 'Providers',
          items: [{ autogenerate: { directory: 'providers' } }],
        },
        {
          label: 'Agents',
          items: [{ autogenerate: { directory: 'agents' } }],
        },
        {
          label: 'Setup',
          items: [
            { label: 'Project Setup', slug: 'setup' },
            { label: 'Analyze Current Project', slug: 'setup/setup-wizard' },
            { label: 'AI Team Builder', slug: 'setup/ai-team-builder' },
            { label: 'New Project', slug: 'setup/new-project' },
          ],
        },
        {
          label: 'Sessions',
          items: [{ autogenerate: { directory: 'sessions' } }],
        },
        {
          label: 'Workspace',
          items: [{ autogenerate: { directory: 'workspace' } }],
        },
        {
          label: 'Memory',
          items: [
            { label: 'Overview', slug: 'memory' },
            { label: 'How It Works', slug: 'memory/how-it-works' },
            { label: 'Searching', slug: 'memory/searching' },
            { label: 'Pinning & Forgetting', slug: 'memory/pinning-and-forgetting' },
            { label: 'Timeline & Corpus', slug: 'memory/timeline-and-corpus' },
            { label: 'Maintenance', slug: 'memory/maintenance' },
            { label: 'Settings', slug: 'memory/settings' },
          ],
        },
        {
          label: 'Tribunal',
          items: [
            { label: 'Overview', slug: 'tribunal' },
            { label: 'Council', slug: 'tribunal/council' },
            { label: 'Forge', slug: 'tribunal/forge' },
            { label: 'Race', slug: 'tribunal/race' },
            { label: 'Relay', slug: 'tribunal/relay' },
            { label: 'Crucible', slug: 'tribunal/crucible' },
          ],
        },
        {
          label: 'Skill Synthesis',
          items: [
            { label: 'Overview', slug: 'skill-synthesis' },
            { label: 'The Skills Tab', slug: 'skill-synthesis/the-skills-tab' },
            { label: 'How It Works', slug: 'skill-synthesis/how-it-works' },
            { label: 'SKILL.md Anatomy', slug: 'skill-synthesis/skill-md-anatomy' },
            { label: 'Settings', slug: 'skill-synthesis/settings' },
          ],
        },
        {
          label: 'Automation',
          items: [
            { label: 'Overview', slug: 'automation' },
            { label: 'Cron — Overview', slug: 'automation/cron' },
            { label: 'Creating a Job', slug: 'automation/cron/creating-a-job' },
            { label: 'Cron Expressions', slug: 'automation/cron/cron-expressions' },
            { label: 'Catchup & Power', slug: 'automation/cron/catchup-and-power' },
            { label: 'Run History', slug: 'automation/cron/run-history' },
            { label: 'Cron Settings', slug: 'automation/cron/settings' },
            { label: 'Messaging — Overview', slug: 'automation/messaging' },
            { label: 'Telegram Setup', slug: 'automation/messaging/telegram' },
            { label: 'Discord Setup', slug: 'automation/messaging/discord' },
            { label: 'Slack Setup', slug: 'automation/messaging/slack' },
            { label: 'Pairing & Approvals', slug: 'automation/messaging/pairing-and-approvals' },
            { label: 'Hand Off a Session', slug: 'automation/messaging/send-a-session' },
            { label: 'Messaging Settings', slug: 'automation/messaging/settings' },
          ],
        },
        {
          label: 'Tasks',
          items: [{ label: 'Tasks Board', slug: 'tasks' }],
        },
        {
          label: 'Git & Version Control',
          items: [{ autogenerate: { directory: 'git' } }],
        },
        {
          label: 'Reviews',
          items: [{ label: 'Review Runs', slug: 'reviews' }],
        },
        {
          label: 'Marketplace',
          items: [
            { label: 'Overview', slug: 'marketplace' },
            { label: 'Connectors', slug: 'marketplace/connectors' },
            { label: 'MCP Registry', slug: 'marketplace/mcp-registry' },
            { label: 'Custom URL', slug: 'marketplace/connected-apps' },
            { label: 'Smithery', slug: 'marketplace/smithery' },
          ],
        },
        {
          label: 'Plugins',
          items: [
            { label: 'Overview', slug: 'plugins' },
            { label: 'Catalog', slug: 'plugins/marketplace' },
            { label: 'Installing', slug: 'plugins/installing' },
            { label: 'Skill Toggles', slug: 'plugins/skill-toggles' },
            { label: 'Per-Project Skill Selection', slug: 'plugins/skill-selection' },
            { label: 'Harness Plugins', slug: 'plugins/harness-plugins' },
            { label: 'Plugin Storage', slug: 'plugins/plugin-storage' },
            { label: 'Creating Plugins', slug: 'plugins/creating-plugins' },
          ],
        },
        {
          label: 'Templates',
          items: [
            { label: 'Overview', slug: 'templates' },
            { label: 'How Templates Are Used', slug: 'templates/using-templates' },
            { label: 'Template Storage', slug: 'templates/template-storage' },
            { label: 'Creating Templates', slug: 'templates/creating-templates' },
          ],
        },
        {
          label: 'Browser Automation',
          items: [
            { label: 'Overview', slug: 'browser-automation' },
          ],
        },
        {
          label: 'MCP & Skills',
          items: [
            { label: 'Overview', slug: 'mcp-and-skills' },
            { label: 'Built-in MCP Server', slug: 'mcp-and-skills/built-in-mcp-server' },
            { label: 'External MCP Callers', slug: 'mcp-and-skills/external-callers' },
            { label: 'Ptah Tools', slug: 'mcp-and-skills/ptah-tools' },
            { label: 'Skills', slug: 'mcp-and-skills/skills' },
            { label: 'Shipped Skills', slug: 'mcp-and-skills/popular-skills' },
            { label: 'Creating Skills', slug: 'mcp-and-skills/creating-skills' },
            { label: 'Third-party MCP', slug: 'mcp-and-skills/third-party-mcp' },
            { label: 'Apps', slug: 'mcp-and-skills/apps' },
          ],
        },
        {
          label: 'Settings',
          items: [
            { label: 'Overview', slug: 'settings' },
            { label: 'Global Settings', slug: 'settings/global-settings' },
            { label: 'Workspace Settings', slug: 'settings/workspace-settings' },
            { label: 'Theme', slug: 'settings/theme' },
            { label: 'Autopilot', slug: 'settings/autopilot' },
            { label: 'Context Management', slug: 'settings/context-management' },
            { label: 'Search & Voice', slug: 'settings/search-and-voice' },
            { label: 'Import & Export', slug: 'settings/import-export' },
          ],
        },
        {
          label: 'Troubleshooting',
          items: [
            { label: 'Overview', slug: 'troubleshooting' },
            { label: 'Installation Issues', slug: 'troubleshooting/installation-issues' },
            { label: 'Provider Errors', slug: 'troubleshooting/provider-errors' },
            { label: 'CLI Agent Not Detected', slug: 'troubleshooting/cli-agent-not-detected' },
            { label: 'MCP Port Conflicts', slug: 'troubleshooting/mcp-port-conflicts' },
            { label: 'Workspace Analysis Failures', slug: 'troubleshooting/workspace-analysis-failures' },
            { label: 'Session Import Problems', slug: 'troubleshooting/session-import-problems' },
            { label: 'Logs & Diagnostics', slug: 'troubleshooting/logs-and-diagnostics' },
            { label: 'Filing Bugs', slug: 'troubleshooting/reporting-bugs' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'Overview', slug: 'reference' },
            { label: 'Keyboard Shortcuts', slug: 'reference/keyboard-shortcuts' },
            { label: 'File Locations', slug: 'reference/file-locations' },
            { label: 'Glossary', slug: 'reference/glossary' },
          ],
        },
      ],
    }),
  ],
});
