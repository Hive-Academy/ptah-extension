import { z } from 'zod';
import { ArtifactPublishInputSchema } from '@ptah-extension/shared/mcp-apps-contracts';
import type { MCPToolDefinition } from '../types';

export const ARTIFACT_PUBLISH_TOOL_NAME = 'ptah_artifact_publish';

export function buildArtifactPublishTool(): MCPToolDefinition {
  const { $schema: _schema, additionalProperties: _additionalProperties, ...inputSchema } = z.toJSONSchema(
    ArtifactPublishInputSchema,
    { io: 'input', target: 'draft-7' },
  );
  return {
    name: ARTIFACT_PUBLISH_TOOL_NAME,
    description:
      'Publish a substantial self-contained visual page (dashboard, report or prototype) ' +
      'as one index.html with inline CSS and JavaScript. Provide a title and exactly one of ' +
      'html or path. Network access is blocked: no fetch, CDNs, remote fonts or remote images; ' +
      'images may use data: or blob: only. Keep ptah-ui blocks for short summaries. ' +
      'Each publish creates a new artifact. ' +
      'Shown only in the Ptah desktop app.',
    inputSchema: {
      ...inputSchema,
      type: 'object',
      properties: {
        title: { type: 'string' },
        html: { type: 'string' },
        path: { type: 'string' },
      },
    },
    annotations: { destructiveHint: false },
  };
}
