/**
 * Redis implementation of the Cache interface.
 * Used for HyDE document caching and opportunity graph.
 */

import { getRedisClient } from '../lib/redis';
import type { Cache, CacheOptions } from '../lib/protocol/interfaces/cache.interface';

const KEY_PREFIX = 'protocol:';

function fullKey(key: string): string {
  return key.startsWith(KEY_PREFIX) ? key : `${KEY_PREFIX}${key}`;
}

/**
 * Redis-backed cache adapter implementing the protocol Cache interface.
 * Values are JSON-serialized; TTL is supported per key.
 */
export class RedisCacheAdapter implements Cache {
  private redis = getRedisClient();

  async get<T>(key: string): Promise<T | null> {
    const k = fullKey(key);
    try {
      const raw = await this.redis.get(k);
      if (raw === null) return null;
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async set<T>(key: string, value: T, options?: CacheOptions): Promise<void> {
    const k = fullKey(key);
    const raw = JSON.stringify(value);
    if (options?.ttl != null && options.ttl > 0) {
      await this.redis.setex(k, options.ttl, raw);
    } else {
      await this.redis.set(k, raw);
    }
  }

  async delete(key: string): Promise<boolean> {
    const k = fullKey(key);
    const n = await this.redis.del(k);
    return n > 0;
  }

  async exists(key: string): Promise<boolean> {
    const k = fullKey(key);
    const n = await this.redis.exists(k);
    return n === 1;
  }

  async mget<T>(keys: string[]): Promise<(T | null)[]> {
    if (keys.length === 0) return [];
    const fullKeys = keys.map(fullKey);
    const rawList = await this.redis.mget(...fullKeys);
    return rawList.map((raw) => (raw === null ? null : (JSON.parse(raw) as T)));
  }

  async deleteByPattern(pattern: string): Promise<number> {
    const fullPattern = fullKey(pattern);
    const keys: string[] = [];
    let cursor = '0';
    do {
      const [nextCursor, batch] = await this.redis.scan(
        cursor,
        'MATCH',
        fullPattern,
        'COUNT',
        100
      );
      cursor = nextCursor;
      keys.push(...batch);
    } while (cursor !== '0');
    if (keys.length === 0) return 0;
    await this.redis.del(...keys);
    return keys.length;
  }
}
