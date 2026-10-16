import { TestBed } from '@angular/core/testing';
import { LoggingService } from '@ptah-extension/core';
import type { HarnessSuggestConfigResponse } from '@ptah-extension/shared';
import { HarnessRpcService } from './harness-rpc.service';
import { HarnessHelperService } from './harness-helper.service';

describe('HarnessHelperService', () => {
  const suggestion: HarnessSuggestConfigResponse = {
    suggestedAgents: { claude: { enabled: true } },
    suggestedSkills: ['review'],
    suggestedMcpServers: [
      { query: 'github', displayName: 'GitHub', reason: 'Issues' },
    ],
    suggestedPrompt: 'Review changes',
    reasoning: 'The team reviews code',
  };
  const rpc = {
    suggestConfig: jest.fn(),
    designAgents: jest.fn(),
    generateSkills: jest.fn(),
    generateDocument: jest.fn(),
    analyzeIntent: jest.fn(),
    discoverMcp: jest.fn(),
    generatePrompt: jest.fn(),
    generateClaudeMd: jest.fn(),
  };
  let service: HarnessHelperService;

  beforeEach(() => {
    Object.values(rpc).forEach((mock) => mock.mockReset());
    TestBed.configureTestingModule({
      providers: [
        HarnessHelperService,
        { provide: HarnessRpcService, useValue: rpc },
        { provide: LoggingService, useValue: { error: jest.fn() } },
      ],
    });
    service = TestBed.inject(HarnessHelperService);
  });

  it('runs one helper at a time and waits for explicit Add before changing preview', async () => {
    let resolve!: (result: HarnessSuggestConfigResponse) => void;
    rpc.suggestConfig.mockReturnValue(
      new Promise<HarnessSuggestConfigResponse>((done) => {
        resolve = done;
      }),
    );
    const pending = service.suggestConfig({
      personaDescription: 'Reviewer',
      goals: [],
    });
    expect(service.busy()).toBe('suggest-config');
    expect(await service.discoverMcp()).toBe(false);
    expect(rpc.discoverMcp).not.toHaveBeenCalled();
    resolve(suggestion);
    expect(await pending).toBe(true);
    expect(service.result()?.kind).toBe('suggest-config');

    const commit = jest.fn();
    expect(commit).not.toHaveBeenCalled();
    expect(await service.addToPreview({}, commit)).toBe(true);
    expect(commit).toHaveBeenCalledWith({
      updates: {
        agents: {
          enabledAgents: suggestion.suggestedAgents,
          harnessSubagents: [],
        },
        skills: {
          selectedSkills: ['review'],
          selectedSkillRefs: undefined,
          createdSkills: [],
        },
        prompt: { systemPrompt: 'Review changes', enhancedSections: {} },
      },
      suggestedMcpServers: suggestion.suggestedMcpServers,
    });
    expect(service.result()).toBeNull();
  });

  it('keeps a document available for copy and explicit Add', async () => {
    rpc.generateDocument.mockResolvedValue({
      document: '# Requirements',
      sections: {},
    });
    await service.generateDocument({
      config: {
        name: 'Project',
        persona: { label: 'Builder', description: '', goals: [] },
        agents: { enabledAgents: {} },
        skills: { selectedSkills: [], createdSkills: [] },
        prompt: { systemPrompt: '', enhancedSections: {} },
        mcp: { servers: [], enabledTools: {} },
        claudeMd: {
          generateProjectClaudeMd: false,
          customSections: {},
          previewContent: '',
        },
        createdAt: '',
        updatedAt: '',
      },
    });
    expect(service.result()).toEqual({
      kind: 'generate-document',
      value: { document: '# Requirements', sections: {} },
    });
    const commit = jest.fn();
    await service.addToPreview({}, commit);
    expect(commit).toHaveBeenCalledWith({
      updates: {},
      document: '# Requirements',
    });
  });

  it('scopes request and commit errors without clearing the result on a failed Add', async () => {
    rpc.designAgents.mockRejectedValue(new Error('secret host detail'));
    expect(
      await service.designAgents({
        persona: { label: 'Builder', description: '', goals: [] },
        existingAgents: [],
      }),
    ).toBe(false);
    expect(service.error()).toEqual({
      kind: 'design-agents',
      message: 'Could not complete this helper. Try again.',
    });
    rpc.generatePrompt.mockResolvedValue({
      generatedPrompt: 'Build it',
      sections: {},
    });
    await service.generatePrompt({
      persona: { label: 'Builder', description: '', goals: [] },
      enabledAgents: [],
      selectedSkills: [],
    });
    expect(
      await service.addToPreview({}, () => {
        throw new Error('store failed');
      }),
    ).toBe(false);
    expect(service.result()?.kind).toBe('generate-prompt');
    expect(service.error()?.kind).toBe('generate-prompt');
  });
});
