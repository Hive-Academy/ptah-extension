import {
  nextEffort,
  nextPermissionToggle,
  type EffortLevel,
  type PermissionLevel,
} from './use-agent-config.js';

describe('nextEffort', () => {
  it('cycles low → medium → high → max → low', () => {
    const seq: EffortLevel[] = ['low'];
    for (let i = 0; i < 4; i++) {
      seq.push(nextEffort(seq[seq.length - 1] as EffortLevel));
    }
    expect(seq).toEqual(['low', 'medium', 'high', 'max', 'low']);
  });
});

describe('nextPermissionToggle', () => {
  it('cycles ask → auto-edit → yolo → plan → ask', () => {
    const order: PermissionLevel[] = ['ask'];
    for (let i = 0; i < 4; i++) {
      order.push(
        nextPermissionToggle(order[order.length - 1] as PermissionLevel)
          .permissionLevel,
      );
    }
    expect(order).toEqual(['ask', 'auto-edit', 'yolo', 'plan', 'ask']);
  });

  it('derives enabled=false only for the ask level', () => {
    expect(nextPermissionToggle('plan')).toEqual({
      permissionLevel: 'ask',
      enabled: false,
    });
    expect(nextPermissionToggle('ask')).toEqual({
      permissionLevel: 'auto-edit',
      enabled: true,
    });
    expect(nextPermissionToggle('auto-edit')).toEqual({
      permissionLevel: 'yolo',
      enabled: true,
    });
  });
});
