import { TestBed } from '@angular/core/testing';
import type { MonitoredAgent } from '@ptah-extension/chat-streaming';
import { createHarness } from './integration-harness.testing';

describe('Command Center delegation and status integration', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('sends a delegated command to the owned chat root', async () => {
    const { fixture, sender } = createHarness();
    const page = fixture.componentInstance.page;
    await page.open();
    page.coordinator.chooseCurrentTab();
    await page.sendCommand('Delegate the fix to a CLI lane');
    expect(sender.send).toHaveBeenCalledTimes(1);
    expect(page.store.sessionStatus()).toBe('running');
    fixture.destroy();
  });

  it('includes the current owned projection in a status turn', async () => {
    const { fixture, sender } = createHarness();
    const page = fixture.componentInstance.page;
    await page.open();
    page.coordinator.chooseCurrentTab();
    fixture.detectChanges();
    await page.coordinator.sendStatusTurn('Status');
    expect(sender.send.mock.calls.at(-1)?.[0]).toContain('Status');
    expect(page.projection().nodes[0]?.id).toBe(
      'root:22222222-2222-4222-8222-222222222222',
    );
    fixture.destroy();
  });

  it('shows owned child and lane states while excluding unrelated work', async () => {
    const { fixture, projectionInput, tabs } = createHarness();
    const page = fixture.componentInstance.page;
    await page.open();
    page.coordinator.chooseCurrentTab();
    tabs.update((items) =>
      items.map((tab, index) =>
        index === 0 ? { ...tab, status: 'streaming' as const } : tab,
      ),
    );
    projectionInput.update((input) => ({
      ...input,
      children: [
        {
          tabId: 'child-tab',
          sessionId: 'child-session',
          parentSessionId: input.rootSessionId,
          state: 'completed',
          name: 'Implementation',
        },
      ],
      agents: [
        {
          agentId: 'lane-1',
          kind: 'cli',
          parentSessionId: 'child-session',
          state: 'failed',
        },
        {
          agentId: 'foreign',
          kind: 'cli',
          parentSessionId: 'other-session',
          state: 'running',
        },
      ],
    }));
    fixture.detectChanges();
    expect(page.projection().nodes.map((node) => node.state)).toEqual(
      expect.arrayContaining(['running', 'completed', 'failed']),
    );
    expect(
      page.projection().nodes.some((node) => node.id.includes('foreign')),
    ).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('Implementation');
    fixture.destroy();
  });

  it('renders all seven lifecycle states with identity, type and parent, and keeps terminal nodes inspectable', async () => {
    const { fixture, projectionInput } = createHarness();
    const page = fixture.componentInstance.page;
    await page.open();
    page.coordinator.chooseCurrentTab();
    // The work list lives behind the rail's Work tab.
    fixture.componentInstance.activeTab.set('work');
    const rootSessionId = page.store.sessionId() ?? '';
    const rootNodeId = `root:${page.store.markedTabId()}`;
    projectionInput.update((input) => ({
      ...input,
      children: (
        ['queued', 'starting', 'running', 'awaiting input'] as const
      ).map((state) => ({
        tabId: `tab-${state}`,
        sessionId: `session-${state}`,
        parentSessionId: rootSessionId,
        state,
        name: `Child ${state}`,
      })),
      agents: [
        {
          agentId: 'done',
          kind: 'cli',
          parentSessionId: rootSessionId,
          state: 'completed',
          displayName: 'Lane completed',
        },
        {
          agentId: 'broken',
          kind: 'sdk',
          parentSessionId: 'session-running',
          state: 'failed',
          displayName: 'Agent failed',
        },
        {
          agentId: 'stopped',
          kind: 'cli',
          parentSessionId: rootSessionId,
          state: 'cancelled',
          displayName: 'Lane cancelled',
        },
      ],
    }));
    fixture.detectChanges();
    const expected = [
      ['Child queued', 'queued', 'child', rootNodeId],
      ['Child starting', 'starting', 'child', rootNodeId],
      ['Child running', 'running', 'child', rootNodeId],
      ['Child awaiting input', 'awaiting input', 'child', rootNodeId],
      ['Lane completed', 'completed', 'agent', rootNodeId],
      ['Agent failed', 'failed', 'agent', 'child:session-running'],
      ['Lane cancelled', 'cancelled', 'agent', rootNodeId],
    ] as const;
    const { nodes, edges } = page.projection();
    const rows: HTMLElement[] = Array.from(
      fixture.nativeElement.querySelectorAll(
        'ptah-command-work-list ul button',
      ),
    );
    expect(rows).toHaveLength(expected.length);
    for (const [label, state, kind, parentId] of expected) {
      const node = nodes.find((item) => item.label === label);
      expect(node).toMatchObject({ state, kind, parentId });
      expect(edges).toContainEqual({ fromId: parentId, toId: node?.id });
      const row = rows.find((item) => item.textContent?.includes(label));
      expect(row?.textContent).toContain(state);
    }
    expect(nodes.find((node) => node.label === 'Agent failed')?.agentKind).toBe(
      'sdk',
    );
    rows.find((row) => row.textContent?.includes('Agent failed'))?.click();
    fixture.detectChanges();
    const selected = fixture.nativeElement.querySelector(
      '[aria-label="Selected work"]',
    );
    expect(selected?.textContent).toContain('Agent failed');
    expect(selected?.textContent).toContain('agent');
    expect(selected?.textContent).toContain('failed');
    fixture.destroy();
  });

  it('narrates an owned CLI lane once when starting and once when completed', async () => {
    const { fixture, projectionInput, rpc, pulses } = createHarness();
    const page = fixture.componentInstance.page;
    await page.open();
    page.coordinator.chooseCurrentTab();
    page.voice['active'] = true;
    rpc.call.mockImplementation(async (method: string) => ({
      success: method === 'voice:transcribe',
      data:
        method === 'voice:transcribe'
          ? { ok: true, transcript: 'Status' }
          : null,
    }));
    const rootSessionId = page.store.sessionId() ?? '';
    const advance = async (
      state: 'starting' | 'running' | 'completed',
      seq: number,
    ) => {
      projectionInput.update((input) => ({
        ...input,
        agents: [
          {
            agentId: 'owned-lane',
            kind: 'cli',
            parentSessionId: rootSessionId,
            state,
          },
          {
            agentId: 'foreign-lane',
            kind: 'cli',
            parentSessionId: 'other-session',
            state,
          },
        ],
      }));
      fixture.detectChanges();
      await page.voice['onClip']({
        audioBase64: 'AA==',
        mimeType: 'audio/wav',
      });
      pulses.set([
        {
          tabId: page.store.markedTabId() ?? '',
          seq,
          classification: 'success',
          lastAssistantMessage: 'Status.',
        },
      ]);
      fixture.detectChanges();
      await Promise.resolve();
    };
    await advance('starting', 1);
    await advance('running', 2);
    await advance('completed', 3);
    const spoken = rpc.call.mock.calls
      .filter(([method]) => method === 'voice:synthesize')
      .map(([, request]) => JSON.stringify(request));
    expect(
      spoken.filter((text) => text.includes('CLI agent started')),
    ).toHaveLength(1);
    expect(
      spoken.filter((text) => text.includes('CLI agent completed')),
    ).toHaveLength(1);
    expect(spoken.join(' ')).not.toContain('foreign-lane');
    expect(
      page.projection().nodes.some((node) => node.id === 'cli:foreign-lane'),
    ).toBe(false);
    await page.exit();
    fixture.destroy();
  });

  it('groups a manifest root and monitored lanes under one Tribunal node with a stage', async () => {
    const { fixture, records, monitor } = createHarness({
      realProjectionSource: true,
    });
    const page = fixture.componentInstance.page;
    await page.open();
    page.coordinator.chooseCurrentTab();
    const runId = 'run-1';
    records.readRunManifests.mockReturnValue([
      {
        runId,
        rootTabId: page.store.markedTabId(),
        rootSdkId: page.store.sessionId(),
        move: 'council',
        specTaskId: 'TASK_1',
        lanes: [{ laneId: 'codex#1' }, { laneId: 'cursor#1' }],
        rounds: 1,
        startedAt: 100,
      },
    ]);
    monitor.agents.set([
      {
        agentId: 'lane-1',
        cli: 'codex',
        parentSessionId: page.store.sessionId(),
        workflowRunId: runId,
        status: 'completed',
        startedAt: 100,
      } as MonitoredAgent,
      {
        agentId: 'lane-2',
        cli: 'cursor',
        parentSessionId: page.store.sessionId(),
        workflowRunId: runId,
        status: 'failed',
        startedAt: 100,
      } as MonitoredAgent,
    ]);
    fixture.detectChanges();
    const nodes = page.projection().nodes;
    const groups = nodes.filter((node) => node.id === `tribunal:${runId}`);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.parentId).toBe(`root:${page.store.markedTabId()}`);
    expect(
      nodes.filter(
        (node) =>
          node.parentId === `tribunal:${runId}` && node.id.startsWith('lane:'),
      ),
    ).toHaveLength(2);
    expect(nodes.some((node) => node.id.startsWith(`phase:${runId}:`))).toBe(
      true,
    );
    expect(
      nodes.find((node) => node.id === `lane:${runId}:cursor#1`)?.state,
    ).toBe('failed');
    expect(fixture.nativeElement.textContent).toContain('Tribunal council');
    fixture.destroy();
  });
});
