// File: src/utils/utilHelpers.ts

import Redis from "ioredis";
import * as dotenv from "dotenv";
import { randomBytes } from "crypto";
import { createCipheriv, createDecipheriv } from "crypto";
dotenv.config();

class UtilHelper {
  protected redis: Redis | null;
  protected statePrefix: string;
  protected stateExpirySeconds: number;
  protected key: Buffer;
  protected algorithm: string;
  protected keyEnv?: string;

  constructor() {
    // Initialize your class properties here
    this.redis = null;
    this.statePrefix = "";
    this.stateExpirySeconds = 0;
    this.key = Buffer.alloc(0);
    this.algorithm = "";
  }

  getRedisStatus = (): boolean => {
    return this.redis !== null;
  };

  getStatePrefix = (): string => {
    return this.statePrefix;
  };

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

export default UtilHelper;
