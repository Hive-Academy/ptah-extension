import { Server, Sparkles, Blocks, Boxes, Puzzle } from 'lucide-angular';
import {
  McpDirectoryBrowserComponent,
  SkillShBrowserComponent,
} from '@ptah-extension/chat-ui';
import { MarketplaceProviderSpec } from './provider-spec';
import { SmitherySurfaceComponent } from './smithery-surface.component';
import { PluginsSurfaceComponent } from './plugins-surface.component';

export const MARKETPLACE_PROVIDERS: readonly MarketplaceProviderSpec[] = [
  {
    id: 'plugins',
    name: 'Plugins',
    icon: Puzzle,
    status: 'live',
    kind: 'skills',
    tagline: 'Bundled skill packs for orchestration, frontend & backend',
    proGated: true,
    surface: PluginsSurfaceComponent,
  },
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
    status: 'live',
    kind: 'mcp',
    tagline: 'Hosted MCP servers with one-click setup',
    proGated: true,
    surface: SmitherySurfaceComponent,
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
