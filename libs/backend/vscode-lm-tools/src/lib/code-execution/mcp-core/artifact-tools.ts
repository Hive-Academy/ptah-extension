import type { MCPToolDefinition } from '../types';

export const ARTIFACT_PUBLISH_TOOL_NAME = 'ptah_artifact_publish';

export function buildArtifactPublishTool(): MCPToolDefinition {
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
      type: 'object',
      properties: {
        title: { type: 'string', minLength: 1, description: 'Trimmed by the host, then 1-120 characters.' },
        html: { type: 'string', minLength: 1, description: 'At most 2 MiB UTF-8.' },
        path: { type: 'string', minLength: 1, maxLength: 1024, description: 'Must not be blank after trimming.' },
      },
      required: ['title'],
      additionalProperties: false,
    },
    annotations: { destructiveHint: false },
  };
}
