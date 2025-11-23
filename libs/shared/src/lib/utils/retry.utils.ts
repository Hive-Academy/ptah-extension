/**
 * Represents the options for the retryWithBackoff function.
 */
interface RetryOptions {
  /** Maximum number of retries */
  retries: number;
  /** Initial delay in milliseconds */
  initialDelay: number;
  /** Function to determine if an error is retriable */
  shouldRetry: (error: any) => boolean;
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
  let lastError: any;
  for (let attempt = 0; attempt <= options.retries; attempt++) {
    try {
      // Attempt to execute the asynchronous function
      return await asyncFn();
    } catch (error) {
      lastError = error;

      // Check if we've reached the maximum number of retries or if the error is not retriable
      if (attempt === options.retries || !options.shouldRetry(error)) {
        // Log the final failure before throwing (optional, but helpful)
        // console.error(`Retry failed after ${attempt + 1} attempts. Final error: ${error instanceof Error ? error.message : String(error)}`);
        throw lastError;
      }

      // Calculate delay with exponential backoff (base 2)
      const baseDelay = options.initialDelay * 2 ** attempt;

      // Add jitter: delay +/- 20%
      // (Math.random() * 0.4 + 0.8) generates a random number between 0.8 and 1.2
      const jitterDelay = baseDelay * (Math.random() * 0.4 + 0.8);

      // Log the retry attempt and the calculated delay (optional, but helpful for debugging)
      // console.log(`Retry attempt ${attempt + 1} failed with error: ${error instanceof Error ? error.message : String(error)}. Retrying in ${jitterDelay.toFixed(0)}ms...`);

      // Wait for the calculated jitter delay before the next attempt
      await new Promise((resolve) => setTimeout(resolve, jitterDelay));
    }
  }

  // This line should theoretically be unreachable due to the throw inside the loop,
  // but it's included as a safeguard.
  // console.error("Reached unreachable code in retryWithBackoff. Throwing last known error.");
  throw lastError;
}
