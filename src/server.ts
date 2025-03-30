// File: src/server.ts

import * as dotenv from "dotenv";
import express, { NextFunction, Request, Response } from "express";
import session from "express-session";

declare module "express-session" {
  interface Session {
    authState?: string;
    isAuthenticated?: boolean;
    expiresAt?: string;
    userId?: string;
  }
}

import * as fs from "fs";
import fetch from "node-fetch";
import open from "open";
import path from "path";
import cookieParser from "cookie-parser";
import {
  AuthStatusResponse,
  SpotifyAuthConfig,
  SpotifyPlaylistsResponse,
  SpotifyUser,
  TokenData,
} from "./types/types";
import secureStateManager from "./utils/secureStateManager";
import tokenStorage from "./utils/tokenStorage";
import apiCache from "./utils/apiCache";
import rateLimiter from "./utils/rateLimiter";
import spotifyClient from "./utils/spotifyClient";
// Import this declaration file to ensure TypeScript knows about our session properties

// Redis session store setup - conditionally imported
let RedisStore: any;
let Redis: any;
try {
  // Only require Redis related modules if REDIS_URL is set
  if (process.env.REDIS_URL) {
    RedisStore = require("connect-redis").default;
    Redis = require("ioredis");
  }
} catch (error) {
  console.warn(
    "Redis modules not available, falling back to memory session store"
  );
}

// Initialize environment variables
dotenv.config();

// Add a flag to detect Redis connection issues
let redisAvailable = false;

// Function to check if Redis is available
async function checkRedisAvailability() {
  try {
    if (process.env.REDIS_URL) {
      console.log("Checking Redis availability...");

      // Try to connect to Redis
      const redis = new Redis(process.env.REDIS_URL);

      // Set a timeout for the connection
      const connectionPromise = new Promise((resolve, reject) => {
        redis.on("connect", () => {
          redis.disconnect();
          resolve(true);
        });

        redis.on("error", (err: any) => {
          redis.disconnect();
          reject(err);
        });
      });

      // Create a timeout promise
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Redis connection timeout")), 5000)
      );

      // Race the connection against the timeout
      await Promise.race([connectionPromise, timeoutPromise]);

      console.log("Redis is available");
      return true;
    }
    return false;
  } catch (error) {
    console.error("Redis is unavailable:", error);
    return false;
  }
}

// --- Configuration ---
const isProduction = process.env.NODE_ENV === "production";

const config: SpotifyAuthConfig = {
  clientId: process.env.SPOTIFY_CLIENT_ID ?? "",
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET ?? "",
  redirectUri:
    (process.env.SPOTIFY_REDIRECT_URLS || "")
      .split(",")
      [isProduction ? 1 : 0]?.trim() ?? "",
  scopes:
    "user-read-private user-read-email playlist-read-private user-modify-playback-state",
  port: parseInt(process.env.PORT ?? "3030", 10),
  isProduction,
};

// --- Helper Functions ---
function getTokensFromFile(): TokenData | null {
  const tokensFilename = config.isProduction
    ? ".spotify-tokens-prod.json"
    : ".spotify-tokens-dev.json";

  try {
    if (fs.existsSync(tokensFilename)) {
      console.log(`Reading tokens from ${tokensFilename}`);
      const data = fs.readFileSync(tokensFilename, "utf8");

      try {
        const parsedData = JSON.parse(data);

        // Validate that the parsed data matches the TokenData interface
        if (
          typeof parsedData.access_token === "string" &&
          typeof parsedData.token_type === "string" &&
          typeof parsedData.expires_in === "number" &&
          typeof parsedData.refresh_token === "string" &&
          typeof parsedData.expires_at === "string"
        ) {
          return parsedData as TokenData;
        } else {
          console.error("Token data is missing required fields");
          return null;
        }
      } catch (error) {
        console.error(`Error parsing token JSON: ${error}`);
        return null;
      }
    }
  } catch (error) {
    console.error("Failed to read tokens from file:", error);
  }
  return null;
}

