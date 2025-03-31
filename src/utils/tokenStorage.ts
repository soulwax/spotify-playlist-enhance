// File: src/utils/tokenStorage.ts

import * as fs from "fs";
import Redis from "ioredis";
import * as dotenv from "dotenv";
import { TokenData } from "../types/types";

dotenv.config();

/**
 * TokenStorage class for managing Spotify access tokens
 * Uses Redis for primary storage with file-based fallback
 */
export class TokenStorage {
  private redis: Redis | null = null;
  private tokenPrefix = "spotify_tokens:";
  private isProduction: boolean;

  /**
   * Create a new TokenStorage instance
   */
  constructor() {
    this.isProduction = process.env.NODE_ENV === "production";

    // Setup Redis if connection string is available
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
      try {
        console.log("Connecting to Redis...");

        // Create a connection timeout
        const connectionTimeout = setTimeout(() => {
          console.error("Redis connection timeout after 5 seconds");
          console.log("Falling back to memory storage");
          this.redis = null;
        }, 5000); // 5 second timeout

        this.redis = new Redis(redisUrl);

        // Add event listeners for successful connection and errors
        this.redis.on("connect", () => {
          clearTimeout(connectionTimeout);
          console.log("Successfully connected to Redis");
        });

        this.redis.on("error", (err) => {
          console.error("Redis connection error:", err);
          if (this.redis) {
            this.redis
              .quit()
              .catch((e) =>
                console.error("Error closing Redis connection:", e)
              );
            this.redis = null;
          }
        });
      } catch (error) {
        console.error("Failed to connect to Redis:", error);
        console.warn("Falling back to memory storage");
        this.redis = null;
      }
    } else {
      console.warn("REDIS_URL not found in environment, using memory storage");
    }
  }

  /**
   * Get the appropriate token key/filename based on environment
   */
  private getTokenKey(userId: string = "default"): string {
    const envSuffix = this.isProduction ? "prod" : "dev";
    return this.redis
      ? `${this.tokenPrefix}${userId}:${envSuffix}`
      : `.spotify-tokens-${envSuffix}.json`;
  }

  /**
   * Store tokens for a user
   */
  async saveTokens(
    tokens: TokenData,
    userId: string = "default"
  ): Promise<void> {
    const tokenKey = this.getTokenKey(userId);

    try {
      if (this.redis) {
        // Store in Redis with expiration aligned with token expiry
        // Add 30 minutes buffer to token expiry for Redis TTL
        const ttlSeconds = tokens.expires_in + 30 * 60;

        await this.redis.set(
          tokenKey,
          JSON.stringify(tokens),
          "EX",
          ttlSeconds
        );
        console.log(`Tokens stored in Redis for user ${userId}`);
      } else {
        // Fallback to file storage
        fs.writeFileSync(tokenKey, JSON.stringify(tokens, null, 2), "utf8");
        console.log(
          `Tokens stored in file for environment ${
            this.isProduction ? "production" : "development"
          }`
        );
      }
    } catch (error) {
      console.error("Failed to save tokens:", error);
      throw error;
    }
  }

  /**
   * Get tokens for a user
   */
  async getTokens(userId: string = "default"): Promise<TokenData | null> {
    const tokenKey = this.getTokenKey(userId);

    try {
      if (this.redis) {
        // Get from Redis
        const data = await this.redis.get(tokenKey);
        if (!data) return null;

        return JSON.parse(data) as TokenData;
      } else {
        // Fallback to file storage
        if (!fs.existsSync(tokenKey)) return null;

        const data = fs.readFileSync(tokenKey, "utf8");
        return JSON.parse(data) as TokenData;
      }
    } catch (error) {
      console.error("Failed to get tokens:", error);
      return null;
    }
  }

  /**
   * Remove tokens for a user (logout)
   */
  async removeTokens(userId: string = "default"): Promise<boolean> {
    const tokenKey = this.getTokenKey(userId);

    try {
      if (this.redis) {
        // Remove from Redis
        await this.redis.del(tokenKey);
      } else if (fs.existsSync(tokenKey)) {
        // Remove file
        fs.unlinkSync(tokenKey);
      }

      console.log(`Tokens removed for user ${userId}`);
      return true;
    } catch (error) {
      console.error("Failed to remove tokens:", error);
      return false;
    }
  }

  /**
   * Check if tokens are expired
   */
  isTokenExpired(tokens: TokenData): boolean {
    const now = new Date();
    const expiresAt = new Date(tokens.expires_at);
    return now >= expiresAt;
  }

  /**
   * Close Redis connection when shutting down
   */
  async close(): Promise<void> {
    if (this.redis) {
      await this.redis.quit();
      console.log("Redis connection closed");
    }
  }

  getRedisStatus = (): boolean => {
    return this.redis !== null;
  };
}

// Create and export default instance
const tokenStorage = new TokenStorage();
export default tokenStorage;
