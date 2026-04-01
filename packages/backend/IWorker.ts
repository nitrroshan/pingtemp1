/**
 * Generic Worker interface for extensible worker implementations.
 * @template TInput - Input type for the worker
 * @template TOutput - Output type for the worker
 */
export interface IWorker<TInput = any, TOutput = any> {
	/**
	 * Executes the worker logic with the given input.
	 * @param input - Input data for the worker
	 * @returns Promise resolving to output data
	 */
	execute(input: TInput): Promise<TOutput>;
}
