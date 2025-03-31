// File: src/utils/secureStateManager.ts

import { randomBytes, createCipheriv, createDecipheriv } from "crypto";
import * as crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import Redis from "ioredis";
import * as dotenv from "dotenv";
import UtilHelper from "./utilHelpers";

dotenv.config();

/**
 * Class for securely managing authentication state
 * Uses Redis for state storage and encrypted values
 */

export class SecureStateManager extends UtilHelper {
  constructor() {
    super();
    this.statePrefix = "spotify_auth_state:";
    this.stateExpirySeconds = 600; // 10 minutes
    this.algorithm = "aes-256-gcm";
    this.keyEnv = process.env.STATE_ENCRYPTION_KEY;

    // Generate a secure encryption key or use one from environment
    if (!this.keyEnv) {
      console.warn(
        "STATE_ENCRYPTION_KEY not found in environment, generating a temporary one"
      );
      // In production, this should be set in environment variables
      this.key = randomBytes(32);
    } else {
      // Convert hex string to buffer
      this.key = Buffer.from(this.keyEnv, "hex");
    }

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
   * Generate a cryptographically secure random state string
   */
  generateState(): string {
    return uuidv4();
  }
  /**
   * Encrypt a value
   */
  private encrypt(text: string): {
    encrypted: string;
    iv: string;
    authTag: string;
  } {
    const iv = randomBytes(16);
    const cipher = createCipheriv(
      this.algorithm,
      this.key,
      iv
    ) as crypto.CipherGCM;
    cipher.setAutoPadding(true);

    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");

    const authTag = cipher.getAuthTag().toString("hex");

    return {
      encrypted,
      iv: iv.toString("hex"),
      authTag,
    };
  }

  /**
   * Decrypt a value
   */
  private decrypt(
    encrypted: string,
    iv: string,
    authTag: string
  ): string | null {
    try {
      const decipher = createDecipheriv(
        this.algorithm,
        this.key,
        Buffer.from(iv, "hex")
      ) as crypto.DecipherGCM;

      decipher.setAuthTag(Buffer.from(authTag, "hex"));

      let decrypted = decipher.update(encrypted, "hex", "utf8");
      decrypted += decipher.final("utf8");

      return decrypted;
    } catch (error) {
      console.error("Decryption error:", error);
      return null;
    }
  }

  /**
   * Store state securely
   */
  async saveState(state: string): Promise<void> {
    const timestamp = Date.now();
    const stateData = JSON.stringify({ state, timestamp });

    try {
      if (this.redis) {
        // Store in Redis with expiration
        await this.redis.set(
          `${this.statePrefix}${state}`,
          stateData,
          "EX",
          this.stateExpirySeconds
        );
        console.log(`State stored securely in Redis: ${state}`);
      } else {
        // Fallback to memory storage with encryption
        const { encrypted, iv, authTag } = this.encrypt(stateData);

        // Store in a global variable for development (not ideal for production)
        global.authStates = global.authStates || {};
        global.authStates[state] = { encrypted, iv, authTag, timestamp };

        // Setup automatic cleanup
        setTimeout(() => {
          if (global.authStates && global.authStates[state]) {
            delete global.authStates[state];
          }
        }, this.stateExpirySeconds * 1000);

        console.log(`State stored with encryption in memory: ${state}`);
      }
    } catch (error) {
      console.error("Failed to save state:", error);
    }
  }

  /**
   * Verify if a state is valid
   */
  async verifyState(stateToVerify: string): Promise<boolean> {
    console.log(`Verifying state: ${stateToVerify}`);

    try {
      if (this.redis) {
        const storedData = await this.redis.get(
          `${this.statePrefix}${stateToVerify}`
        );

        if (!storedData) {
          console.log(`State not found in Redis: ${stateToVerify}`);
          return false;
        }

        const { state, timestamp } = JSON.parse(storedData);
        const isValid = state === stateToVerify;

        if (isValid) {
          console.log(`State verified in Redis: ${stateToVerify}`);
          // Delete the used state
          await this.redis.del(`${this.statePrefix}${stateToVerify}`);
        }

        return isValid;
      } else {
        // Fallback to in-memory storage
        if (!global.authStates || !global.authStates[stateToVerify]) {
          console.log(`State not found in memory: ${stateToVerify}`);
          return false;
        }

        const { encrypted, iv, authTag, timestamp } =
          global.authStates[stateToVerify];

        // Decrypt the stored state
        const decrypted = this.decrypt(encrypted, iv, authTag);
        if (!decrypted) {
          console.log(`Failed to decrypt state: ${stateToVerify}`);
          return false;
        }

        const { state } = JSON.parse(decrypted);
        const isValid = state === stateToVerify;

        if (isValid) {
          console.log(`State verified in memory: ${stateToVerify}`);
          // Delete the used state
          delete global.authStates[stateToVerify];
        }

        return isValid;
      }
    } catch (error) {
      console.error("Error verifying state:", error);
      return false;
    }
  }

  /**
   * Clean up a specific state
   */
  async cleanupState(state: string): Promise<void> {
    try {
      if (this.redis) {
        await this.redis.del(`${this.statePrefix}${state}`);
        console.log(`State removed from Redis: ${state}`);
      } else if (global.authStates && global.authStates[state]) {
        delete global.authStates[state];
        console.log(`State removed from memory: ${state}`);
      }
    } catch (error) {
      console.error("Error cleaning up state:", error);
    }
  }

  /**
   * Clean up all expired states (for in-memory storage)
   */
  async cleanExpiredStates(): Promise<void> {
    if (!this.redis && global.authStates) {
      const now = Date.now();
      const expiredStates = [];

      for (const [state, { timestamp }] of Object.entries(global.authStates)) {
        if (now - timestamp > this.stateExpirySeconds * 1000) {
          delete global.authStates[state];
          expiredStates.push(state);
        }
      }

      if (expiredStates.length > 0) {
        console.log(`Cleaned up ${expiredStates.length} expired states`);
      }
    }
  }

  getStateExpirySeconds(): number {
    return this.stateExpirySeconds;
  }
  getKey(): Buffer {
    return this.key;
  }
  getAlgorithm(): string {
    return this.algorithm;
  }
  getKeyEnv(): string | undefined {
    return this.keyEnv;
  }
  getStateStore(): Redis | null {
    return this.redis;
  }
}

// Create and export default instance
const secureStateManager = new SecureStateManager();
export default secureStateManager;

// For TypeScript global augmentation
declare global {
  var authStates: {
    [key: string]: {
      encrypted: string;
      iv: string;
      authTag: string;
      timestamp: number;
    };
  };
}
