import axios, { AxiosRequestConfig } from 'axios';

/**
 * Retry axios requests with exponential backoff
 */
export async function retryRequest<T>(
    config: AxiosRequestConfig,
    retries: number = 3,
    delay: number = 1000
): Promise<T> {
    let attempts = 0;

    while (attempts < retries) {
        try {
            const response = await axios(config);
            return response.data;
        } catch (error) {
            attempts++;

            if (attempts >= retries) {
                throw error;
            }

            // Exponential backoff
            await new Promise((resolve) => setTimeout(resolve, delay * Math.pow(2, attempts - 1)));
        }
    }

    throw new Error('Request failed after maximum retries');
}