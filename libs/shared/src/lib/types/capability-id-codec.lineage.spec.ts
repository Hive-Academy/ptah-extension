import { harnessPolicyFingerprint } from './capability-id-codec';

describe('contextual harness policy fingerprint', () => {
  const base = {
    entries: [{ name: 'plugin__l_x.json', content: 'on' }],
    pluginConfig: {
      enabledPluginIds: ['local'],
      disabledSkillIds: ['local-skill'],
    },
    context: {
      localRoot: '/canonical/b',
      ancestors: [
        {
          root: '/canonical/a',
          pluginConfig: { enabledPluginIds: ['x'], disabledSkillIds: ['s'] },
        },
        { root: '/canonical/r', pluginConfig: { disabledPluginIds: ['y'] } },
      ],
    },
  };

  it('keeps no-context legacy digest and separates contextual policy', () => {
    const { context, ...legacy } = base;
    expect(harnessPolicyFingerprint(legacy)).toMatch(/^[0-9a-f]{16}$/);
    expect(harnessPolicyFingerprint(base)).not.toBe(
      harnessPolicyFingerprint(legacy),
    );
  });

  it('changes for root identity, order, and even shadowed ancestor choices', () => {
    const original = harnessPolicyFingerprint(base);
    const [nearest, distant] = base.context.ancestors;
    expect(
      harnessPolicyFingerprint({
        ...base,
        context: { ...base.context, localRoot: '/canonical/c' },
      }),
    ).not.toBe(original);
    expect(
      harnessPolicyFingerprint({
        ...base,
        context: { ...base.context, ancestors: [distant, nearest] },
      }),
    ).not.toBe(original);
    expect(
      harnessPolicyFingerprint({
        ...base,
        context: {
          ...base.context,
          ancestors: [{ ...nearest, root: '/other/a' }, distant],
        },
      }),
    ).not.toBe(original);
    expect(
      harnessPolicyFingerprint({
        ...base,
        context: {
          ...base.context,
          ancestors: [
            {
              ...nearest,
              pluginConfig: {
                ...nearest.pluginConfig,
                disabledPluginIds: ['local'],
              },
            },
            distant,
          ],
        },
      }),
    ).not.toBe(original);
  });

  it('ignores ancestor agents, timestamps, and list order or duplicates', () => {
    const changed = {
      ...base,
      context: {
        ...base.context,
        ancestors: [
          {
            root: '/canonical/a',
            pluginConfig: {
              enabledPluginIds: ['x', 'x'],
              disabledSkillIds: ['s', 's'],
              disabledAgentIds: ['parent-agent'],
              lastUpdated: 'later',
            },
          },
          {
            root: '/canonical/r',
            pluginConfig: { disabledPluginIds: ['y', 'y'] },
          },
        ],
      },
    };
    expect(harnessPolicyFingerprint(changed)).toBe(
      harnessPolicyFingerprint(base),
    );
  });
});
