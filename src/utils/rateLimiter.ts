// File: src/utils/rateLimiter.ts

import Redis from "ioredis";
import * as dotenv from "dotenv";

dotenv.config();

/**
 * RateLimiter class for protecting Spotify API from excessive requests
 * Uses Redis for distributed rate limiting
 */
export class RateLimiter {
  private redis: Redis | null = null;
  private ratePrefix = "spotify_rate:";

  // Default rate limits
  private readonly defaultLimit = 100; // 100 requests allowed
  private readonly defaultWindow = 3600; // per hour (in seconds)

  // Endpoint-specific rate limits (requests per window)
  private rateLimits: Record<string, { limit: number; window: number }> = {
    // Global limits (per hour)
    global: { limit: 1000, window: 3600 },

    // Endpoint-specific limits
    "/me": { limit: 60, window: 60 }, // 60 requests per minute for user profile
    "/me/playlists": { limit: 30, window: 60 }, // 30 requests per minute for user playlists
    "/playlists": { limit: 30, window: 60 }, // 30 requests per minute for playlists
    "/tracks": { limit: 120, window: 60 }, // 120 requests per minute for tracks
    "/search": { limit: 30, window: 60 }, // 30 requests per minute for search
  };

  /**
   * Create a new RateLimiter instance
   */
  constructor() {
    // Setup Redis if connection string is available
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
      try {
        this.redis = new Redis(redisUrl);
        console.log("Connected to Redis for rate limiting");
      } catch (error) {
        console.error("Failed to connect to Redis for rate limiting:", error);
        console.warn("Rate limiting disabled");
        this.redis = null;
      }
    } else {
      console.warn(
        "REDIS_URL not found in environment, rate limiting disabled"
      );
    }
  }

  /**
   * Get rate limit configuration for an endpoint
   */
  private getRateConfig(endpoint: string): { limit: number; window: number } {
    // Find the most specific matching endpoint
    const matchingEndpoint = Object.keys(this.rateLimits)
      .filter((path) => endpoint.includes(path))
      .sort((a, b) => b.length - a.length)[0];

    return matchingEndpoint
      ? this.rateLimits[matchingEndpoint]
      : { limit: this.defaultLimit, window: this.defaultWindow };
  }

  /**
   * Check if a request exceeds the rate limit
   * @returns Object with allowed (boolean), remaining (number), resetTime (Date)
   */
  async checkLimit(
    endpoint: string,
    userId: string = "default"
  ): Promise<{
    allowed: boolean;
    remaining: number;
    resetTime: Date;
    limit: number;
  }> {
    // If Redis is not available, allow all requests
    if (!this.redis) {
      return {
        allowed: true,
        remaining: 999,
        resetTime: new Date(Date.now() + 3600000),
        limit: 999,
      };
    }

    try {
      // Get rate configuration for this endpoint
      const config = this.getRateConfig(endpoint);

      // Create keys for both endpoint-specific and global rate limiting
      const endpointKey = `${this.ratePrefix}${userId}:${endpoint}`;
      const globalKey = `${this.ratePrefix}${userId}:global`;

      const now = Math.floor(Date.now() / 1000);
      const windowStart = now - config.window;

      // Begin transaction
      const multi = this.redis.multi();

      // Remove old entries outside current window
      multi.zremrangebyscore(endpointKey, 0, windowStart);
      multi.zremrangebyscore(globalKey, 0, windowStart);

      // Count current requests in window
      multi.zcard(endpointKey);
      multi.zcard(globalKey);

      // Add this request with current timestamp
      multi.zadd(
        endpointKey,
        now,
        `${now}-${Math.random().toString(36).substring(2, 15)}`
      );
      multi.zadd(
        globalKey,
        now,
        `${now}-${Math.random().toString(36).substring(2, 15)}`
      );

      // Set expiry on the sorted sets
      multi.expire(endpointKey, config.window);
      multi.expire(globalKey, this.rateLimits.global.window);

      // Execute all commands
      const results = await multi.exec();

      // Get counts from results (results format is [err, result] tuples)
      const endpointCount =
        results && results[2] ? (results[2][1] as number) : 0;
      const globalCount = results && results[3] ? (results[3][1] as number) : 0;

      // Check against both endpoint and global limits
      const endpointAllowed = endpointCount <= config.limit;
      const globalAllowed = globalCount <= this.rateLimits.global.limit;
      const allowed = endpointAllowed && globalAllowed;

      // Calculate remaining requests (take the lower of the two)
      const endpointRemaining = Math.max(0, config.limit - endpointCount);
      const globalRemaining = Math.max(
        0,
        this.rateLimits.global.limit - globalCount
      );
      const remaining = Math.min(endpointRemaining, globalRemaining);

      // Calculate reset time
      const resetTime = new Date((now + config.window) * 1000);

      return {
        allowed,
        remaining,
        resetTime,
        limit: config.limit,
      };
    } catch (error) {
      console.error("Rate limit check error:", error);
      // In case of error, allow the request to proceed
      return {
        allowed: true,
        remaining: 999,
        resetTime: new Date(Date.now() + 3600000),
        limit: 999,
      };
    }
  }

  /**
   * Close Redis connection when shutting down
   */
  async close(): Promise<void> {
    if (this.redis) {
      await this.redis.quit();
      console.log("Redis rate limiter connection closed");
    }
  }
}

// Create and export default instance
const rateLimiter = new RateLimiter();
export default rateLimiter;
