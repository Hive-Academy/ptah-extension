// Planted fixture for the degradation-audit self-test.

export function fireAndForget(job: Promise<void>): void {
  void job.catch(() => undefined);
}

export function fireAndForgetBlock(job: Promise<void>): void {
  void job.catch(() => {});
}
