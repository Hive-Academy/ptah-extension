import {
  applySurfaceOps,
  SURFACE_LIMITS,
  SURFACE_SCHEMA_VERSION,
  SurfaceUpdateInputSchema,
  validateSurfaceUpdateInput,
} from '@ptah-extension/shared/mcp-apps-contracts/surface';

describe('surface subpath entry point', () => {
  it('resolves representative v2 exports through the public path alias', () => {
    expect(SURFACE_SCHEMA_VERSION).toBe('dashboard-spec/2');
    expect(SURFACE_LIMITS.maxSubmitMessageBytes).toBeGreaterThan(0);
    expect(typeof SurfaceUpdateInputSchema.safeParse).toBe('function');
    expect(typeof validateSurfaceUpdateInput).toBe('function');
    expect(typeof applySurfaceOps).toBe('function');
  });
});
