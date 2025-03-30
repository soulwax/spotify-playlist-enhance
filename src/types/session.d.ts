// File: src/types/session.d.ts

import "express-session";

declare module "express-session" {
  interface Session {
    // Authentication state used for Spotify OAuth CSRF protection
    authState?: string;

    // Authentication status
    isAuthenticated?: boolean;

    // Token expiration timestamp as ISO string
    expiresAt?: string;

    // User identifier for multi-user support
    userId?: string;
  }
}
