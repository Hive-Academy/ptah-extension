import {
  Component,
  signal,
  type Signal,
  type Type,
  viewChild,
} from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { TextDiffViewComponent } from './text-diff-view.component';

interface FakeHunk {
  additionStart: number;
  additionCount: number;
  deletionStart: number;
  deletionCount: number;
  collapsedBefore: number;
}

interface FakeFileContents {
  name: string;
  contents: string;
  lang?: string;
}

const pierre = {
  instances: [] as FakeFileDiff[],
  parsedFiles: [] as Array<{
    oldFile: FakeFileContents | null;
    newFile: FakeFileContents | null;
  }>,
  parseThrows: false,
};

const ONE_HUNK: FakeHunk = {
  additionStart: 1,
  additionCount: 1,
  deletionStart: 1,
  deletionCount: 1,
  collapsedBefore: 0,
};

class FakeFileDiff {
  cleanedUp = false;
  themeTypes: string[] = [];
  rendered: {
    fileDiff: { hunks: FakeHunk[] };
    fileContainer: HTMLElement;
  } | null = null;

  constructor(
    public options: Record<string, unknown> & {
      onPostRender?: (
        node: HTMLElement,
        instance: unknown,
        phase: string,
      ) => void;
    },
    public workerManager: unknown,
    public isContainerManaged: boolean,
  ) {
    pierre.instances.push(this);
  }

  /** Mirrors Pierre 1.5.1: one unlabelled `<code data-code data-unified>`. */
  render(props: NonNullable<FakeFileDiff['rendered']>): boolean {
    this.rendered = props;
    const container = props.fileContainer;
    const root =
      container.shadowRoot ?? container.attachShadow({ mode: 'open' });
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.setAttribute('data-code', '');
    code.setAttribute('data-unified', '');
    code.textContent = 'unified diff content';
    pre.appendChild(code);
    root.appendChild(pre);
    this.options.onPostRender?.(container, this, 'mount');
    return true;
  }

  setThemeType(mode: string): void {
    this.themeTypes.push(mode);
  }

  cleanUp(): void {
    this.cleanedUp = true;
  }
}

jest.mock('@pierre/diffs', () => ({
  DEFAULT_THEMES: { dark: 'pierre-dark', light: 'pierre-light' },
  FileDiff: FakeFileDiff,
  registerCustomLanguage: jest.fn(),
  registerCustomTheme: jest.fn(),
  // Mirrors the real 1.5.1 contract: throws when both sides are null, and
  // identical contents produce zero hunks.
  parseDiffFromFile: (
    oldFile: FakeFileContents | null,
    newFile: FakeFileContents | null,
  ) => {
    pierre.parsedFiles.push({ oldFile, newFile });
    if (oldFile === null && newFile === null) {
      throw new Error('parseDiffFromFile: both files are null');
    }
    if (pierre.parseThrows) throw new Error('parseDiffFromFile: failed');
    return {
      hunks: oldFile?.contents === newFile?.contents ? [] : [ONE_HUNK],
      oldFile,
      newFile,
    };
  },
}));

interface HostShape {
  readonly oldText: ReturnType<typeof signal<string | null>>;
  readonly newText: ReturnType<typeof signal<string | null>>;
  readonly fileName: ReturnType<typeof signal<string>>;
  readonly language: ReturnType<typeof signal<string>>;
  readonly theme: ReturnType<typeof signal<'light' | 'dark'>>;
  readonly diffView: Signal<TextDiffViewComponent>;
}

async function createHostComponent(): Promise<Type<HostShape>> {
  const { TextDiffViewComponent: DiffView } =
    await import('./text-diff-view.component');

  @Component({
    standalone: true,
    imports: [DiffView],
    template: `
      <ptah-text-diff-view
        [oldText]="oldText()"
        [newText]="newText()"
        [fileName]="fileName()"
        [language]="language()"
        [themeType]="theme()"
      />
    `,
  })
  class HostComponent implements HostShape {
    readonly oldText = signal<string | null>('console.log("hello");');
    readonly newText = signal<string | null>('console.log("world");');
    readonly fileName = signal<string>('test.ts');
    readonly language = signal<string>('');
    readonly theme = signal<'light' | 'dark'>('dark');
    readonly diffView = viewChild.required(DiffView);
  }
  return HostComponent;
}

