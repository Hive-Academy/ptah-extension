import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import {
  sourceFiles,
  specifiersOf,
  withoutComments,
} from '../../testing/lazy-boundary.helpers';

const CHAT_SRC = join(__dirname, '..', '..', '..', '..');
const files = sourceFiles(CHAT_SRC).map((path) => ({
  name: basename(path, '.ts'),
  source: readFileSync(path, 'utf8'),
}));
const viewModule = 'chat-empty-state-screen.component';

describe('empty chat lazy boundary and event wiring', () => {
  it('imports the view only from its deferred shell, never a barrel', () => {
    expect(
      files
        .filter((file) =>
          specifiersOf(file.source).some((specifier) =>
            specifier.endsWith('/' + viewModule),
          ),
        )
        .map((file) => file.name),
    ).toEqual(['chat-empty-state.component']);
    const shell = withoutComments(
      readFileSync(join(__dirname, 'chat-empty-state.component.ts'), 'utf8'),
    );
    expect(shell).toMatch(
      /@defer\s*\(on immediate\)\s*\{\s*<ptah-chat-empty-state-view/,
    );
    expect(shell.match(/\bChatEmptyStateViewComponent\b/g)).toHaveLength(2);
    const view = readFileSync(join(__dirname, viewModule + '.ts'), 'utf8');
    expect(specifiersOf(view)).toContain('@ptah-extension/chat-ui/vitals');
  });

  it('keeps readiness and prompt launcher runtime exports off the main barrel', () => {
    const ui = join(CHAT_SRC, '..', '..', 'chat-ui', 'src');
    const eager = specifiersOf(
      readFileSync(join(ui, 'lib/molecules/vitals/index.ts'), 'utf8'),
    );
    expect(eager).not.toContain('./readiness-ring.component');
    expect(eager).not.toContain('./prompt-launchers.component');
    const lazy = specifiersOf(readFileSync(join(ui, 'vitals.ts'), 'utf8'));
    expect(lazy).toContain('./lib/molecules/vitals/readiness-ring.component');
    expect(lazy).toContain('./lib/molecules/vitals/prompt-launchers.component');
  });

  it('forwards both events through transcript and preserves composer prefill', () => {
    const components = join(__dirname, '..', '..');
    const transcript = readFileSync(
      join(components, 'organisms/transcript/chat-transcript.component.html'),
      'utf8',
    );
    expect(transcript).toContain(
      '(resumeRequested)="resumeRequested.emit($event)"',
    );
    expect(transcript).toContain(
      '(promptSelected)="promptSelected.emit($event)"',
    );
    const view = readFileSync(
      join(components, 'templates/chat-view.component.html'),
      'utf8',
    );
    expect(
      view.match(/\(resumeRequested\)="handleResumeRequested\(\$event\)"/g),
    ).toHaveLength(2);
    expect(view).toContain('[showReadiness]="true"');
    expect(view).not.toContain('showProjectSetup');
    const controller = readFileSync(
      join(components, 'templates/chat-view.component.ts'),
      'utf8',
    );
    expect(controller).toContain('chatInput.restoreContentToInput(promptText)');
    expect(controller).toContain(
      'this._appState.requestCanvasSession(sessionId)',
    );
  });
});
