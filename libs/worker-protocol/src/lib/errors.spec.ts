import {
  WORKER_CLOSE_CODES,
  WORKER_CLOSE_REASONS,
  WORKER_ERROR_CODES,
  WORKER_ERROR_MESSAGES,
  WorkerErrorSchema,
  isWorkerCloseCode,
  isWorkerErrorCode,
  sanitizeErrorDetail,
  workerClose,
  workerError,
} from './errors';

describe('worker error codes and fixed copy', () => {
  it('lists exactly the W1 error codes', () => {
    expect([...WORKER_ERROR_CODES].sort()).toEqual(
      [
        'NOT_FOUND_OR_FORBIDDEN',
        'INVALID_PARAMS',
        'TURN_IN_FLIGHT',
        'SESSION_DRIVEN_ELSEWHERE',
        'DRIVER_LOCK_UNAVAILABLE',
        'NO_PROVIDER_READY',
        'WORKER_BUSY',
        'ALREADY_ANSWERED',
        'TRANSCRIPT_UNAVAILABLE',
        'SESSION_LOG_FAILED',
        'VERSION_MISMATCH',
        'PAIRING_REJECTED',
        'INTERNAL',
      ].sort(),
    );
  });

  it('has one non-empty sentence for every code and no extra keys', () => {
    expect(Object.keys(WORKER_ERROR_MESSAGES).sort()).toEqual(
      [...WORKER_ERROR_CODES].sort(),
    );
    for (const code of WORKER_ERROR_CODES) {
      const message = WORKER_ERROR_MESSAGES[code];
      expect(message.length).toBeGreaterThan(0);
      expect(message.endsWith('.')).toBe(true);
    }
  });

  it('recognizes only known codes', () => {
    expect(isWorkerErrorCode('INTERNAL')).toBe(true);
    expect(isWorkerErrorCode('CODEX_UNAVAILABLE')).toBe(false);
    expect(isWorkerErrorCode(42)).toBe(false);
  });
});

describe('workerError', () => {
  it('always uses the fixed copy for the code', () => {
    const error = workerError('INTERNAL', { ref: 'r-1' });
    expect(error).toEqual({
      code: 'INTERNAL',
      message: WORKER_ERROR_MESSAGES.INTERNAL,
      ref: 'r-1',
    });
    expect(WorkerErrorSchema.safeParse(error).success).toBe(true);
  });

  it('makes every pairing rejection byte-identical (no ref, no detail)', () => {
    const plain = JSON.stringify(workerError('PAIRING_REJECTED'));
    const withExtras = JSON.stringify(
      workerError('PAIRING_REJECTED', {
        ref: 'r-2',
        detail: { sessionId: 's', attemptsLeft: 3 },
      }),
    );
    expect(withExtras).toBe(plain);
    expect(JSON.parse(plain)).toEqual({
      code: 'PAIRING_REJECTED',
      message: WORKER_ERROR_MESSAGES.PAIRING_REJECTED,
    });
  });

  it('keeps only allow-listed detail fields', () => {
    const error = workerError('SESSION_DRIVEN_ELSEWHERE', {
      detail: {
        holder: { label: 'Ptah desktop', pid: 4242, hostname: 'box' },
        turnId: 't-1',
        path: '/home/user/secret',
      },
    });
    expect(error.detail).toEqual({
      holder: { label: 'Ptah desktop' },
      turnId: 't-1',
    });
  });

  it('omits detail when nothing allowed is left', () => {
    const error = workerError('INTERNAL', {
      detail: { stack: 'Error at /srv/app.js' },
    });
    expect(error).not.toHaveProperty('detail');
  });

  it('carries the handshake detail for VERSION_MISMATCH only when well formed', () => {
    const detail = {
      worker: { min: 2, max: 3, ptahVersion: '1.4.0' },
      client: {
        protocol: { min: 1, max: 1 },
        name: 'ptah-electron',
        version: '1.2.0',
      },
    };
    expect(workerError('VERSION_MISMATCH', { detail }).detail).toEqual(detail);
    expect(
      workerError('VERSION_MISMATCH', { detail: { worker: 'x' } }),
    ).not.toHaveProperty('detail');
  });
});

describe('sanitizeErrorDetail', () => {
  it('returns undefined for missing detail and for pairing rejections', () => {
    expect(sanitizeErrorDetail('INTERNAL', undefined)).toBeUndefined();
    expect(
      sanitizeErrorDetail('PAIRING_REJECTED', { sessionId: 's' }),
    ).toBeUndefined();
  });

  it('drops detail of the wrong shape instead of passing it through', () => {
    expect(
      sanitizeErrorDetail('TRANSCRIPT_UNAVAILABLE', { sessionId: 42 }),
    ).toBeUndefined();
    expect(
      sanitizeErrorDetail('TRANSCRIPT_UNAVAILABLE', { sessionId: 's-1' }),
    ).toEqual({ sessionId: 's-1' });
  });
});

describe('close codes', () => {
  it('uses the W1 numbers', () => {
    expect(WORKER_CLOSE_CODES).toEqual({
      PROTOCOL_ERROR: 4400,
      NOT_AUTHENTICATED: 4401,
      METHOD_NOT_ALLOWED: 4403,
      VERSION_MISMATCH: 4409,
      REVOKED: 4410,
      THROTTLED: 4429,
    });
  });

  it('pairs each code with its reason', () => {
    expect(workerClose(4400)).toEqual({ code: 4400, reason: 'protocol-error' });
    for (const code of Object.values(WORKER_CLOSE_CODES)) {
      expect(WORKER_CLOSE_REASONS[code]).toMatch(/^[a-z-]+$/);
    }
  });

  it('recognizes only worker close codes', () => {
    expect(isWorkerCloseCode(4429)).toBe(true);
    expect(isWorkerCloseCode(1000)).toBe(false);
    expect(isWorkerCloseCode('4400')).toBe(false);
  });
});
