/**
 * OutputStyleConfigComponent specs (Gate V 50 fixes).
 *
 *   - Serious 2: a selection whose requested parity write failed toasts the failure, never only "Saved".
 *   - Moderate 4: returning from the editor clears only the editor's own failures.
 *   - Moderate 7: after a save the focus lands on the saved style's Edit button, or on "New style".
 *
 * The editor is replaced by a stub with the same selector, inputs and outputs: its own behaviour is
 * covered by `output-style-editor.component.spec.ts`, and the real one pulls in the markdown renderer.
 */

import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
  signal,
} from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ProvidersSettingsStateService, VSCodeService } from '@ptah-extension/core';
import type {
  ActiveOutputStyleState,
  InvalidOutputStyle,
  OutputStyleDetail,
  OutputStyleEntry,
} from '@ptah-extension/shared';
import { SettingsSaveFeedbackService } from '../feedback/settings-save-feedback.service';
import { OutputStyleConfigComponent } from './output-style-config.component';
import { OutputStyleEditorComponent } from './output-style-editor.component';
import { OutputStyleStore, type OutputStyleFailedOperation } from './output-style.store';

@Component({
  selector: 'ptah-output-style-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
class EditorStubComponent {
  readonly isOpen = input(true);
  readonly draft = input<OutputStyleDetail | null>(null);
  readonly repair = input<InvalidOutputStyle | null>(null);
  readonly activeName = input<string | null>(null);
  readonly saved = output<string>();
  readonly cancelled = output<void>();
}

const BUILT_IN: OutputStyleEntry = {
  name: 'default',
  tier: 'builtin',
  description: 'No style.',
  keepCodingInstructions: true,
  editable: false,
  deletable: false,
  immutableReason: 'built-in',
};

const TERSE: OutputStyleEntry = {
  name: 'Terse',
  tier: 'user',
  description: 'Fewer words.',
  keepCodingInstructions: true,
  editable: true,
  deletable: true,
  fileName: 'terse.md',
};

describe('OutputStyleConfigComponent', () => {
  let fixture: ComponentFixture<OutputStyleConfigComponent>;
  let component: OutputStyleConfigComponent;
  let feedback: SettingsSaveFeedbackService;
  let parityWarning: ReturnType<typeof signal<string | null>>;
  let activate: jest.Mock;
  let dismissError: jest.Mock;

  beforeEach(async () => {
    parityWarning = signal<string | null>(null);
    activate = jest.fn().mockResolvedValue(true);
    dismissError = jest.fn();
    const active = signal<ActiveOutputStyleState | null>({ name: null, tier: null, missing: false });

    TestBed.configureTestingModule({
      imports: [OutputStyleConfigComponent],
      providers: [
        {
          provide: OutputStyleStore,
          useValue: {
            styles: signal<readonly OutputStyleEntry[]>([BUILT_IN, TERSE]),
            invalid: signal<readonly InvalidOutputStyle[]>([]),
            active,
            activeName: signal<string | null>(null),
            loading: signal(false),
            saving: signal(false),
            failedOperation: signal<OutputStyleFailedOperation | null>(null),
            hasCollision: signal(false),
            collidingNames: signal<readonly string[]>([]),
            usingFallbackInjection: signal(false),
            parityWrittenPath: signal<string | null>(null),
            parityWarning,
            refresh: jest.fn().mockResolvedValue(undefined),
            activate,
            dismissError,
            dismissParityOutcome: jest.fn(),
          },
        },
        { provide: ProvidersSettingsStateService, useValue: { commit: signal({ status: 'idle' }) } },
        { provide: VSCodeService, useValue: { isElectron: true } },
        SettingsSaveFeedbackService,
      ],
    });
    TestBed.overrideComponent(OutputStyleConfigComponent, {
      remove: { imports: [OutputStyleEditorComponent] },
      add: { imports: [EditorStubComponent] },
    });
    feedback = TestBed.inject(SettingsSaveFeedbackService);

    fixture = TestBed.createComponent(OutputStyleConfigComponent);
    component = fixture.componentInstance;
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  afterEach(() => {
    feedback.dismiss();
    fixture.nativeElement.remove();
    fixture.destroy();
    TestBed.resetTestingModule();
  });

  describe('parity outcome in the toast (Serious 2)', () => {
    it('a selection saved with a failed parity write shows the failure, not "Saved"', async () => {
      activate.mockImplementation(async () => {
        parityWarning.set('.claude/settings.json could not be written.');
        return true;
      });

      await component.onActivate({ name: 'Terse', parity: { enabled: true, tier: 'project' } });

      expect(feedback.toast()).toEqual({
        tone: 'alert',
        message: 'Your style is active in Ptah, but the settings file for the command line could not be updated.',
        canUndo: false,
      });
    });

    it('a selection whose parity write succeeded toasts "Saved" without Undo', async () => {
      await component.onActivate({ name: 'Terse', parity: { enabled: true, tier: 'project' } });

      expect(feedback.toast()).toEqual({ tone: 'status', message: 'Saved output style.', canUndo: false });
    });
  });

  describe('returning from the editor', () => {
    it('clears only the editor session failures (Moderate 4)', () => {
      component.onCreate();
      component.showList();

      expect(dismissError).toHaveBeenCalledWith(['save', 'open']);
      expect(component.view()).toBe('list');
    });

    it('after a save, focuses the saved style\'s Edit button (Moderate 7)', async () => {
      component.onCreate();
      fixture.detectChanges();

      component.onSaved('Terse');
      fixture.detectChanges();
      await fixture.whenStable();

      const edit = fixture.nativeElement.querySelector(
        '[data-testid="output-style-row-Terse"] [data-testid="output-style-edit-button"]',
      );
      expect(document.activeElement).toBe(edit);
    });

    it('after a save with no editable row of that name, focuses "New style"', async () => {
      component.onCreate();
      fixture.detectChanges();

      component.onSaved('Renamed elsewhere');
      fixture.detectChanges();
      await fixture.whenStable();

      expect(document.activeElement?.getAttribute('data-testid')).toBe('output-style-new-button');
    });
  });
});
