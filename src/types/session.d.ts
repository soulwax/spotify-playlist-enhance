// File: src/types/session.d.ts

import "express-session";

declare module "express-session" {
  interface SessionData {
    // Authentication state used for Spotify OAuth CSRF protection
    authState?: string;

    // Authentication status
    isAuthenticated?: boolean;

    // Token expiration timestamp as ISO string
    expiresAt?: string;

    // Any other session data you might want to store
    userId?: string;
    displayName?: string;
  }
}
