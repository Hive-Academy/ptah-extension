/**
 * SessionListRowComponent specs (TASK_2026_679, plan component 8b).
 *
 * Coverage (parity ids): C-3 message count, C-4 expired transcript, C-5 and
 * D12 current row (highlight on the whole li, chips included), C-6 open in a
 * tab, C-10 child prefix and indent, D-2 inline rename (Enter, blur, Escape
 * with stopPropagation, IME, maxlength, focus and selection), and the row
 * actions (names, Organize availability, 24 px targets, touch visibility).
 */
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  SESSION_ORGANIZATION_DEFAULTS,
  type ChatSessionSummary,
  type SessionId,
  type SessionOrganizationSummary,
} from '@ptah-extension/shared';
import {
  SESSION_LIST_ROW_STYLES,
  SessionListRowComponent,
  type SessionRenameCommitTrigger,
} from './session-list-row.component';

const SESSION_ID = 'a1b2c3d4-0000-4000-8000-000000000679' as SessionId;
const EXPIRED_HINT = 'Claude removed this transcript.';

function organization(
  overrides: Partial<SessionOrganizationSummary> = {},
): SessionOrganizationSummary {
  return {
    ...SESSION_ORGANIZATION_DEFAULTS,
    worktreePath: null,
    branch: null,
    parentSessionId: null,
    forkOfSessionId: null,
    tasks: [],
    prLinks: [],
    childCount: 0,
    updatedAt: null,
    ...overrides,
  };
}

function summary(
  overrides: Partial<ChatSessionSummary> = {},
): ChatSessionSummary {
  return {
    id: SESSION_ID,
    name: 'Fix the login flow',
    messageCount: 4,
    createdAt: 1,
    lastActivityAt: Date.now() - 5 * 60_000,
    isActive: false,
    ...overrides,
  };
}

