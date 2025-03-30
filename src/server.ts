// File: src/server.ts

import * as dotenv from "dotenv";
import express, { NextFunction, Request, Response } from "express";
import session from "express-session";
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
async function startServer(): Promise<void> {
  console.log(
    `--- Spotify Playlist App (${
      config.isProduction ? "PRODUCTION" : "DEVELOPMENT"
    } Mode) ---`
  );

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
  if (process.env.REDIS_URL && RedisStore && Redis) {
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

  // Route for login
  app.get("/login", async (req: Request, res: Response) => {
    // Generate a new state for this login request
    const state = secureStateManager.generateState();
    await secureStateManager.saveState(state);

    // Store state in session as a backup
    req.session.authState = state;

    const url = new URL("https://accounts.spotify.com/authorize");
    url.searchParams.append("response_type", "code");
    url.searchParams.append("client_id", config.clientId);
    url.searchParams.append("scope", config.scopes);
    url.searchParams.append("redirect_uri", config.redirectUri);
    url.searchParams.append("state", state);

    console.log(`Redirecting to Spotify with state: ${state}`);
    res.redirect(url.toString());
  });

  // Callback route - Enhanced with Redis token storage
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
      const sessionState = req.session.authState;
      const isValidSessionState = sessionState === receivedState;

      // Clear session state
      req.session.authState = undefined;

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

      // Store tokens using Redis
      await tokenStorage.saveTokens(tokenData);

      // Store authentication status in session
      req.session.isAuthenticated = true;
      req.session.expiresAt = tokenData.expires_at;

      // Store user ID in session if needed later for multi-user support
      // We'll add a placeholder for now - in a multi-user system you'd
      // fetch the user ID from Spotify here
      req.session.userId = "default";

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
        res.json(playlistsData);
      } catch (error: any) {
        if (error.message.includes("No authentication tokens")) {
          return res.status(401).json({ error: "Not authenticated" });
        }
        throw error;
      }
    } catch (error) {
      console.error("Error fetching playlists:", error);
      res.status(500).json({ error: "Server error" });
    }
  });

  // API endpoint to get current user profile - Enhanced with Redis
  app.get("/api/user", async (req: Request, res: Response) => {
    try {
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
        res.json(userData);
      } catch (error: any) {
        if (error.message.includes("No authentication tokens")) {
          return res.status(401).json({ error: "Not authenticated" });
        }
        throw error;
      }
    } catch (error) {
      console.error("Error fetching user profile:", error);
      res.status(500).json({ error: "Server error" });
    }
  });

  // Check auth status - using Redis token storage
  app.get("/api/auth-status", async (req: Request, res: Response) => {
    try {
      // First check session
      if (req.session.isAuthenticated && req.session.expiresAt) {
        const now = Date.now();
        const expiresAt =
          new Date(req.session.expiresAt).getTime() + 5 * 60 * 1000; // 5 min buffer

        if (now < expiresAt) {
          return res.json({
            authenticated: true,
            expiresAt: req.session.expiresAt,
          });
        }
      }

      // Fallback to token storage
      const tokens = await tokenStorage.getTokens();

      if (!tokens) {
        const response: AuthStatusResponse = { authenticated: false };
        return res.json(response);
      }

      // Check if token is expired
      const isExpired = tokenStorage.isTokenExpired(tokens);

      // Update session if authenticated via token
      if (!isExpired && req.session) {
        req.session.isAuthenticated = true;
        req.session.expiresAt = tokens.expires_at;
      }

      const response: AuthStatusResponse = {
        authenticated: !isExpired,
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

  // API endpoint to refresh the token - using Redis token storage
  app.post("/api/refresh-token", async (req: Request, res: Response) => {
    try {
      // Get current tokens
      const tokens = await tokenStorage.getTokens();

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
        req.session.isAuthenticated = true;
        req.session.expiresAt = newTokenData.expires_at;
      }

      // Save updated tokens using Redis
      await tokenStorage.saveTokens(newTokenData);

      res.json({ success: true });
    } catch (error) {
      console.error("Error refreshing token:", error);
      res.status(500).json({ error: "Server error" });
    }
  });

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

      // Remove tokens from Redis store
      await tokenStorage.removeTokens();

      // Clear user's API cache
      await apiCache.clearUserCache();

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
      // Check rate limits first - this counts as multiple API requests
      const userRateCheck = await rateLimiter.checkLimit("/me");
      const playlistsRateCheck = await rateLimiter.checkLimit("/me/playlists");

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
    } catch (error: any) {
      console.error("Error fetching user data:", error);
      res.status(500).json({ error: "Server error", details: error.message });
    }
  });

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
  app.get("/api/playlists/:id/tracks", async (req: Request, res: Response) => {
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
  });

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
        const results = await spotifyClient.search(query, type, limit, offset);
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

  // Handle graceful shutdown to close Redis connections
  process.on("SIGINT", async () => {
    console.log("Shutting down gracefully...");

    // Close all Redis connections
    await Promise.all([
      tokenStorage.close(),
      apiCache.close(),
      rateLimiter.close(),
    ]).catch((err) => console.error("Error closing Redis connections:", err));

    console.log("Redis connections closed.");
    process.exit(0);
  });
}

// Execute the function
if (require.main === module) {
  startServer().catch((error) => {
    console.error("An error occurred:", error);
  });
}

export default startServer;
