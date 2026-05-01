// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// Placeholder URLs — replace before public launch.
const GITHUB_REPO = 'https://github.com/Hive-Academy/ptah-extension';
const EDIT_BASE = `${GITHUB_REPO}/edit/main/apps/ptah-docs/`;

export default defineConfig({
  site: 'https://docs.ptah.live',
  integrations: [
    starlight({
      title: 'Ptah Documentation',
      description:
        'The AI coding orchestra — user guide for the Ptah Electron desktop app',
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
      sidebar: [
        {
          label: 'Getting Started',
          autogenerate: { directory: 'getting-started' },
        },
        {
          label: 'Chat',
          autogenerate: { directory: 'chat' },
        },
        {
          label: 'Providers',
          autogenerate: { directory: 'providers' },
        },
        {
          label: 'Agents',
          autogenerate: { directory: 'agents' },
        },
        {
          label: 'Sessions',
          autogenerate: { directory: 'sessions' },
        },
        {
          label: 'Workspace',
          autogenerate: { directory: 'workspace' },
        },
        {
          label: 'Git & Version Control',
          autogenerate: { directory: 'git' },
        },
        {
          label: 'Plugins',
          items: [
            { label: 'Overview', slug: 'plugins' },
            { label: 'Marketplace', slug: 'plugins/marketplace' },
            { label: 'Installing', slug: 'plugins/installing' },
            { label: 'Managing', slug: 'plugins/managing' },
            { label: 'Plugin Storage', slug: 'plugins/plugin-storage' },
            { label: 'Creating Plugins', slug: 'plugins/creating-plugins' },
          ],
        },
        {
          label: 'Templates',
          items: [
            { label: 'Overview', slug: 'templates' },
            { label: 'Using Templates', slug: 'templates/using-templates' },
            { label: 'Template Storage', slug: 'templates/template-storage' },
            { label: 'Creating Templates', slug: 'templates/creating-templates' },
          ],
        },
        {
          label: 'Browser Automation',
          items: [
            { label: 'Overview', slug: 'browser-automation' },
            { label: 'Launching a Browser', slug: 'browser-automation/launching-a-browser' },
            { label: 'Navigation', slug: 'browser-automation/navigation' },
            { label: 'Clicking and Typing', slug: 'browser-automation/interacting' },
            { label: 'Reading Page Content', slug: 'browser-automation/reading-content' },
            { label: 'Screenshots', slug: 'browser-automation/screenshots' },
            { label: 'Network Monitoring', slug: 'browser-automation/network-monitoring' },
            { label: 'Recording', slug: 'browser-automation/recording' },
          ],
        },
        {
          label: 'MCP & Skills',
          items: [
            { label: 'Overview', slug: 'mcp-and-skills' },
            { label: 'Built-in MCP Server', slug: 'mcp-and-skills/built-in-mcp-server' },
            { label: 'Ptah Tools', slug: 'mcp-and-skills/ptah-tools' },
            { label: 'Skills', slug: 'mcp-and-skills/skills' },
            { label: 'Popular Skills', slug: 'mcp-and-skills/popular-skills' },
            { label: 'Creating Skills', slug: 'mcp-and-skills/creating-skills' },
            { label: 'Third-party MCP', slug: 'mcp-and-skills/third-party-mcp' },
          ],
        },
        {
          label: 'Settings',
          items: [
            { label: 'Overview', slug: 'settings' },
            { label: 'Global Settings', slug: 'settings/global-settings' },
            { label: 'Workspace Settings', slug: 'settings/workspace-settings' },
            { label: 'Theme', slug: 'settings/theme' },
            { label: 'API Keys', slug: 'settings/api-keys' },
            { label: 'Autopilot', slug: 'settings/autopilot' },
            { label: 'Import & Export', slug: 'settings/import-export' },
            { label: 'Why not package.json?', slug: 'settings/why-not-package-json' },
          ],
        },
        {
          label: 'Troubleshooting',
          items: [
            { label: 'Overview', slug: 'troubleshooting' },
            { label: 'Installation Issues', slug: 'troubleshooting/installation-issues' },
            { label: 'License Issues', slug: 'troubleshooting/license-issues' },
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
            { label: 'CLI Flags', slug: 'reference/cli-flags' },
            { label: 'Tier Comparison', slug: 'reference/tier-comparison' },
            { label: 'Glossary', slug: 'reference/glossary' },
            { label: 'Changelog', slug: 'reference/changelog' },
          ],
        },
      ],
    }),
  ],
});
