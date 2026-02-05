import Redis, { RedisOptions } from 'ioredis';
import { log } from './log';

const logger = log.lib.from("lib/redis.ts");
let redis: Redis | null = null;

/**
 * Get the shared Redis client for general caching/operations.
 * Uses lazyConnect for efficiency in the main client.
 */
export function getRedisClient(): Redis {
  if (!redis) {
    // Use REDIS_URL if available, otherwise fall back to individual env vars
    const redisUrl = process.env.REDIS_URL;

    if (redisUrl) {
      redis = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        lazyConnect: true
      });
    } else {
      redis = new Redis({
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD,
        db: parseInt(process.env.REDIS_DB || '0'),
        maxRetriesPerRequest: 3,
        lazyConnect: true
      });
    }

    redis.on('error', (err: Error) => {
      logger.error('Redis error', { error: err.message });
    });

    redis.on('connect', () => {
      logger.info('Redis connected');
    });
  }

  return redis;
}

/**
 * Get BullMQ-compatible Redis connection options.
 * BullMQ requires:
 * - maxRetriesPerRequest: null (for blocking commands)
 * - lazyConnect: false (Workers need active connection to receive jobs)
 *
 * This function returns connection OPTIONS (not a client instance) for BullMQ
 * to create its own connections.
 */
export function getBullMQConnection(): RedisOptions {
  const redisUrl = process.env.REDIS_URL;

  if (redisUrl) {
    // Parse the URL to extract connection details
    // IORedis can accept a URL directly, but we need to set specific options
    const url = new URL(redisUrl);
    return {
      host: url.hostname,
      port: parseInt(url.port) || 6379,
      password: url.password || undefined,
      username: url.username || undefined,
      db: url.pathname ? parseInt(url.pathname.slice(1)) || 0 : 0,
      // BullMQ-specific requirements:
      maxRetriesPerRequest: null, // Required for BullMQ blocking commands
      lazyConnect: false, // Workers MUST connect immediately to receive jobs
      enableReadyCheck: false, // Faster connection for BullMQ
    };
  }

  return {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB || '0'),
    // BullMQ-specific requirements:
    maxRetriesPerRequest: null, // Required for BullMQ blocking commands
    lazyConnect: false, // Workers MUST connect immediately to receive jobs
    enableReadyCheck: false, // Faster connection for BullMQ
  };
}

export async function closeRedisConnection(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
  }
}

// Cache utility functions
export class CacheClient {
  private redis: Redis;

  constructor() {
    this.redis = getRedisClient();
  }

  async get(key: string): Promise<string | null> {
    try {
      return await this.redis.get(key);
    } catch (error) {
      logger.error('Cache get error', { key, error: error instanceof Error ? error.message : String(error) });
      return null;
    }
  }

  async set(key: string, value: string, ttl?: number): Promise<boolean> {
    try {
      if (ttl) {
        await this.redis.setex(key, ttl, value);
      } else {
        await this.redis.set(key, value);
      }
      return true;
    } catch (error) {
      logger.error('Cache set error', { key, error: error instanceof Error ? error.message : String(error) });
      return false;
    }
  }

  async del(key: string): Promise<boolean> {
    try {
      await this.redis.del(key);
      return true;
    } catch (error) {
      logger.error('Cache delete error', { key, error: error instanceof Error ? error.message : String(error) });
      return false;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      const result = await this.redis.exists(key);
      return result === 1;
    } catch (error) {
      logger.error('Cache exists error', { key, error: error instanceof Error ? error.message : String(error) });
      return false;
    }
  }

  async hget(key: string, field: string): Promise<string | null> {
    try {
      return await this.redis.hget(key, field);
    } catch (error) {
      logger.error('Cache hget error', { key, field, error: error instanceof Error ? error.message : String(error) });
      return null;
    }
  }

  async hset(key: string, field: string, value: string): Promise<boolean> {
    try {
      await this.redis.hset(key, field, value);
      return true;
    } catch (error) {
      logger.error('Cache hset error', { key, field, error: error instanceof Error ? error.message : String(error) });
      return false;
    }
  }

  async expire(key: string, ttl: number): Promise<boolean> {
    try {
      await this.redis.expire(key, ttl);
      return true;
    } catch (error) {
      logger.error('Cache expire error', { key, error: error instanceof Error ? error.message : String(error) });
      return false;
    }
  }
}

// Global cache instance
export const cache = new CacheClient(); 