describe('TextDiffViewComponent', () => {
  let fixture: ComponentFixture<HostShape>;

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    pierre.instances = [];
    pierre.parsedFiles = [];
    pierre.parseThrows = false;
    const HostComponent = await createHostComponent();
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    await settle();
  });

  it('configures host-managed FileDiff with unified style and word-level diff', () => {
    expect(pierre.instances).toHaveLength(1);
    const [instance] = pierre.instances;
    expect(instance.isContainerManaged).toBe(true);
    expect(instance.options).toMatchObject({
      diffStyle: 'unified',
      lineDiffType: 'word',
      preferredHighlighter: 'shiki-js',
      hunkSeparators: 'line-info',
      expandUnchanged: false,
      themeType: 'dark',
    });
    expect(instance.rendered?.fileContainer.tagName.toLowerCase()).toBe(
      'diffs-container',
    );
  });

  it('makes the scrolling code pane focusable and named, with a focus ring', () => {
    const container: HTMLElement =
      fixture.nativeElement.querySelector('diffs-container');
    const panes = Array.from(
      container.shadowRoot?.querySelectorAll('code[data-code]') ?? [],
    );
    expect(panes).toHaveLength(1);
    expect(panes[0].getAttribute('tabindex')).toBe('0');
    expect(panes[0].getAttribute('role')).toBe('group');
    expect(panes[0].getAttribute('aria-label')).toBe('Diff of test.ts');
    expect(pierre.instances[0].options['unsafeCSS']).toContain(
      'code[data-code]:focus-visible',
    );
  });

  it('passes oldText, newText and fileName to parseDiffFromFile', () => {
    expect(pierre.parsedFiles).toHaveLength(1);
    expect(pierre.parsedFiles[0].oldFile).toEqual({
      name: 'test.ts',
      contents: 'console.log("hello");',
    });
    expect(pierre.parsedFiles[0].newFile).toEqual({
      name: 'test.ts',
      contents: 'console.log("world");',
    });
    expect(fixture.componentInstance.diffView().error()).toBeNull();
  });

  it('forwards the language hint as Pierre lang with a neutral name when fileName is empty', async () => {
    fixture.componentInstance.fileName.set('');
    fixture.componentInstance.language.set('typescript');
    await settle();
    const last = pierre.parsedFiles.at(-1);
    expect(last?.oldFile).toEqual({
      name: 'untitled',
      contents: 'console.log("hello");',
      lang: 'typescript',
    });
    expect(last?.newFile).toEqual({
      name: 'untitled',
      contents: 'console.log("world");',
      lang: 'typescript',
    });
  });

  it('keeps fileName and adds lang when both are given', async () => {
    fixture.componentInstance.language.set('typescript');
    await settle();
    expect(pierre.parsedFiles.at(-1)?.newFile).toMatchObject({
      name: 'test.ts',
      lang: 'typescript',
    });
  });

  it('is an empty no-op when both oldText and newText are null', async () => {
    const instancesBefore = pierre.instances.length;
    const parsesBefore = pierre.parsedFiles.length;
    fixture.componentInstance.oldText.set(null);
    fixture.componentInstance.newText.set(null);
    await settle();
    expect(pierre.parsedFiles).toHaveLength(parsesBefore);
    expect(pierre.instances).toHaveLength(instancesBefore);
    expect(fixture.componentInstance.diffView().error()).toBeNull();
    expect(fixture.componentInstance.diffView().unchanged()).toBe(false);
    expect(fixture.nativeElement.querySelector('[role="status"]')).toBeNull();
  });

  it('shows a "No changes." status for identical texts without mounting FileDiff', async () => {
    const instancesBefore = pierre.instances.length;
    fixture.componentInstance.newText.set('console.log("hello");');
    await settle();
    expect(pierre.instances).toHaveLength(instancesBefore);
    expect(pierre.instances[0].cleanedUp).toBe(true);
    expect(fixture.componentInstance.diffView().unchanged()).toBe(true);
    const note = fixture.nativeElement.querySelector(
      '[data-testid="text-diff-unchanged"]',
    );
    expect(note?.getAttribute('role')).toBe('status');
    expect(note?.textContent).toContain('No changes.');
  });

  it('renders a new file when oldText is null', async () => {
    fixture.componentInstance.oldText.set(null);
    await settle();
    const last = pierre.parsedFiles.at(-1);
    expect(last?.oldFile).toBeNull();
    expect(last?.newFile?.contents).toBe('console.log("world");');
    expect(pierre.instances.at(-1)?.rendered).not.toBeNull();
    expect(fixture.componentInstance.diffView().unchanged()).toBe(false);
  });

  it('renders a deleted file when newText is null', async () => {
    fixture.componentInstance.newText.set(null);
    await settle();
    const last = pierre.parsedFiles.at(-1);
    expect(last?.newFile).toBeNull();
    expect(last?.oldFile?.contents).toBe('console.log("hello");');
    expect(pierre.instances.at(-1)?.rendered).not.toBeNull();
  });

  describe('errors', () => {
    let consoleError: jest.SpyInstance;

    beforeEach(() => {
      consoleError = jest.spyOn(console, 'error').mockImplementation(() => {
        /* silenced: asserted below */
      });
    });

    afterEach(() => consoleError.mockRestore());

    it('logs once and displays the error notice when parsing fails', async () => {
      pierre.parseThrows = true;
      fixture.componentInstance.newText.set('trigger error');
      await settle();
      expect(fixture.componentInstance.diffView().error()).toBe(
        'parseDiffFromFile: failed',
      );
      expect(consoleError).toHaveBeenCalledTimes(1);
      const errorEl = fixture.nativeElement.querySelector(
        '[data-testid="text-diff-error"]',
      );
      expect(errorEl).not.toBeNull();
      expect(errorEl.textContent).toContain(
        'This diff could not be displayed.',
      );
    });

    it('clears the error on the next valid input', async () => {
      pierre.parseThrows = true;
      fixture.componentInstance.newText.set('trigger error');
      await settle();
      expect(fixture.componentInstance.diffView().error()).not.toBeNull();

      pierre.parseThrows = false;
      fixture.componentInstance.newText.set('console.log("recovered");');
      await settle();
      expect(fixture.componentInstance.diffView().error()).toBeNull();
      expect(
        fixture.nativeElement.querySelector('[data-testid="text-diff-error"]'),
      ).toBeNull();
      expect(pierre.instances.at(-1)?.rendered).not.toBeNull();
      expect(pierre.instances.at(-1)?.cleanedUp).toBe(false);
    });
  });

  it('disposes the previous FileDiff on content input change', async () => {
    const first = pierre.instances[0];
    expect(first.cleanedUp).toBe(false);
    fixture.componentInstance.newText.set('console.log("updated");');
    await settle();
    expect(first.cleanedUp).toBe(true);
    expect(pierre.instances).toHaveLength(2);
    expect(pierre.instances[1].cleanedUp).toBe(false);
  });

  it('applies theme changes in place without recreating FileDiff', async () => {
    const instancesBefore = pierre.instances.length;
    fixture.componentInstance.theme.set('light');
    await settle();
    expect(pierre.instances).toHaveLength(instancesBefore);
    expect(pierre.instances[0].themeTypes.at(-1)).toBe('light');
  });

  it('disposes FileDiff on destroy', () => {
    const [instance] = pierre.instances;
    fixture.destroy();
    expect(instance.cleanedUp).toBe(true);
  });
});
