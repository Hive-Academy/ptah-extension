/**
 * AgentSelectorComponent — boot-cost regression spec (TASK_2026_383 Batch 10.1).
 *
 * The component used to preload the agent list from `ngOnInit`, which put an
 * `autocomplete:agents` RPC (500 ms median, up to 709 ms measured) on every
 * boot for a dropdown most sessions never open. These specs pin the lazy
 * behaviour: nothing is fetched on mount, and the first open still populates.
 */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AgentDiscoveryFacade } from '@ptah-extension/core';
import type { AgentSuggestion } from '@ptah-extension/core';

import { AgentSelectorComponent } from './agent-selector.component';

describe('AgentSelectorComponent', () => {
  let fixture: ComponentFixture<AgentSelectorComponent>;
  let component: AgentSelectorComponent;
  let fetchAgents: jest.Mock;
  let searchAgents: jest.Mock;

  const agents: AgentSuggestion[] = [
    {
      name: 'reviewer',
      description: 'Reviews code',
    } as AgentSuggestion,
  ];

  beforeEach(async () => {
    fetchAgents = jest.fn().mockResolvedValue(undefined);
    searchAgents = jest.fn().mockReturnValue(agents);

    await TestBed.configureTestingModule({
      imports: [AgentSelectorComponent],
      providers: [
        {
          provide: AgentDiscoveryFacade,
          useValue: {
            fetchAgents,
            searchAgents,
          } as unknown as AgentDiscoveryFacade,
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AgentSelectorComponent);
    component = fixture.componentInstance;
  });

  it('does not fetch agents on mount', () => {
    fixture.detectChanges();

    expect(fetchAgents).not.toHaveBeenCalled();
    expect(component.agents()).toEqual([]);
  });

  it('fetches agents on the first dropdown open', async () => {
    fixture.detectChanges();

    await component.toggleDropdown();

    expect(fetchAgents).toHaveBeenCalledTimes(1);
    expect(component.agents()).toEqual(agents);
    expect(component.isOpen()).toBe(true);
    expect(component.isLoading()).toBe(false);
  });

  it('does not re-fetch on a subsequent open once the list is populated', async () => {
    fixture.detectChanges();

    await component.toggleDropdown();
    component.closeDropdown();
    await component.toggleDropdown();

    expect(fetchAgents).toHaveBeenCalledTimes(1);
  });
});
