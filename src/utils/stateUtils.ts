// File: src/utils/stateUtils.ts

import { randomBytes } from "crypto";
import * as fs from "fs";
import { StoredState } from "../types/types"; // Adjust the import path as necessary

/**
 * Class for managing authentication state
 * Uses both in-memory and file storage for redundancy
 */
export class StateManager {
  private stateStore = new Map<string, StoredState>();
  private stateFile: string;
  private expirationMs: number;

  /**
   * Create a new StateManager
   * @param stateFile Path to the file for storing state
   * @param expirationMs Time in milliseconds after which states expire (default: 10 minutes)
   */
  constructor(
    stateFile = ".spotify_auth_state",
    expirationMs = 10 * 60 * 1000
  ) {
    this.stateFile = stateFile;
    this.expirationMs = expirationMs;
    console.log(`StateManager initialized with state file: ${stateFile}`);
  }

  /**
   * Generate a cryptographically secure random string of specified length
   */
  generateState(length = 16): string {
    const state = randomBytes(Math.ceil(length / 2))
      .toString("hex")
      .slice(0, length);
    console.log(`Generated new state: ${state}`);
    return state;
  }

  /**
   * Store state in both memory and file
   */
  saveState(state: string): void {
    try {
      // Clean up expired states first
      this.cleanExpiredStates();

      // Store in memory
      this.stateStore.set(state, {
        state,
        timestamp: Date.now(),
      });

      // Store in file as backup
      fs.writeFileSync(this.stateFile, state);

      console.log(`State stored successfully: ${state}`);
      console.log(
        `Current states in memory: ${Array.from(this.stateStore.keys()).join(
          ", "
        )}`
      );
    } catch (error) {
      console.error("Failed to save state:", error);
    }
  }

  /**
   * Verify if a state is valid (exists and hasn't expired)
   */
  verifyState(stateToVerify: string): boolean {
    console.log(`Verifying state: ${stateToVerify}`);
    console.log(
      `States in memory: ${Array.from(this.stateStore.keys()).join(", ")}`
    );

    try {
      // First check memory
      if (this.stateStore.has(stateToVerify)) {
        const storedState = this.stateStore.get(stateToVerify)!;
        const isExpired =
          Date.now() - storedState.timestamp > this.expirationMs;

        if (!isExpired) {
          console.log(`✓ State verified from memory: ${stateToVerify}`);
          return true;
        } else {
          console.log(`✗ State expired: ${stateToVerify}`);
          this.stateStore.delete(stateToVerify);
          return false;
        }
      }

      console.log(`State not found in memory, checking file...`);

      // Fallback to file check
      if (fs.existsSync(this.stateFile)) {
        const storedState = fs.readFileSync(this.stateFile, "utf8");
        console.log(
          `State comparison - Received: ${stateToVerify}, Stored in file: ${storedState}`
        );

        const result = storedState === stateToVerify;
        if (result) {
          console.log(`✓ State verified from file: ${stateToVerify}`);

          // Add it to memory for future checks
          this.stateStore.set(stateToVerify, {
            state: stateToVerify,
            timestamp: Date.now(),
          });
        } else {
          console.log(`✗ State mismatch in file: ${stateToVerify}`);
        }

        return result;
      } else {
        console.log(`✗ State file not found: ${this.stateFile}`);
      }
    } catch (error) {
      console.error("Error verifying state:", error);
    }

    console.log(`✗ State verification failed: ${stateToVerify}`);
    return false;
  }

  /**
   * Clean up a specific state
   */
  cleanupState(state: string): void {
    try {
      // Remove from memory
      this.stateStore.delete(state);
      console.log(`State removed from memory: ${state}`);

      // Remove from file if it matches
      if (fs.existsSync(this.stateFile)) {
        const fileState = fs.readFileSync(this.stateFile, "utf8");
        if (fileState === state) {
          fs.unlinkSync(this.stateFile);
          console.log(`State file deleted: ${this.stateFile}`);
        } else {
          console.log(`State file contains different state, not deleting`);
        }
      } else {
        console.log(`State file doesn't exist, nothing to clean up`);
      }
    } catch (error) {
      console.error("Error cleaning up state:", error);
    }
  }

  /**
   * Get all active states (for debugging)
   */
  getAllStates(): string[] {
    return Array.from(this.stateStore.keys());
  }

  /**
   * Clean up all expired states from memory
   */
  private cleanExpiredStates(): void {
    const now = Date.now();
    let expiredCount = 0;

    this.stateStore.forEach((value, key) => {
      if (now - value.timestamp > this.expirationMs) {
        this.stateStore.delete(key);
        expiredCount++;
      }
    });

    if (expiredCount > 0) {
      console.log(`Cleaned up ${expiredCount} expired states`);
    }
  }
}

// Create and export default instance
const stateManager = new StateManager();
export default stateManager;
