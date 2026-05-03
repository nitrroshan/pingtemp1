import Redis from 'ioredis';

const redisClient = new Redis({
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: Number(process.env.REDIS_PORT) || 6379,
});

/**
 * Set a value in Redis with an expiration time.
 */
export async function setCache(key: string, value: string, ttl: number): Promise<void> {
    await redisClient.set(key, value, 'EX', ttl);
}

/**
 * Get a value from Redis by key.
 */
export async function getCache(key: string): Promise<string | null> {
    return redisClient.get(key);
}

/**
 * Increment a value in Redis.
 */
export async function incrementCache(key: string): Promise<number> {
    return redisClient.incr(key);
}

/**
 * Delete a key from Redis.
 */
export async function deleteCache(key: string): Promise<void> {
    await redisClient.del(key);
}

export { redisClient };