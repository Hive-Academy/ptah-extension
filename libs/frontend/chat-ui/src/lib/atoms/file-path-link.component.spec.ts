import { TestBed } from '@angular/core/testing';
import { FILE_LINK_OPENER } from '@ptah-extension/core';
import { FilePathLinkComponent } from './file-path-link.component';

describe('FilePathLinkComponent', () => {
  let open: jest.Mock;

  async function setup() {
    open = jest.fn().mockResolvedValue(undefined);

    await TestBed.configureTestingModule({
      imports: [FilePathLinkComponent],
      providers: [{ provide: FILE_LINK_OPENER, useValue: { open } }],
    }).compileComponents();
  }

  it('renders shortened path with title set to full path', async () => {
    await setup();
    const fixture = TestBed.createComponent(FilePathLinkComponent);
    fixture.componentRef.setInput('fullPath', '/very/deep/nested/path/file.ts');
    fixture.detectChanges();

    const span = fixture.nativeElement.querySelector('span[title]');
    expect(span.getAttribute('title')).toBe('/very/deep/nested/path/file.ts');
    expect(span.textContent).toContain('.../path/file.ts');
  });

  it('returns the path verbatim when only one segment', async () => {
    await setup();
    const fixture = TestBed.createComponent(FilePathLinkComponent);
    fixture.componentRef.setInput('fullPath', 'foo/bar');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('foo/bar');
  });

  it('opens through FILE_LINK_OPENER on a rendered click, passing the host as origin', async () => {
    await setup();
    const fixture = TestBed.createComponent(FilePathLinkComponent);
    fixture.componentRef.setInput('fullPath', '/a/b/c.ts');
    fixture.detectChanges();

    let evt: Event | null = null;
    fixture.componentInstance.clicked.subscribe((e) => (evt = e));
    fixture.nativeElement.querySelector('span[title]').click();

    expect(open).toHaveBeenCalledWith({
      path: '/a/b/c.ts',
      origin: fixture.nativeElement,
    });
    expect(evt).not.toBeNull();
  });

  it('does nothing when path is empty', async () => {
    await setup();
    const fixture = TestBed.createComponent(FilePathLinkComponent);
    fixture.componentRef.setInput('fullPath', '');
    fixture.detectChanges();
    fixture.nativeElement.querySelector('span[title]').click();
    expect(open).not.toHaveBeenCalled();
  });

  it('logs a rejected open instead of throwing at the click', async () => {
    await setup();
    const errorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const failure = new Error('refused');
    open.mockRejectedValue(failure);

    const fixture = TestBed.createComponent(FilePathLinkComponent);
    fixture.componentRef.setInput('fullPath', '/a/b/c.ts');
    fixture.detectChanges();
    fixture.nativeElement.querySelector('span[title]').click();
    await Promise.resolve();
    await Promise.resolve();

    expect(errorSpy).toHaveBeenCalledWith(
      '[FilePathLink] Failed to open',
      '/a/b/c.ts',
      failure,
    );
    errorSpy.mockRestore();
  });
});
