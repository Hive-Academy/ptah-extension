import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SetupWizardStateService } from '../services/setup-wizard-state.service';
import { WizardRpcService } from '../services/wizard-rpc.service';
import { CommunityPacksPanelComponent } from './community-packs-panel.component';

describe('CommunityPacksPanelComponent', () => {
  it('loads packs only on browse and installs a selected agent', async () => {
    const packs = signal([
      {
        source: 'community',
        name: 'Tools',
        description: 'Extra agents',
        agents: [
          {
            file: 'a.md',
            name: 'Agent A',
            description: 'A',
            category: 'development',
          },
        ],
      },
    ]);
    const listAgentPacks = jest.fn().mockResolvedValue(packs());
    const installPackAgents = jest
      .fn()
      .mockResolvedValue({ success: true, agentsDownloaded: 1 });
    TestBed.configureTestingModule({
      providers: [
        {
          provide: SetupWizardStateService,
          useValue: {
            communityPacks: packs,
            setCommunityPacks: packs.set.bind(packs),
          },
        },
        {
          provide: WizardRpcService,
          useValue: { listAgentPacks, installPackAgents },
        },
      ],
    });
    const fixture = TestBed.createComponent(CommunityPacksPanelComponent);
    fixture.detectChanges();
    expect(listAgentPacks).not.toHaveBeenCalled();
    fixture.nativeElement.querySelector('button').click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(listAgentPacks).toHaveBeenCalledTimes(1);
    fixture.nativeElement.querySelector('[aria-expanded]').click();
    fixture.detectChanges();
    const install: HTMLButtonElement = [
      ...fixture.nativeElement.querySelectorAll('button'),
    ].find(
      (button: HTMLButtonElement) => button.textContent?.trim() === 'Install',
    );
    install.click();
    await fixture.whenStable();
    expect(installPackAgents).toHaveBeenCalledWith('community', ['a.md']);
  });
});
