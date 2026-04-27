/**
 * Smoke tests for `configureTestBedWithMocks` — verifies the core mocks land
 * at the production DI tokens so services can inject them the same way they
 * would inject the real `ClaudeRpcService` / `MessageRouterService` at runtime.
 */

import { TestBed } from '@angular/core/testing';
import { ClaudeRpcService } from '../lib/services/claude-rpc.service';
import { MessageRouterService } from '../lib/services/message-router.service';
import { MESSAGE_HANDLERS } from '../lib/services/message-router.types';
import { configureTestBedWithMocks } from './test-bed-setup';
import { createMockRpcService } from './mock-rpc-service';
import { createMockMessageRouter } from './mock-message-router';

describe('configureTestBedWithMocks', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('registers mocks at ClaudeRpcService / MessageRouterService and leaves MESSAGE_HANDLERS empty', () => {
    const { rpc, router } = configureTestBedWithMocks();

    expect(TestBed.inject(ClaudeRpcService)).toBe(rpc);
    expect(TestBed.inject(MessageRouterService)).toBe(router);
    // Optional inject yields `null` when no multi-contributors are registered.
    // Specs that need handlers opt in via `overrides.providers`.
    expect(
      TestBed.inject(MESSAGE_HANDLERS, null, { optional: true }),
    ).toBeNull();
  });

  it('honors pre-built mocks passed via overrides', () => {
    const rpcMock = createMockRpcService();
    const routerMock = createMockMessageRouter();

    const { rpc, router } = configureTestBedWithMocks({
      rpcMock,
      routerMock,
    });

    expect(rpc).toBe(rpcMock);
    expect(router).toBe(routerMock);
    expect(TestBed.inject(ClaudeRpcService)).toBe(rpcMock);
    expect(TestBed.inject(MessageRouterService)).toBe(routerMock);
  });

  it('appends custom providers after the core mocks', () => {
    const TOKEN = 'TEST_TOKEN';
    configureTestBedWithMocks({
      providers: [{ provide: TOKEN, useValue: 42 }],
    });

    expect(TestBed.inject(TOKEN as never)).toBe(42);
  });
});
