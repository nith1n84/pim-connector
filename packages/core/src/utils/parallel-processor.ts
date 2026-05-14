/**
 * Utility for processing tasks in parallel with concurrency control.
 */
export class ParallelProcessor {
  /**
   * Processes an array of items using a processor function with a limit on active promises.
   * @param items - The items to process.
   * @param processor - The async function to apply to each item.
   * @param concurrency - Maximum number of simultaneous operations.
   * @returns Array of results in the same order as the input.
   */
  static async map<T, R>(
    items: T[],
    processor: (item: T) => Promise<R>,
    concurrency: number = 5,
  ): Promise<R[]> {
    const results: R[] = new Array(items.length);
    const executing: Array<{ promise: Promise<{ index: number; result: R }>; index: number }> = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const promise = processor(item).then((result) => ({ index: i, result }));

      executing.push({ promise, index: i });

      if (executing.length >= concurrency) {
        const completed = await Promise.race(executing.map((e) => e.promise));
        results[completed.index] = completed.result;

        const completedIndex = executing.findIndex((e) => e.index === completed.index);
        if (completedIndex > -1) {
          executing.splice(completedIndex, 1);
        }
      }
    }

    const remainingResults = await Promise.all(executing.map((e) => e.promise));
    for (const { index, result } of remainingResults) {
      results[index] = result;
    }

    return results;
  }
}
