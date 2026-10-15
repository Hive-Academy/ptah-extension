import 'reflect-metadata';
import { RouteDecideArgsSchema } from '@ptah-extension/lane-routing';
import { ROUTE_DECIDE_TOOL_NAME, buildRouteDecideTool } from './route-tools';

describe('buildRouteDecideTool', () => {
  it('names ptah_route_decide and is not read-only', () => {
    const tool = buildRouteDecideTool();
    expect(tool.name).toBe(ROUTE_DECIDE_TOOL_NAME);
    expect(tool.name).toBe('ptah_route_decide');
    expect(tool.annotations?.readOnlyHint).toBe(false);
  });

  it('advertises one closed object generated from the zod contract', () => {
    const tool = buildRouteDecideTool();
    const schema = tool.inputSchema;
    expect(schema.type).toBe('object');
    expect(schema.additionalProperties).toBe(false);
    expect(schema).not.toHaveProperty('$schema');
    expect(schema).not.toHaveProperty('oneOf');
    expect([...(schema.required ?? [])]).toEqual(['stage', 'request']);

    const stage = schema.properties['stage'];
    expect(stage).toEqual({
      type: 'string',
      enum: ['pre-flight', 'gate-0.1'],
    });

    const keys = Object.keys(schema.properties).sort();
    expect(keys).toEqual(
      [
        'depth',
        'phases',
        'pins',
        'preferenceSource',
        'preferences',
        'request',
        'stage',
        'taskType',
      ].sort(),
    );

    const taskType = schema.properties['taskType'];
    expect(JSON.stringify(taskType)).toContain('gate-0.1');
    const request = schema.properties['request'];
    expect(JSON.stringify(request)).toContain('8000');
    expect(JSON.stringify(request)).not.toContain('Required when stage');
    expect(JSON.stringify(schema)).toContain('visual-review');
    expect(JSON.stringify(schema)).toContain('FEATURE');
  });

  it('accepts the same stage values the zod schema accepts', () => {
    expect(
      RouteDecideArgsSchema.safeParse({
        stage: 'pre-flight',
        request: 'ship the parser',
      }).success,
    ).toBe(true);
    const tool = buildRouteDecideTool();
    const stage = tool.inputSchema.properties['stage'];
    expect(stage).toMatchObject({ enum: ['pre-flight', 'gate-0.1'] });
  });

  it('is deterministic', () => {
    expect(JSON.stringify(buildRouteDecideTool())).toBe(
      JSON.stringify(buildRouteDecideTool()),
    );
  });
});
