// File: src/utils/apiCache.ts

import Redis from "ioredis";
import * as dotenv from "dotenv";
import crypto from "crypto";

dotenv.config();

/**
 * ApiCache class for caching Spotify API responses
 * Uses Redis for fast, distributed caching
 */
export class ApiCache {
  private redis: Redis | null = null;
  private cachePrefix = "spotify_cache:";
  private defaultTtl = 3600; // 1 hour default cache time

  // Cache TTL configurations for different endpoint types
  private ttlConfig = {
    user: 3600, // User profile - 1 hour
    playlists: 900, // Playlists list - 15 minutes
    playlist: 1800, // Individual playlist - 30 minutes
    tracks: 1800, // Tracks - 30 minutes
    artists: 86400, // Artists - 24 hours
    albums: 86400, // Albums - 24 hours
    search: 300, // Search results - 5 minutes
  };

  /**
   * Create a new ApiCache instance
   */
  constructor() {
    // Setup Redis if connection string is available
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
      try {
        this.redis = new Redis(redisUrl);
        console.log("Connected to Redis for API caching");
      } catch (error) {
        console.error("Failed to connect to Redis for caching:", error);
        console.warn("API caching disabled");
        this.redis = null;
      }
    } else {
      console.warn("REDIS_URL not found in environment, API caching disabled");
    }
  }

  /**
   * Generate a cache key for a request
   */
  private generateKey(
    endpoint: string,
    params: Record<string, any> = {},
    userId: string = "default"
  ): string {
    // Create a deterministic string representation of parameters
    const paramString = Object.entries(params)
      .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
      .map(([key, value]) => `${key}=${value}`)
      .join("&");

    // Create a hash of the endpoint and parameters
    const hash = crypto
      .createHash("md5")
      .update(`${endpoint}?${paramString}`)
      .digest("hex");

    return `${this.cachePrefix}${userId}:${hash}`;
  }

  /**
   * Determine the TTL based on the endpoint type
   */
  private getTtl(endpoint: string): number {
    // Extract the endpoint type from the URL path
    const path = endpoint.split("/").filter(Boolean);
    const type = path[path.length - 1].split("?")[0];

    // Return the appropriate TTL based on endpoint type
    return (
      this.ttlConfig[type as keyof typeof this.ttlConfig] || this.defaultTtl
    );
  }

  /**
   * Get a value from cache
   */
  async get<T>(
    endpoint: string,
    params: Record<string, any> = {},
    userId: string = "default"
  ): Promise<T | null> {
    if (!this.redis) return null;

    try {
      const key = this.generateKey(endpoint, params, userId);
      const data = await this.redis.get(key);

      if (!data) return null;

      return JSON.parse(data) as T;
    } catch (error) {
      console.error("Cache retrieval error:", error);
      return null;
    }
  }

  /**
   * Set a value in cache
   */
  async set<T>(
    endpoint: string,
    params: Record<string, any> = {},
    data: T,
    userId: string = "default"
  ): Promise<boolean> {
    if (!this.redis) return false;

    try {
      const key = this.generateKey(endpoint, params, userId);
      const ttl = this.getTtl(endpoint);

      await this.redis.set(key, JSON.stringify(data), "EX", ttl);

      return true;
    } catch (error) {
      console.error("Cache storage error:", error);
      return false;
    }
  }

  /**
   * Check if a key exists in cache
   */
  async exists(
    endpoint: string,
    params: Record<string, any> = {},
    userId: string = "default"
  ): Promise<boolean> {
    if (!this.redis) return false;

    try {
      const key = this.generateKey(endpoint, params, userId);
      const exists = await this.redis.exists(key);
      return exists === 1;
    } catch (error) {
      console.error("Cache exists check error:", error);
      return false;
    }
  }

  /**
   * Delete a specific cache entry
   */
  async delete(
    endpoint: string,
    params: Record<string, any> = {},
    userId: string = "default"
  ): Promise<boolean> {
    if (!this.redis) return false;

    try {
      const key = this.generateKey(endpoint, params, userId);
      await this.redis.del(key);
      return true;
    } catch (error) {
      console.error("Cache deletion error:", error);
      return false;
    }
  }

  /**
   * Clear all cache for a user
   */
  async clearUserCache(userId: string = "default"): Promise<boolean> {
    if (!this.redis) return false;

    try {
      const keys = await this.redis.keys(`${this.cachePrefix}${userId}:*`);

      if (keys.length > 0) {
        await this.redis.del(...keys);
        console.log(`Cleared ${keys.length} cache entries for user ${userId}`);
      }

      return true;
    } catch (error) {
      console.error("Cache clear error:", error);
      return false;
    }
  }

  /**
   * Close Redis connection when shutting down
   */
  async close(): Promise<void> {
    if (this.redis) {
      await this.redis.quit();
      console.log("Redis cache connection closed");
    }
  }
}

// Create and export default instance
const apiCache = new ApiCache();
export default apiCache;
