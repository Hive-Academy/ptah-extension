/**
 * Parses a JSON string robustly.
 * Attempts standard JSON.parse first. If that fails, it attempts to repair
 * the string using `jsonrepair` and then parse the repaired string.
 *
 * @template T The expected type of the parsed object.
 * @param jsonString The JSON string to parse.
 * @returns A promise that resolves with the parsed object.
 * @throws An error if the string cannot be parsed even after repair.
 */
export async function parseRobustJson<T = unknown>(jsonString: string): Promise<T> {
  try {
    // Attempt standard parsing
    const result = JSON.parse(jsonString);
    return result;
  } catch (e1) {
    try {
      // Dynamic import for ESM module compatibility
      const { jsonrepair } = await import('jsonrepair');
      const repairedJson: string = jsonrepair(jsonString);
      // Attempt parsing the repaired string
      const parsedResult = JSON.parse(repairedJson);

      // Check if the repaired result is actually structured data (object or array)
      if (typeof parsedResult !== 'object' || parsedResult === null) {
        const preview =
          jsonString.length > 100
            ? `${jsonString.substring(0, 100)}...`
            : jsonString;
        throw new Error(
          `Repaired JSON parsed successfully but is not an object or array (type: ${typeof parsedResult}). Original string: "${preview}"`
        );
      }

      return parsedResult;
    } catch (e2) {
      const error = new Error(
        `Failed to parse JSON string even after repair. Initial Error: ${
          e1 instanceof Error ? e1.message : String(e1)
        }, Repair Error: ${e2 instanceof Error ? e2.message : String(e2)}`
      );
      return Promise.reject(error);
    }
  }
}