// --- Middleware ---
function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();

  // Log at the end of the request
  res.on("finish", () => {
    const duration = Date.now() - start;
    console.log(
      `[${new Date().toISOString()}] ${req.method} ${req.originalUrl} - ${
        res.statusCode
      } (${duration}ms)`
    );
  });

  next();
}

// --- Main Function ---
async function startServer(): Promise<any> {
  console.log(
    `--- Spotify Playlist App (${
      config.isProduction ? "PRODUCTION" : "DEVELOPMENT"
    } Mode) ---`
  );

  // Check Redis availability first
  redisAvailable = await checkRedisAvailability();

  if (!redisAvailable) {
    console.warn("Redis is unavailable - running in fallback mode");
    // Force environment variables to disable Redis features
    process.env.USE_REDIS = "false";
  }

  // Validation checks
  if (!config.clientId || !config.clientSecret || !config.redirectUri) {
    console.error(
      "ERROR: Missing required environment variables. Please check SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, and SPOTIFY_REDIRECT_URLS in your .env file."
    );
    process.exit(1);
  }

  console.log(`Using redirect URI: ${config.redirectUri}`);

  const app = express();

  app.use(requestLogger);
  app.use(cookieParser(process.env.COOKIE_SECRET || "spotify-playlist-secret"));

  // Setup session middleware
  const sessionConfig: session.SessionOptions = {
    secret: process.env.SESSION_SECRET || "spotify-session-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: isProduction, // Use secure cookies in production
      httpOnly: true, // Cookies not accessible via JavaScript
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      sameSite: "lax", // Helps protect against CSRF
    },
  };

  // Use Redis session store if available
  if (redisAvailable && process.env.REDIS_URL && RedisStore && Redis) {
    console.log("Using Redis session store");
    const redisClient = new Redis(process.env.REDIS_URL);
    sessionConfig.store = new RedisStore({ client: redisClient });
  } else {
    console.log(
      "Using in-memory session store (not recommended for production)"
    );

    // Warning for production mode without Redis
    if (isProduction) {
      console.warn(
        "WARNING: Running in production mode without Redis. This is not recommended for production deployment."
      );
      console.warn("To use Redis, set the REDIS_URL environment variable.");
    }
  }

  app.use(session(sessionConfig));

  // Serve static files from the public directory
  app.use(express.static(path.join(__dirname, "..", "public")));

  // Health check endpoint that doesn't require Redis
  app.get("/health", (req: Request, res: Response) => {
    const healthData = {
      status: "ok",
      timestamp: new Date().toISOString(),
      redis: {
        available: redisAvailable,
        secureState: secureStateManager.getRedisStatus?.() || false,
        tokenStorage: tokenStorage.getRedisStatus?.() || false,
        apiCache: apiCache.getRedisStatus?.() || false,
        rateLimiter: rateLimiter.getRedisStatus?.() || false,
      },
      uptime: process.uptime(),
    };

    res.json(healthData);
  });

  // Route for login
  app.get("/login", async (req: Request, res: Response) => {
    // Generate a new state for this login request
    const state = secureStateManager.generateState();
    await secureStateManager.saveState(state);

    // Store state in session as a backup using type assertion
    (req.session as any).authState = state;

    const url = new URL("https://accounts.spotify.com/authorize");
    url.searchParams.append("response_type", "code");
    url.searchParams.append("client_id", config.clientId);
    url.searchParams.append("scope", config.scopes);
    url.searchParams.append("redirect_uri", config.redirectUri);
    url.searchParams.append("state", state);

    console.log(`Redirecting to Spotify with state: ${state}`);
    res.redirect(url.toString());
  });

  // Callback route
  app.get("/api/spotify/callback", async (req: Request, res: Response) => {
    try {
      const { code, state: receivedState } = req.query;

      console.log(`Callback received with state: ${receivedState}`);

      if (!code || typeof code !== "string") {
        return res.status(400).send("Authorization code not found.");
      }

      if (!receivedState || typeof receivedState !== "string") {
        return res.status(400).send("State parameter not found.");
      }

      // Verify the state through secure state manager
      const isValidState = await secureStateManager.verifyState(receivedState);

      // Double check with session as fallback
      const sessionState = (req.session as any).authState;
      const isValidSessionState = sessionState === receivedState;

      // Clear session state
      (req.session as any).authState = undefined;

      if (!isValidState && !isValidSessionState) {
        console.error(
          `State mismatch. Received: ${receivedState}, Session: ${sessionState}`
        );
        return res.status(400).send(`
          <h1>State Mismatch Error</h1>
          <p>We couldn't verify that the authentication request originated from this application.</p>
          <p>This could be due to:</p>
          <ul>
            <li>Session timeout</li>
            <li>Multiple login attempts</li>
            <li>Browser settings blocking cookies</li>
          </ul>
          <p><a href="/">Try logging in again</a></p>
        `);
      }

      // Exchange the authorization code for tokens
      const tokenResponse = await fetch(
        "https://accounts.spotify.com/api/token",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization:
              "Basic " +
              Buffer.from(`${config.clientId}:${config.clientSecret}`).toString(
                "base64"
              ),
          },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: config.redirectUri,
          }).toString(),
        }
      );

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        console.error("Token exchange error:", errorText);
        return res
          .status(tokenResponse.status)
          .send("Failed to exchange token.");
      }

      const tokenData: TokenData = (await tokenResponse.json()) as TokenData;
      tokenData.expires_at = new Date(
        Date.now() + tokenData.expires_in * 1000
      ).toISOString(); // Use ISO format instead of locale string

      // Store tokens using Redis if available, otherwise fall back to file
      if (redisAvailable) {
        await tokenStorage.saveTokens(tokenData);
      } else {
        // Fallback to file storage
        const tokensFilename = config.isProduction
          ? ".spotify-tokens-prod.json"
          : ".spotify-tokens-dev.json";
        fs.writeFileSync(
          tokensFilename,
          JSON.stringify(tokenData, null, 2),
          "utf8"
        );
      }

      // Store authentication status in session
      (req.session as any).isAuthenticated = true;
      (req.session as any).expiresAt = tokenData.expires_at;

      // Store user ID in session if needed later for multi-user support
      (req.session as any).userId = "default";

      console.log(`Token obtained successfully, redirecting to playlists page`);

      // Redirect to the playlists page
      res.redirect("/playlists");
    } catch (error) {
      console.error("Error during callback processing:", error);
      res.status(500).send("Internal server error.");
    }
  });

  // API endpoint to get user playlists - Enhanced with Redis
  app.get("/api/playlists", async (req: Request, res: Response) => {
    try {
      if (redisAvailable) {
        // Check rate limits first
        const rateCheck = await rateLimiter.checkLimit("/me/playlists");
        if (!rateCheck.allowed) {
          return res.status(429).json({
            error: "Rate limit exceeded",
            resetAt: rateCheck.resetTime,
            limit: rateCheck.limit,
          });
        }

        // Get pagination parameters
        const offset = parseInt(req.query.offset as string) || 0;
        const limit = parseInt(req.query.limit as string) || 20;

        // Use our Spotify client with built-in caching
        try {
          const playlistsData = await spotifyClient.getCurrentUserPlaylists(
            offset,
            limit
          );
          return res.json(playlistsData);
        } catch (error: any) {
          if (error.message.includes("No authentication tokens")) {
            return res.status(401).json({ error: "Not authenticated" });
          }
          throw error;
        }
      } else {
        // Fallback to original implementation without Redis
        const tokens = getTokensFromFile();

        if (!tokens) {
          return res.status(401).json({ error: "Not authenticated" });
        }

        // Check if token is expired
        const now = new Date();
        const expiresAt = new Date(tokens.expires_at);

        if (now > expiresAt) {
          return res.status(401).json({ error: "Token expired" });
        }

        // Get pagination parameters
        const offset = parseInt(req.query.offset as string) || 0;
        const limit = parseInt(req.query.limit as string) || 20;

        const playlistsResponse = await fetch(
          `https://api.spotify.com/v1/me/playlists?offset=${offset}&limit=${limit}`,
          {
            headers: {
              Authorization: `Bearer ${tokens.access_token}`,
            },
          }
        );

        if (!playlistsResponse.ok) {
          return res.status(playlistsResponse.status).json({
            error: "Failed to fetch playlists",
          });
        }

        const playlistsData: SpotifyPlaylistsResponse =
          (await playlistsResponse.json()) as SpotifyPlaylistsResponse;
        return res.json(playlistsData);
      }
    } catch (error) {
      console.error("Error fetching playlists:", error);
      res.status(500).json({ error: "Server error" });
    }
  });

  // API endpoint to get current user profile - Enhanced with Redis
  app.get("/api/user", async (req: Request, res: Response) => {
    try {
      if (redisAvailable) {
        // Check rate limits first
        const rateCheck = await rateLimiter.checkLimit("/me");
        if (!rateCheck.allowed) {
          return res.status(429).json({
            error: "Rate limit exceeded",
            resetAt: rateCheck.resetTime,
            limit: rateCheck.limit,
          });
        }

        // Use our Spotify client with built-in caching
        try {
          const userData = await spotifyClient.getCurrentUser();
          return res.json(userData);
        } catch (error: any) {
          if (error.message.includes("No authentication tokens")) {
            return res.status(401).json({ error: "Not authenticated" });
          }
          throw error;
        }
      } else {
        // Fallback to original implementation without Redis
        const tokens = getTokensFromFile();

        if (!tokens) {
          return res.status(401).json({ error: "Not authenticated" });
        }

        const userResponse = await fetch("https://api.spotify.com/v1/me", {
          headers: {
            Authorization: `Bearer ${tokens.access_token}`,
          },
        });

        if (!userResponse.ok) {
          return res.status(userResponse.status).json({
            error: "Failed to fetch user profile",
          });
        }

        const userData: SpotifyUser =
          (await userResponse.json()) as SpotifyUser;
        return res.json(userData);
      }
    } catch (error) {
      console.error("Error fetching user profile:", error);
      res.status(500).json({ error: "Server error" });
    }
  });

  // Check auth status - using Redis token storage if available
  app.get("/api/auth-status", async (req: Request, res: Response) => {
    try {
      // First check session
      if (
        (req.session as any).isAuthenticated &&
        (req.session as any).expiresAt
      ) {
        const now = Date.now();
        const expiresAt =
          new Date((req.session as any).expiresAt).getTime() + 5 * 60 * 1000; // 5 min buffer

        if (now < expiresAt) {
          return res.json({
            authenticated: true,
            expiresAt: (req.session as any).expiresAt,
          });
        }
      }

      // Get tokens from appropriate source
      let tokens: TokenData | null;

      if (redisAvailable) {
        // Get from Redis
        tokens = await tokenStorage.getTokens();
      } else {
        // Fallback to file
        tokens = getTokensFromFile();
      }

      if (!tokens) {
        const response: AuthStatusResponse = { authenticated: false };
        return res.json(response);
      }

      // Check if token is expired
      const now = Date.now();
      const expiresAt = new Date(tokens.expires_at).getTime() + 5 * 60 * 1000;
      const isAuthenticated = now < expiresAt;

      // Update session if authenticated via token
      if (isAuthenticated && req.session) {
        (req.session as any).isAuthenticated = true;
        (req.session as any).expiresAt = tokens.expires_at;
      }

      const response: AuthStatusResponse = {
        authenticated: isAuthenticated,
        expiresAt: tokens.expires_at,
      };

      res.json(response);
    } catch (error) {
      console.error("Auth status error:", error);
      res.json({
        authenticated: false,
        error: "Error checking authentication status",
      });
    }
  });

  // API endpoint to refresh the token - using Redis token storage if available
  app.post("/api/refresh-token", async (req: Request, res: Response) => {
    try {
      // Get current tokens
      let tokens: TokenData | null;

      if (redisAvailable) {
        tokens = await tokenStorage.getTokens();
      } else {
        tokens = getTokensFromFile();
      }

      if (!tokens || !tokens.refresh_token) {
        return res.status(401).json({ error: "No refresh token available" });
      }

      const tokenResponse = await fetch(
        "https://accounts.spotify.com/api/token",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization:
              "Basic " +
              Buffer.from(`${config.clientId}:${config.clientSecret}`).toString(
                "base64"
              ),
          },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: tokens.refresh_token,
          }).toString(),
        }
      );

      if (!tokenResponse.ok) {
        return res.status(tokenResponse.status).json({
          error: "Failed to refresh token",
        });
      }

      const newTokenData = (await tokenResponse.json()) as TokenData;

      // The response doesn't include the refresh token if it's still valid
      if (!newTokenData.refresh_token) {
        newTokenData.refresh_token = tokens.refresh_token;
      }

      newTokenData.expires_at = new Date(
        Date.now() + newTokenData.expires_in * 1000
      ).toISOString();

      // Update session expiration
      if (req.session) {
        (req.session as any).isAuthenticated = true;
        (req.session as any).expiresAt = newTokenData.expires_at;
      }

      // Save tokens to appropriate storage
      if (redisAvailable) {
        await tokenStorage.saveTokens(newTokenData);
      } else {
        // Fallback to file storage
        const tokensFilename = config.isProduction
          ? ".spotify-tokens-prod.json"
          : ".spotify-tokens-dev.json";
        fs.writeFileSync(
          tokensFilename,
          JSON.stringify(newTokenData, null, 2),
          "utf8"
        );
      }

      res.json({ success: true });
    } catch (error) {
      console.error("Error refreshing token:", error);
      res.status(500).json({ error: "Server error" });
    }
  });

  // Logout endpoint
  app.get("/api/logout", async (req: Request, res: Response) => {
    try {
      // Clear session
      if (req.session) {
        req.session.destroy((err) => {
          if (err) {
            console.error("Error destroying session:", err);
          }
        });
      }

      if (redisAvailable) {
        // Remove tokens from Redis store
        await tokenStorage.removeTokens();

        // Clear user's API cache
        await apiCache.clearUserCache();
      } else {
        // Fallback to file removal
        const tokensFilename = config.isProduction
          ? ".spotify-tokens-prod.json"
          : ".spotify-tokens-dev.json";

        if (fs.existsSync(tokensFilename)) {
          fs.unlinkSync(tokensFilename);
        }
      }

      // Send a success response
      res.json({ success: true, message: "Logged out successfully" });
    } catch (error) {
      console.error("Error during logout:", error);
      res.status(500).json({ error: "Server error during logout" });
    }
  });

  // Combined API endpoint to get both user and playlists - Enhanced with Redis
  app.get("/api/user-data", async (req: Request, res: Response) => {
    console.log("User-data endpoint called");

    try {
      if (redisAvailable) {
        // Check rate limits first - this counts as multiple API requests
        const userRateCheck = await rateLimiter.checkLimit("/me");
        const playlistsRateCheck = await rateLimiter.checkLimit(
          "/me/playlists"
        );

        if (!userRateCheck.allowed) {
          return res.status(429).json({
            error: "Rate limit exceeded for user profile",
            resetAt: userRateCheck.resetTime,
            limit: userRateCheck.limit,
          });
        }

        if (!playlistsRateCheck.allowed) {
          return res.status(429).json({
            error: "Rate limit exceeded for playlists",
            resetAt: playlistsRateCheck.resetTime,
            limit: playlistsRateCheck.limit,
          });
        }

        // Try to get from cache first
        const cachedData = await apiCache.get("/api/user-data", {});
        if (cachedData) {
          console.log("Using cached user-data response");
          return res.json(cachedData);
        }

        // Fetch user data using our Spotify client
        try {
          // Fetch both user profile and playlists in parallel
          const [userData, playlistsData] = await Promise.all([
            spotifyClient.getCurrentUser(),
            spotifyClient.getCurrentUserPlaylists(0, 20),
          ]);

          // Combine the data
          const combinedData = {
            user: userData,
            playlists: playlistsData,
          };

          // Cache the combined response
          await apiCache.set("/api/user-data", {}, combinedData);

          // Return combined data
          res.json(combinedData);
          console.log("User-data: Response sent successfully");
        } catch (error: any) {
          if (error.message.includes("No authentication tokens")) {
            console.log("User-data: Not authenticated (no tokens)");
            return res.status(401).json({ error: "Not authenticated" });
          }
          throw error;
        }
      } else {
        // Fallback to original implementation without Redis
        const tokens = getTokensFromFile();

        if (!tokens) {
          console.log("User-data: Not authenticated (no tokens)");
          return res.status(401).json({ error: "Not authenticated" });
        }

        // Check if token is expired
        const now = new Date();
        const expiresAt = new Date(tokens.expires_at);

        if (now > expiresAt) {
          console.log("User-data: Token expired");
          return res.status(401).json({ error: "Token expired" });
        }

        // Fetch user profile
        console.log("User-data: Fetching user profile from Spotify API");
        const userResponse = await fetch("https://api.spotify.com/v1/me", {
          headers: {
            Authorization: `Bearer ${tokens.access_token}`,
          },
        });

        if (!userResponse.ok) {
          const errorText = await userResponse.text();
          console.error(
            `User-data: Failed to fetch user profile: ${userResponse.status} - ${errorText}`
          );
          return res.status(userResponse.status).json({
            error: "Failed to fetch user profile",
            details: errorText,
          });
        }

        const userData: SpotifyUser =
          (await userResponse.json()) as SpotifyUser;
        console.log(`User-data: User profile fetched for ${userData.id}`);

        // Fetch playlists
        console.log("User-data: Fetching playlists from Spotify API");
        const playlistsResponse = await fetch(
          "https://api.spotify.com/v1/me/playlists",
          {
            headers: {
              Authorization: `Bearer ${tokens.access_token}`,
            },
          }
        );

        if (!playlistsResponse.ok) {
          const errorText = await playlistsResponse.text();
          console.error(
            `User-data: Failed to fetch playlists: ${playlistsResponse.status} - ${errorText}`
          );
          return res.status(playlistsResponse.status).json({
            error: "Failed to fetch playlists",
            details: errorText,
          });
        }

        const playlistsData: SpotifyPlaylistsResponse =
          (await playlistsResponse.json()) as SpotifyPlaylistsResponse;
        console.log(
          `User-data: ${playlistsData.items.length} playlists fetched`
        );

        // Return combined data
        res.json({
          user: userData,
          playlists: playlistsData,
        });

        console.log("User-data: Response sent successfully");
      }
    } catch (error: any) {
      console.error("Error fetching user data:", error);
      res.status(500).json({ error: "Server error", details: error.message });
    }
  });

  // Redis-dependent routes - only add if Redis is available
  if (redisAvailable) {
    // New endpoint to get a specific playlist
    app.get("/api/playlists/:id", async (req: Request, res: Response) => {
      try {
        const playlistId = req.params.id;

        // Check rate limits
        const rateCheck = await rateLimiter.checkLimit(
          `/playlists/${playlistId}`
        );
        if (!rateCheck.allowed) {
          return res.status(429).json({
            error: "Rate limit exceeded",
            resetAt: rateCheck.resetTime,
            limit: rateCheck.limit,
          });
        }

        // Fetch playlist with caching
        try {
          const playlist = await spotifyClient.getPlaylist(playlistId);
          res.json(playlist);
        } catch (error: any) {
          if (error.message.includes("No authentication tokens")) {
            return res.status(401).json({ error: "Not authenticated" });
          }
          throw error;
        }
      } catch (error) {
        console.error("Error fetching playlist:", error);
        res.status(500).json({ error: "Server error" });
      }
    });

    // New endpoint to get tracks from a playlist
    app.get(
      "/api/playlists/:id/tracks",
      async (req: Request, res: Response) => {
        try {
          const playlistId = req.params.id;
          const offset = parseInt(req.query.offset as string) || 0;
          const limit = parseInt(req.query.limit as string) || 100;

          // Check rate limits
          const rateCheck = await rateLimiter.checkLimit(
            `/playlists/${playlistId}/tracks`
          );
          if (!rateCheck.allowed) {
            return res.status(429).json({
              error: "Rate limit exceeded",
              resetAt: rateCheck.resetTime,
              limit: rateCheck.limit,
            });
          }

          // Fetch tracks with caching
          try {
            const tracks = await spotifyClient.getPlaylistTracks(
              playlistId,
              offset,
              limit
            );
            res.json(tracks);
          } catch (error: any) {
            if (error.message.includes("No authentication tokens")) {
              return res.status(401).json({ error: "Not authenticated" });
            }
            throw error;
          }
        } catch (error) {
          console.error("Error fetching playlist tracks:", error);
          res.status(500).json({ error: "Server error" });
        }
      }
    );

    // New endpoint to search Spotify
    app.get("/api/search", async (req: Request, res: Response) => {
      try {
        const query = req.query.q as string;
        const type = req.query.type as string;
        const offset = parseInt(req.query.offset as string) || 0;
        const limit = parseInt(req.query.limit as string) || 20;

        if (!query || !type) {
          return res
            .status(400)
            .json({ error: "Missing query or type parameter" });
        }

        // Check rate limits
        const rateCheck = await rateLimiter.checkLimit("/search");
        if (!rateCheck.allowed) {
          return res.status(429).json({
            error: "Rate limit exceeded",
            resetAt: rateCheck.resetTime,
            limit: rateCheck.limit,
          });
        }

        // Perform search with caching
        try {
          const results = await spotifyClient.search(
            query,
            type,
            limit,
            offset
          );
          res.json(results);
        } catch (error: any) {
          if (error.message.includes("No authentication tokens")) {
            return res.status(401).json({ error: "Not authenticated" });
          }
          throw error;
        }
      } catch (error) {
        console.error("Error searching Spotify:", error);
        res.status(500).json({ error: "Server error" });
      }
    });
  }

  // Health check endpoint that doesn't require Redis
  app.get("/health", (req: Request, res: Response) => {
    const healthData = {
      status: "ok",
      timestamp: new Date().toISOString(),
      redis: {
        available: redisAvailable,
        secureState: secureStateManager.getRedisStatus(),
        tokenStorage: tokenStorage.getRedisStatus(),
        apiCache: apiCache.getRedisStatus(),
        rateLimiter: rateLimiter.getRedisStatus(),
      },
      uptime: process.uptime(),
    };

    res.json(healthData);
  });

  // Add these methods to each of your Redis utilities
  // For example, in secureStateManager.ts:

  // Serve index.html for client-side routing
  app.get(["/", "/playlists"], (req: Request, res: Response) => {
    res.sendFile(path.join(__dirname, "..", "public", "index.html"));
  });

  console.log("Setting up routes completed");
  console.log("Starting HTTP server...");

  const server = app.listen(config.port, () => {
    console.log(`Server running at http://localhost:${config.port}`);
    console.log("Server startup complete");
    if (!config.isProduction) open(`http://localhost:${config.port}`);
  });

  // Add timeout handling
  server.setTimeout(30000); // 30 second timeout

  // Add error handler for the server
  server.on("error", (error) => {
    console.error("Server error:", error);
  });

  // Optional: Add connection tracking (useful for debugging connection issues)
  server.on("connection", () => {
    console.log("New connection established");
  });

  // Handle graceful shutdown to close Redis connections
  process.on("SIGINT", async () => {
    console.log("Shutting down gracefully...");

    if (redisAvailable) {
      // Close all Redis connections
      await Promise.all([
        tokenStorage.close && tokenStorage.close(),
        apiCache.close && apiCache.close(),
        rateLimiter.close && rateLimiter.close(),
      ]).catch((err) => console.error("Error closing Redis connections:", err));

      console.log("Redis connections closed.");
    }

    process.exit(0);
  });

  // Return the server instance
  return server;
}

// Execute the function
if (require.main === module) {
  startServer().catch((error) => {
    console.error("An error occurred:", error);
  });
}

export default startServer;
