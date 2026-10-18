import { TestBed } from '@angular/core/testing';
import type { CommandWorkNode } from '../model/command-center.store';
import { CommandNodeDetailComponent } from './command-node-detail.component';

describe('CommandNodeDetailComponent', () => {
  const node: CommandWorkNode = {
    id: 'cli:1',
    kind: 'agent',
    agentKind: 'cli',
    parentId: 'root:1',
    label: 'Review',
    providerId: 'codex',
    state: 'running',
    task: '<script>untrusted</script>\nSecond line',
    updatedAt: 820_000,
  };
  it('renders escaped first-line task, state, phase, freshness and supplied figures', () => {
    TestBed.configureTestingModule({ imports: [CommandNodeDetailComponent] });
    const fixture = TestBed.createComponent(CommandNodeDetailComponent);
    fixture.componentRef.setInput('node', node);
    fixture.componentRef.setInput('now', 1_000_000);
    fixture.componentRef.setInput('phaseCount', { done: 2, total: 3 });
    fixture.componentRef.setInput('childStats', { messages: 4, tokens: 12 });
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain('<script>untrusted</script>');
    expect(host.querySelector('script')).toBeNull();
    expect(host.textContent).not.toContain('Second line');
    expect(host.textContent).toContain('running');
    expect(host.textContent).toContain('Phase 2 / 3');
    expect(host.textContent).toContain('Updated 3m ago');
    expect(host.textContent).toContain('4 messages');
    expect(host.textContent).toContain('12 tokens');
    fixture.componentRef.setInput('node', {
      ...node,
      task: '\n  \n  Fix <the> bug',
      updatedAt: 1_005_000,
    });
    fixture.detectChanges();
    expect(host.textContent).toContain('Fix <the> bug');
    expect(host.querySelector('the')).toBeNull();
    expect(host.textContent).toContain('Updated Just now');
  });

  it('formats provisional child figures and omits unknown values', () => {
    TestBed.configureTestingModule({ imports: [CommandNodeDetailComponent] });
    const fixture = TestBed.createComponent(CommandNodeDetailComponent);
    fixture.componentRef.setInput('node', node);
    fixture.componentRef.setInput('now', 1_000_000);
    fixture.componentRef.setInput('childStats', {
      tokens: 12_345,
      costUsd: 0.012345678,
      provisional: true,
    });
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('~12.3k tokens');
    expect(text).toContain('~$0.01');
    expect(text).toContain('estimated');
    expect(text).not.toContain('0 messages');
    expect(text).not.toContain('0.012345678');
  });

  it('shows elapsed time from the shared clock only for a running timed node', () => {
    TestBed.configureTestingModule({ imports: [CommandNodeDetailComponent] });
    const fixture = TestBed.createComponent(CommandNodeDetailComponent);
    fixture.componentRef.setInput('node', { ...node, startedAt: 850_000 });
    fixture.componentRef.setInput('now', 1_000_000);
    fixture.detectChanges();
    const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text()).toContain('Running for 2m 30s');
    fixture.componentRef.setInput('now', 1_030_000);
    fixture.detectChanges();
    expect(text()).toContain('Running for 3m 0s');
    fixture.componentRef.setInput('node', { ...node, startedAt: 1_040_000 });
    fixture.detectChanges();
    expect(text()).toContain('Running for 0ms');
    fixture.componentRef.setInput('node', {
      ...node,
      state: 'completed',
      startedAt: 850_000,
    });
    fixture.detectChanges();
    expect(text()).not.toContain('Running for');
  });
});
