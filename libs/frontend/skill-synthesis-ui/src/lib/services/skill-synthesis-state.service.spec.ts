import { TestBed } from '@angular/core/testing';
import type { SkillSuggestionSummary } from '@ptah-extension/shared';

import { SkillSynthesisStateService } from './skill-synthesis-state.service';
import { SkillSynthesisRpcService } from './skill-synthesis-rpc.service';

function suggestion(
  overrides: Partial<SkillSuggestionSummary> = {},
): SkillSuggestionSummary {
  return {
    id: 'sg-1',
    name: 'scaffold-nest-module',
    description: 'Scaffold a NestJS feature module with tests',
    clusterSize: 3,
    technologyFingerprint: 'nestjs,jest',
    judgeScore: 8.2,
    memberSessionIds: ['a', 'b', 'c'],
    status: 'pending',
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

function makeRpc(): jest.Mocked<
  Pick<
    SkillSynthesisRpcService,
    'listSuggestions' | 'acceptSuggestion' | 'dismissSuggestion'
  >
> {
  return {
    listSuggestions: jest.fn(async () => [suggestion()]),
    acceptSuggestion: jest.fn(async () => ({
      accepted: true,
      filePath: '/skills/sg-1/SKILL.md',
    })),
    dismissSuggestion: jest.fn(async () => true),
  } as unknown as jest.Mocked<
    Pick<
      SkillSynthesisRpcService,
      'listSuggestions' | 'acceptSuggestion' | 'dismissSuggestion'
    >
  >;
}

describe('SkillSynthesisStateService — suggestions', () => {
  function setup(rpc = makeRpc()) {
    TestBed.configureTestingModule({
      providers: [{ provide: SkillSynthesisRpcService, useValue: rpc }],
    });
    const svc = TestBed.inject(SkillSynthesisStateService);
    return { svc, rpc };
  }

  it('refreshes suggestions and computes the pending count', async () => {
    const rpc = makeRpc();
    rpc.listSuggestions.mockResolvedValueOnce([
      suggestion(),
      suggestion({ id: 'sg-2', status: 'dismissed' }),
    ]);
    const { svc } = setup(rpc);

    await svc.refreshSuggestions();

    expect(svc.suggestions().length).toBe(2);
    expect(svc.pendingSuggestionCount()).toBe(1);
    expect(svc.suggestionsLoading()).toBe(false);
  });

  it('coalesces missing fields to safe defaults so a computed cannot throw', async () => {
    const rpc = makeRpc();
    rpc.listSuggestions.mockResolvedValueOnce([
      { id: 'sg-x' } as unknown as SkillSuggestionSummary,
    ]);
    const { svc } = setup(rpc);

    await svc.refreshSuggestions();

    const [first] = svc.suggestions();
    expect(first.name).toBe('(unnamed skill)');
    expect(first.memberSessionIds).toEqual([]);
    expect(first.clusterSize).toBe(0);
    expect(first.status).toBe('pending');
    expect(() => svc.pendingSuggestionCount()).not.toThrow();
  });

  it('records an error when the refresh fails', async () => {
    const rpc = makeRpc();
    rpc.listSuggestions.mockRejectedValueOnce(new Error('store-unavailable'));
    const { svc } = setup(rpc);

    await svc.refreshSuggestions();

    expect(svc.error()).toBe('store-unavailable');
    expect(svc.suggestionsLoading()).toBe(false);
  });

  it('accepts a suggestion and refreshes the list', async () => {
    const rpc = makeRpc();
    const { svc } = setup(rpc);

    await svc.accept('sg-1');

    expect(rpc.acceptSuggestion).toHaveBeenCalledWith('sg-1');
    expect(rpc.listSuggestions).toHaveBeenCalledTimes(1);
  });

  it('dismisses a suggestion with a reason and refreshes the list', async () => {
    const rpc = makeRpc();
    const { svc } = setup(rpc);

    await svc.dismiss('sg-1', 'not-reusable');

    expect(rpc.dismissSuggestion).toHaveBeenCalledWith('sg-1', 'not-reusable');
    expect(rpc.listSuggestions).toHaveBeenCalledTimes(1);
  });
});
