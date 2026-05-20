/**
 * Represents the options for the retryWithBackoff function.
 */
interface RetryOptions {
  /** Maximum number of retries */
  retries: number;
  /** Initial delay in milliseconds */
  initialDelay: number;
  /** Function to determine if an error is retriable */
  shouldRetry: (error: unknown) => boolean;
}

/**
 * Retries an asynchronous function with exponential backoff and jitter.
 *
 * @template T The return type of the asynchronous function.
 * @param {() => Promise<T>} asyncFn The asynchronous function to retry.
 * @param {RetryOptions} options The retry configuration options.
 * @returns {Promise<T>} A promise that resolves with the result of the async function if successful,
 *                       or rejects with the last error after exhausting retries or if shouldRetry returns false.
 */
export async function retryWithBackoff<T>(
  asyncFn: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= options.retries; attempt++) {
    try {
      return await asyncFn();
    } catch (error) {
      lastError = error;
      if (attempt === options.retries || !options.shouldRetry(error)) {
        throw lastError;
      }
      const baseDelay = options.initialDelay * 2 ** attempt;
      const jitterDelay = baseDelay * (Math.random() * 0.4 + 0.8);
      await new Promise((resolve) => setTimeout(resolve, jitterDelay));
    }
  }
  throw lastError;
}