@Component({
  standalone: true,
  imports: [SessionListRowComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ul>
      <li
        ptah-session-list-row
        [session]="session()"
        [depth]="depth()"
        [organizationAvailable]="organizationAvailable()"
        [isCurrent]="isCurrent()"
        [isOpenInTab]="isOpenInTab()"
        [editing]="editing()"
        [editingName]="editingName()"
        [expiredHint]="expiredHint"
        (opened)="events.push('opened')"
        (organizeRequested)="events.push('organize')"
        (renameRequested)="events.push('rename')"
        (renameNameChange)="names.push($event)"
        (renameCommitted)="commits.push($event)"
        (renameCancelled)="events.push('cancelled')"
        (deleteRequested)="events.push('delete')"
      ></li>
    </ul>
  `,
})
class RowHostComponent {
  readonly session = signal(summary());
  readonly depth = signal(0);
  readonly organizationAvailable = signal(true);
  readonly isCurrent = signal(false);
  readonly isOpenInTab = signal(false);
  readonly editing = signal(false);
  readonly editingName = signal('');
  readonly expiredHint = EXPIRED_HINT;
  readonly events: string[] = [];
  readonly names: string[] = [];
  readonly commits: SessionRenameCommitTrigger[] = [];
}

describe('SessionListRowComponent', () => {
  let fixture: ComponentFixture<RowHostComponent>;
  let hostCmp: RowHostComponent;
  let root: HTMLElement;

  const li = (): HTMLLIElement => {
    const found = root.querySelector<HTMLLIElement>('li[ptah-session-list-row]');
    if (!found) throw new Error('Missing row li');
    return found;
  };
  const q = <T extends Element>(selector: string): T | null =>
    li().querySelector<T>(selector);
  const req = <T extends Element>(selector: string): T => {
    const found = q<T>(selector);
    if (!found) throw new Error(`Missing ${selector}`);
    return found;
  };
  const render = (): void => fixture.detectChanges();

  /**
   * The row's stylesheet, whitespace collapsed and comments dropped. The jest
   * preset strips component styles from the rendered DOM, so the spec reads
   * the exported source instead.
   */
  const rowStyles = (): string =>
    SESSION_LIST_ROW_STYLES.replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\s+/g, ' ')
      .trim();

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [RowHostComponent] });
    fixture = TestBed.createComponent(RowHostComponent);
    hostCmp = fixture.componentInstance;
    root = fixture.nativeElement as HTMLElement;
    render();
  });

  describe('metadata line', () => {
    it('C-3: shows "N msgs" only when the count is above zero', () => {
      expect(req('[data-testid="session-row-meta"]').textContent).toContain(
        '4 msgs',
      );

      hostCmp.session.set(summary({ messageCount: 0 }));
      render();
      expect(
        req('[data-testid="session-row-meta"]').textContent,
      ).not.toContain('msgs');
    });

    it('shows the relative time and the display name with the full name as tooltip', () => {
      expect(req('[data-testid="session-row-meta"]').textContent).toContain(
        '5m ago',
      );
      const title = req<HTMLElement>('[data-testid="session-row-title"]');
      expect(title.textContent?.trim()).toBe('Fix the login flow');
      expect(title.getAttribute('title')).toBe('Fix the login flow');
    });

    it('C-4: marks an expired transcript with muted title ink and the retention tooltip', () => {
      expect(q('[data-testid="session-row-expired"]')).toBeNull();

      hostCmp.session.set(summary({ hasTranscript: false }));
      render();
      const marker = req<HTMLElement>('[data-testid="session-row-expired"]');
      expect(marker.textContent?.trim()).toBe('transcript expired');
      expect(marker.getAttribute('title')).toBe(EXPIRED_HINT);
      expect(marker.classList.contains('italic')).toBe(true);
      const title = req<HTMLElement>('[data-testid="session-row-title"]');
      expect(title.classList.contains('text-base-content-muted')).toBe(true);
      expect(title.classList.contains('opacity-50')).toBe(false);
    });

    it('treats an undetermined transcript (undefined) as present', () => {
      hostCmp.session.set(summary({ hasTranscript: undefined }));
      render();
      expect(q('[data-testid="session-row-expired"]')).toBeNull();
    });
  });

  describe('current and open-in-a-tab markers', () => {
    it('C-5 / D12: the current class sits on the li that also holds the chips, and the button carries aria-current', () => {
      hostCmp.session.set(
        summary({ organization: organization({ pinned: true }) }),
      );
      hostCmp.isCurrent.set(true);
      render();

      const row = li();
      expect(row.classList.contains('session-row-current')).toBe(true);
      // The chips line is inside the highlighted element (D12).
      expect(
        row.querySelector('[data-testid="session-organization-chips"]'),
      ).not.toBeNull();
      const open = req<HTMLButtonElement>('button[data-action="open"]');
      expect(open.getAttribute('aria-current')).toBe('true');
      expect(open.classList.contains('session-row-current')).toBe(false);
      expect(
        req('[data-testid="session-row-title"]').classList.contains(
          'font-semibold',
        ),
      ).toBe(true);
    });

    it('D12: the fill and the accent are styled on the host li, and hover never replaces the current fill', () => {
      const css = rowStyles();
      expect(css).toContain(
        ':host(.session-row-current) { background-color: var(--surface-3); box-shadow: inset 2px 0 0 var(--ptah-link); }',
      );
      expect(css).toContain(
        ':host(.session-row-open-tab) { box-shadow: inset 2px 0 0 color-mix(in srgb, var(--ptah-link) 70%, transparent); }',
      );
      expect(css).toContain(
        ':host(:not(.session-row-current):hover) { background-color: var(--surface-2); }',
      );
      // No highlight rule targets the row button alone.
      expect(css).not.toMatch(/session-row-open[^{]*\{[^}]*background/);
    });

    it('a row that is not current has no aria-current and regular weight', () => {
      const open = req<HTMLButtonElement>('button[data-action="open"]');
      expect(open.hasAttribute('aria-current')).toBe(false);
      expect(li().classList.contains('session-row-current')).toBe(false);
      expect(
        req('[data-testid="session-row-title"]').classList.contains(
          'font-medium',
        ),
      ).toBe(true);
    });

    it('C-6: an open tab that is not current gets the open-tab class and sr-only text', () => {
      hostCmp.isOpenInTab.set(true);
      render();
      expect(li().classList.contains('session-row-open-tab')).toBe(true);
      const srOnly = Array.from(
        req('[data-testid="session-row-meta"]').querySelectorAll('.sr-only'),
      ).map((node) => node.textContent?.trim());
      expect(srOnly).toContain('Open in a tab');
    });

    it('C-6: the current session open in a tab shows only the current marker', () => {
      hostCmp.isOpenInTab.set(true);
      hostCmp.isCurrent.set(true);
      render();
      expect(li().classList.contains('session-row-open-tab')).toBe(false);
      expect(li().classList.contains('session-row-current')).toBe(true);
      expect(
        req('[data-testid="session-row-meta"]').textContent,
      ).not.toContain('Open in a tab');
    });
  });

  describe('nesting', () => {
    it('C-10: a child row reads "Child session:" and indents by depth', () => {
      expect(li().textContent).not.toContain('Child session:');
      expect(li().hasAttribute('data-depth')).toBe(false);
      expect(li().getAttribute('data-session-id')).toBe(SESSION_ID);

      hostCmp.depth.set(2);
      render();
      const prefix = req<HTMLElement>('button[data-action="open"] .sr-only');
      expect(prefix.textContent?.trim()).toBe('Child session:');
      expect(li().getAttribute('data-depth')).toBe('2');
      expect(li().classList.contains('ml-6')).toBe(true);

      hostCmp.depth.set(5);
      render();
      expect(li().classList.contains('ml-9')).toBe(true);
      expect(li().classList.contains('ml-6')).toBe(false);
    });
  });

  describe('row actions', () => {
    it('opens on the row button and reports each action', () => {
      hostCmp.session.set(summary({ organization: organization() }));
      render();

      req<HTMLButtonElement>('button[data-action="open"]').click();
      req<HTMLButtonElement>('[data-testid="session-organize"]').click();
      req<HTMLButtonElement>('button[data-action="rename"]').click();
      req<HTMLButtonElement>('button[data-action="delete"]').click();
      expect(hostCmp.events).toEqual(['opened', 'organize', 'rename', 'delete']);
    });

    it('names the actions after the session, in Organize, Rename, Delete order, as 24 px targets', () => {
      hostCmp.session.set(summary({ organization: organization() }));
      render();

      const actions = Array.from(
        li().querySelectorAll<HTMLButtonElement>(
          '.session-row-actions button',
        ),
      );
      expect(actions.map((b) => b.dataset['action'])).toEqual([
        'organize',
        'rename',
        'delete',
      ]);
      expect(actions.map((b) => b.getAttribute('aria-label'))).toEqual([
        'Organize session: Fix the login flow',
        'Rename session: Fix the login flow',
        'Delete session: Fix the login flow',
      ]);
      expect(actions[0].getAttribute('aria-haspopup')).toBe('dialog');
      for (const button of actions) {
        expect(button.classList.contains('h-6')).toBe(true);
        expect(button.classList.contains('w-6')).toBe(true);
        expect(button.classList.contains('min-h-6')).toBe(true);
      }
    });

    it('keeps the actions visible without hover (touch) and reveals them on focus', () => {
      const css = rowStyles();
      expect(css).toContain(
        '@media (hover: none) { .session-row-actions { opacity: 1; } }',
      );
      expect(css).toContain(':host(:focus-within) .session-row-actions');
      expect(
        q('.session-row-actions')?.classList.contains('session-row-actions'),
      ).toBe(true);
    });

    it('shows no Organize without an organization record', () => {
      expect(q('[data-testid="session-organize"]')).toBeNull();
      expect(q('button[data-action="rename"]')).not.toBeNull();
    });

    it('plain host: no live marker, no chips, no Organize', () => {
      hostCmp.organizationAvailable.set(false);
      hostCmp.session.set(summary({ organization: organization() }));
      render();
      expect(q('ptah-session-live-phase-indicator')).toBeNull();
      expect(q('ptah-session-organization-chips')).toBeNull();
      expect(q('[data-testid="session-organize"]')).toBeNull();
      expect(
        req('[data-testid="session-row-meta"]').classList.contains(
          'pr-[56px]',
        ),
      ).toBe(true);
    });

    it('organization host: live marker column and the chips line', () => {
      expect(q('ptah-session-live-phase-indicator')).not.toBeNull();
      expect(q('ptah-session-organization-chips')).not.toBeNull();
    });
  });

  describe('inline rename (D-2)', () => {
    const startEditing = (name = 'Fix the login flow'): HTMLInputElement => {
      hostCmp.editingName.set(name);
      hostCmp.editing.set(true);
      render();
      return req<HTMLInputElement>('[data-testid="session-rename-input"]');
    };

    const key = (
      input: HTMLInputElement,
      keyName: string,
      init: KeyboardEventInit = {},
    ): KeyboardEvent => {
      const event = new KeyboardEvent('keydown', {
        key: keyName,
        bubbles: true,
        cancelable: true,
        ...init,
      });
      input.dispatchEvent(event);
      return event;
    };

    it('replaces the row with a capped, labelled field, focused with its text selected', () => {
      const input = startEditing();
      expect(q('button[data-action="open"]')).toBeNull();
      expect(input.getAttribute('maxlength')).toBe('200');
      expect(input.getAttribute('aria-label')).toBe('Edit session name');
      const hintId = input.getAttribute('aria-describedby');
      expect(hintId).toBeTruthy();
      expect(document.getElementById(hintId ?? '')?.textContent).toBe(
        'Enter to save · Esc to cancel',
      );
      expect(input.value).toBe('Fix the login flow');
      expect(document.activeElement).toBe(input);
      expect(input.selectionStart).toBe(0);
      expect(input.selectionEnd).toBe('Fix the login flow'.length);
    });

    it('reports the draft as typed', () => {
      const input = startEditing();
      input.value = 'New name';
      input.dispatchEvent(new Event('input'));
      expect(hostCmp.names).toEqual(['New name']);
    });

    it('Enter commits with "enter" and prevents the default', () => {
      const input = startEditing();
      const event = key(input, 'Enter');
      expect(hostCmp.commits).toEqual(['enter']);
      expect(event.defaultPrevented).toBe(true);
    });

    it('blur commits with "blur"', () => {
      const input = startEditing();
      input.dispatchEvent(new FocusEvent('blur'));
      expect(hostCmp.commits).toEqual(['blur']);
    });

    it('Escape cancels and stops propagation, so neither the modal nor a document listener sees it (R4)', () => {
      const input = startEditing();
      const documentListener = jest.fn();
      const ancestorListener = jest.fn();
      document.addEventListener('keydown', documentListener);
      root.addEventListener('keydown', ancestorListener);
      try {
        const event = key(input, 'Escape');
        expect(hostCmp.events).toEqual(['cancelled']);
        expect(hostCmp.commits).toEqual([]);
        expect(event.defaultPrevented).toBe(true);
        expect(ancestorListener).not.toHaveBeenCalled();
        expect(documentListener).not.toHaveBeenCalled();
      } finally {
        document.removeEventListener('keydown', documentListener);
        root.removeEventListener('keydown', ancestorListener);
      }
    });

    it('ignores Enter and Escape while an IME composition is active', () => {
      const input = startEditing();
      const enter = key(input, 'Enter', { isComposing: true });
      const escape = key(input, 'Escape', { isComposing: true });
      expect(hostCmp.commits).toEqual([]);
      expect(hostCmp.events).toEqual([]);
      expect(enter.defaultPrevented).toBe(false);
      expect(escape.defaultPrevented).toBe(false);
    });

    it('leaves edit mode when the parent ends editing, back to the row button', () => {
      startEditing();
      hostCmp.editing.set(false);
      render();
      expect(q('[data-testid="session-rename-input"]')).toBeNull();
      expect(q('button[data-action="rename"]')).not.toBeNull();
      expect(hostCmp.commits).toEqual([]);
    });

    it('uses the plain-host padding without the marker column', () => {
      hostCmp.organizationAvailable.set(false);
      const input = startEditing();
      const editRow = input.parentElement;
      expect(editRow?.classList.contains('pl-2.5')).toBe(true);
      expect(editRow?.classList.contains('pl-[34px]')).toBe(false);
    });
  });
});
