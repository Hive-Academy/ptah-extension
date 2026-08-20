/**
 * `registerChatServices` — cross-lib registration precondition.
 *
 * `ChatSessionService` injects `OUTPUT_STYLE_TOKENS.SESSION_ACTIVATION`, which
 * `output-styles` owns rather than this lib, because the CLI-agent spawn path
 * needs the same composition and cannot import `rpc-handlers`.
 *
 * That makes the requirement CROSS-lib, and tsyringe resolves lazily: a host
 * that forgets `registerOutputStyleServices` boots clean and then throws on the
 * first message the user sends, in a stack that names neither function. These
 * specs pin the loud-at-bootstrap behaviour that replaces it.
 */

import 'reflect-metadata';

import { container as rootContainer } from 'tsyringe';
import { OUTPUT_STYLE_TOKENS } from '@ptah-extension/output-styles';

// `di.ts` imports the chat services, one of which reaches `agent-generation`,
// whose barrel loads `workspace-intelligence`'s tree-sitter bootstrap and its
// `import.meta.url` — unparseable by this Jest transform. Only the DI token is
// needed; nothing here instantiates a service.
jest.mock('@ptah-extension/agent-generation', () => ({
  AGENT_GENERATION_TOKENS: {
    ENHANCED_PROMPTS_SERVICE: Symbol.for('EnhancedPromptsService'),
    SETUP_WIZARD_SERVICE: Symbol.for('SetupWizardService'),
  },
}));

import { registerChatServices, CHAT_TOKENS } from './di';

describe('registerChatServices — output-style precondition', () => {
  it('throws when registerOutputStyleServices has not run', () => {
    const c = rootContainer.createChildContainer();

    expect(() => registerChatServices(c)).toThrow(
      /registerOutputStyleServices/,
    );
  });

  it('names the token so the fix is obvious from the message alone', () => {
    const c = rootContainer.createChildContainer();

    expect(() => registerChatServices(c)).toThrow(/SESSION_ACTIVATION/);
  });

  it('registers the chat services once the precondition is met', () => {
    const c = rootContainer.createChildContainer();
    c.register(OUTPUT_STYLE_TOKENS.SESSION_ACTIVATION, { useValue: {} });

    expect(() => registerChatServices(c)).not.toThrow();
    expect(c.isRegistered(CHAT_TOKENS.SESSION)).toBe(true);
  });

  it('accepts a registration inherited from a parent container', () => {
    const parent = rootContainer.createChildContainer();
    parent.register(OUTPUT_STYLE_TOKENS.SESSION_ACTIVATION, { useValue: {} });

    // Hosts build child containers per workspace; the token is bound once on
    // the parent. `isRegistered(token, true)` is what makes this pass.
    expect(() =>
      registerChatServices(parent.createChildContainer()),
    ).not.toThrow();
  });
});
