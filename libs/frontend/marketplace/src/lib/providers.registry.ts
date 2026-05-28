import { Server, Sparkles, Blocks, Boxes } from 'lucide-angular';
import {
  McpDirectoryBrowserComponent,
  SkillShBrowserComponent,
} from '@ptah-extension/chat-ui';
import { MarketplaceProviderSpec } from './provider-spec';

export const MARKETPLACE_PROVIDERS: readonly MarketplaceProviderSpec[] = [
  {
    id: 'official-mcp',
    name: 'MCP Registry',
    icon: Server,
    status: 'live',
    kind: 'mcp',
    tagline: 'Official Model Context Protocol server registry',
    proGated: true,
    surface: McpDirectoryBrowserComponent,
  },
  {
    id: 'skills-sh',
    name: 'Skills',
    icon: Sparkles,
    status: 'live',
    kind: 'skills',
    tagline: 'Discover and install community skills',
    proGated: true,
    surface: SkillShBrowserComponent,
  },
  {
    id: 'smithery',
    name: 'Smithery',
    icon: Blocks,
    status: 'coming-soon',
    kind: 'mcp',
    tagline: 'Hosted MCP servers with one-click setup',
    proGated: true,
  },
  {
    id: 'composio',
    name: 'Composio',
    icon: Boxes,
    status: 'coming-soon',
    kind: 'mcp',
    tagline: 'Managed-auth MCP toolkits',
    proGated: true,
  },
];
