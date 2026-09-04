import {
  Server,
  Sparkles,
  Blocks,
  Boxes,
  Puzzle,
  KeyRound,
  Plug,
} from 'lucide-angular';
import {
  McpDirectoryBrowserComponent,
  SkillShBrowserComponent,
} from '@ptah-extension/chat-ui';
import { MarketplaceProviderSpec } from './provider-spec';
import { SmitherySurfaceComponent } from './smithery-surface.component';
import { PluginsSurfaceComponent } from './plugins-surface.component';
import { OAuthSurfaceComponent } from './oauth-surface.component';
import { ConnectorsSurfaceComponent } from './connectors-surface.component';

export const MARKETPLACE_PROVIDERS: readonly MarketplaceProviderSpec[] = [
  {
    // First deliberately: the curated catalog is the shortest path from "I want
    // my app connected" to a connected app. Connected Apps stays as its own
    // descriptor for a custom URL, and is also embedded in this surface.
    id: 'connectors',
    name: 'Connectors',
    icon: Plug,
    status: 'live',
    kind: 'mcp',
    tagline: 'Connect the apps you already use, in one click',
    surface: ConnectorsSurfaceComponent,
  },
  {
    id: 'plugins',
    name: 'Plugins',
    icon: Puzzle,
    status: 'live',
    kind: 'skills',
    tagline: 'Bundled skill packs for orchestration, frontend & backend',
    surface: PluginsSurfaceComponent,
  },
  {
    id: 'official-mcp',
    name: 'MCP Registry',
    icon: Server,
    status: 'live',
    kind: 'mcp',
    tagline: 'Official Model Context Protocol server registry',
    surface: McpDirectoryBrowserComponent,
  },
  {
    id: 'skills-sh',
    name: 'Skills',
    icon: Sparkles,
    status: 'live',
    kind: 'skills',
    tagline: 'Discover and install community skills',
    surface: SkillShBrowserComponent,
  },
  {
    id: 'smithery',
    name: 'Smithery',
    icon: Blocks,
    status: 'live',
    kind: 'mcp',
    tagline: 'Hosted MCP servers with one-click setup',
    surface: SmitherySurfaceComponent,
  },
  {
    id: 'oauth-mcp',
    name: 'Connected Apps',
    icon: KeyRound,
    status: 'live',
    kind: 'mcp',
    tagline: 'Connect OAuth-secured remote MCP servers',
    surface: OAuthSurfaceComponent,
  },
  {
    id: 'composio',
    name: 'Composio',
    icon: Boxes,
    status: 'coming-soon',
    kind: 'mcp',
    tagline: 'Managed-auth MCP toolkits',
  },
];
