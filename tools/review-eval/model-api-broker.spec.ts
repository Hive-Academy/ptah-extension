import { createModelApiBroker, validateModelCall, ModelBrokerDeniedError } from './model-api-broker';

describe('model API broker denial', () => {
  it.each([
    { method: 'GET', path: '/v1/responses', body: '{}' },
    { method: 'POST', path: 'https://github.com/a', body: '{}' },
    { method: 'POST', path: '/repos/PtahCode/pulls', body: '{}' },
    { method: 'POST', path: '/v1/responses', body: '{}', authorization: 'token' },
  ])('rejects non model calls %#', input => {
    expect(() => validateModelCall(input)).toThrow(ModelBrokerDeniedError);
  });
  it('rejects GitHub and path-bearing broker origins', () => {
    const onEvent = jest.fn();
    expect(() => createModelApiBroker({ endpoint: 'https://github.com/', credential: 'secret', socketPath: '/tmp/broker' }, onEvent)).toThrow(ModelBrokerDeniedError);
    expect(() => createModelApiBroker({ endpoint: 'https://api.example.com/proxy', credential: 'secret', socketPath: '/tmp/broker' }, onEvent)).toThrow(ModelBrokerDeniedError);
  });
});
