import 'reflect-metadata';
import {
  APPS_ONLY_TOOL_NAMES,
  appsOnlyToolMessage,
  resolveMcpToolProfile,
  withAppsNamespaceProfile,
} from './mcp-tool-profile';
import { DASHBOARD_PROPOSE_SPEC_TOOL_NAME } from './dashboard-propose-spec.tool';
import {
  SURFACE_UPDATE_TOOL_NAME,
  SURFACE_GET_STATE_TOOL_NAME,
} from './surface-tools';

describe('MCP tool profiles', () => {
  it('resolves apps explicitly', () => {
    expect(resolveMcpToolProfile({ _callerToolProfile: 'apps' })).toBe('apps');
  });
  it.each(['coding', undefined, '', 'APPS', 'admin', 42 as unknown as string])(
    'defaults %s to coding',
    (_callerToolProfile) => {
      expect(resolveMcpToolProfile({ _callerToolProfile })).toBe('coding');
    },
  );
  it('restricts exactly the three Apps tools', () => {
    expect(APPS_ONLY_TOOL_NAMES).toEqual(
      new Set([
        DASHBOARD_PROPOSE_SPEC_TOOL_NAME,
        SURFACE_UPDATE_TOOL_NAME,
        SURFACE_GET_STATE_TOOL_NAME,
      ]),
    );
  });
  it.each([...APPS_ONLY_TOOL_NAMES])(
    'names %s in the actionable refusal',
    (name) => {
      expect(appsOnlyToolMessage(name)).toContain(name);
      expect(appsOnlyToolMessage(name)).toContain(
        'available on the Apps page only',
      );
      expect(appsOnlyToolMessage(name)).toContain('coding tool profile');
    },
  );
});

describe('Apps namespace profile wrapper', () => {
  it('checks the injected getter on every invocation, including a captured method', async () => {
    const getProfile = jest.fn<'coding' | 'apps', []>(() => 'coding');
    const method = jest.fn(async function (this: { value: number }, n: number) {
      return this.value + n;
    });
    const wrapped = withAppsNamespaceProfile(
      'surface',
      { value: 4, method },
      getProfile,
    );
    const captured = wrapped.method.bind({ value: 99 });
    await expect(captured(2)).rejects.toThrow(
      'available on the Apps page only',
    );
    expect(method).not.toHaveBeenCalled();
    getProfile.mockReturnValue('apps');
    await expect(captured(2)).resolves.toBe(6);
    getProfile.mockReturnValue('coding');
    await expect(captured(2)).rejects.toThrow('ptah.surface.method');
    expect(method).toHaveBeenCalledTimes(1);
  });

  it('guards methods read through a property descriptor', async () => {
    const method = jest.fn(async () => 'raw');
    const wrapped = withAppsNamespaceProfile(
      'surface',
      { update: method },
      () => 'coding',
    );
    const viaDescriptor = Object.getOwnPropertyDescriptor(wrapped, 'update')
      ?.value as () => Promise<string>;
    await expect(viaDescriptor()).rejects.toThrow(
      'ptah.surface.update is available on the Apps page only',
    );
    expect(method).not.toHaveBeenCalled();
  });
});
