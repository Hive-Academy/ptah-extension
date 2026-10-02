import { agglomerate, cosineSimilarity } from './cosine-similarity';

function vec(values: number[]): Float32Array {
  return Float32Array.from(values);
}

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity(vec([1, 0, 0]), vec([1, 0, 0]))).toBeCloseTo(1);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity(vec([1, 0]), vec([0, 1]))).toBeCloseTo(0);
  });

  it('returns 0 on length mismatch or empty input', () => {
    expect(cosineSimilarity(vec([1, 2]), vec([1, 2, 3]))).toBe(0);
    expect(cosineSimilarity(vec([]), vec([]))).toBe(0);
  });
});

describe('agglomerate', () => {
  it('returns one cluster per index for empty / single input', () => {
    expect(agglomerate([], 0.5)).toEqual([]);
    expect(agglomerate([vec([1, 0])], 0.5)).toEqual([0]);
  });

  it('keeps dissimilar vectors in separate clusters', () => {
    const clusters = agglomerate([vec([1, 0]), vec([0, 1])], 0.5);
    expect(new Set(clusters).size).toBe(2);
  });

  it('merges similar vectors into one cluster (single-linkage)', () => {
    const clusters = agglomerate(
      [vec([1, 0, 0]), vec([0.99, 0.01, 0]), vec([0, 0, 1])],
      0.9,
    );
    expect(clusters[0]).toBe(clusters[1]);
    expect(clusters[2]).not.toBe(clusters[0]);
  });

  it('chains transitive matches via single-linkage', () => {
    const clusters = agglomerate(
      [vec([1, 0]), vec([0.95, 0.31]), vec([0.8, 0.6])],
      0.9,
    );
    expect(new Set(clusters).size).toBe(1);
  });

  it('joins a chain a~b~c into one component even when a and c are not similar', () => {
    const a = vec([1, 0]);
    const b = vec([0.95, 0.31]);
    const c = vec([0.8, 0.6]);
    // Precondition of the case: a~b, b~c, but a≁c at this threshold.
    expect(cosineSimilarity(a, b)).toBeGreaterThan(0.9);
    expect(cosineSimilarity(b, c)).toBeGreaterThan(0.9);
    expect(cosineSimilarity(a, c)).toBeLessThanOrEqual(0.9);
    expect(agglomerate([a, b, c], 0.9)).toEqual([0, 0, 0]);
  });

  it('labels each component with its lowest member index in input order', () => {
    const clusters = agglomerate(
      [vec([0, 1]), vec([1, 0]), vec([0.01, 0.99]), vec([0.99, 0.01])],
      0.9,
    );
    expect(clusters).toEqual([0, 1, 0, 1]);
  });

  it('links only above the threshold (strict >)', () => {
    // Identical vectors have similarity ~1; a threshold of 1 must not link them.
    expect(agglomerate([vec([1, 0]), vec([1, 0])], 1)).toEqual([0, 1]);
  });
});
