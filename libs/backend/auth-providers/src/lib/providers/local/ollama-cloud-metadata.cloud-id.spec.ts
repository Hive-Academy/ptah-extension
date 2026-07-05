import 'reflect-metadata';
import { isCloudTag, toCloudId } from './ollama-cloud-metadata.service';

describe('isCloudTag', () => {
  it.each([
    ['kimi-k2.6:cloud', true],
    ['glm-5:cloud', true],
    ['gpt-oss:120b-cloud', true],
    ['qwen3-coder:480b-cloud', true],
    ['glm-5.2', false],
    ['kimi-k2.7-code', false],
    ['qwen3-coder:480b', false],
    ['gpt-oss:120b', false],
    ['', false],
  ])('isCloudTag(%s) === %s', (name, expected) => {
    expect(isCloudTag(name)).toBe(expected);
  });
});

describe('toCloudId', () => {
  it('appends :cloud to a bare base name', () => {
    expect(toCloudId('glm-5.2')).toBe('glm-5.2:cloud');
    expect(toCloudId('kimi-k2.7-code')).toBe('kimi-k2.7-code:cloud');
  });

  it('appends -cloud to a param-tagged name', () => {
    expect(toCloudId('qwen3-coder:480b')).toBe('qwen3-coder:480b-cloud');
    expect(toCloudId('gpt-oss:120b')).toBe('gpt-oss:120b-cloud');
  });

  it('leaves an already-cloud id unchanged', () => {
    expect(toCloudId('kimi-k2.6:cloud')).toBe('kimi-k2.6:cloud');
    expect(toCloudId('gpt-oss:120b-cloud')).toBe('gpt-oss:120b-cloud');
  });

  it('is idempotent', () => {
    expect(toCloudId(toCloudId('glm-5.2'))).toBe('glm-5.2:cloud');
    expect(toCloudId(toCloudId('qwen3-coder:480b'))).toBe(
      'qwen3-coder:480b-cloud',
    );
  });
});
