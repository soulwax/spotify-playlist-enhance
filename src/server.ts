// File: src/server.ts

import * as dotenv from "dotenv";
import express, { NextFunction, Request, Response } from "express";
import * as fs from "fs";
import fetch from "node-fetch";
import open from "open";
import path from "path";
import {
  AuthStatusResponse,
  SpotifyAuthConfig,
  SpotifyPlaylistsResponse,
  SpotifyUser,
  TokenData,
} from "./types/types";
import stateManager from "./utils/stateUtils";

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

  // Serve static files from the public directory
  app.use(express.static(path.join(__dirname, "..", "public")));

  // Route for login
  app.get("/login", (req: Request, res: Response) => {
    // Generate a new state for this login request
    const state = stateManager.generateState();
    stateManager.saveState(state);

    const url = new URL("https://accounts.spotify.com/authorize");
    url.searchParams.append("response_type", "code");
    url.searchParams.append("client_id", config.clientId);
    url.searchParams.append("scope", config.scopes);
    url.searchParams.append("redirect_uri", config.redirectUri);
    url.searchParams.append("state", state);

    console.log(`Redirecting to Spotify with state: ${state}`);
    res.redirect(url.toString());
  });

  // Debug route to check state
  app.get("/debug-state", (req: Request, res: Response) => {
    const allStates = stateManager.getAllStates();
    const stateFileExists = fs.existsSync(".spotify_auth_state");
    let fileState = null;

    if (stateFileExists) {
      try {
        fileState = fs.readFileSync(".spotify_auth_state", "utf8");
      } catch (e) {
        fileState = "Error reading file";
      }
    }

    res.json({
      memoryStates: allStates,
      stateFileExists,
      fileState,
    });
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

      // Verify the state to prevent CSRF attacks
      const isValidState = stateManager.verifyState(receivedState);

      if (!isValidState) {
        console.error(`State mismatch. Received: ${receivedState}`);
        return res.status(400).send(`
          <h1>State Mismatch Error</h1>
          <p>We couldn't verify that the authentication request originated from this application.</p>
          <p>This could be due to:</p>
          <ul>
            <li>Session timeout</li>
            <li>Multiple login attempts</li>
            <li>Server restart</li>
          </ul>
          <p><a href="/">Try logging in again</a></p>
          <p><small>For debugging, visit <a href="/debug-state">/debug-state</a></small></p>
        `);
      }

      // State is valid, clean it up
      stateManager.cleanupState(receivedState);

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

      // Save tokens to a file
      const tokensFilename = config.isProduction
        ? ".spotify-tokens-prod.json"
        : ".spotify-tokens-dev.json";
      fs.writeFileSync(
        tokensFilename,
        JSON.stringify(tokenData, null, 2),
        "utf8"
      );

      console.log(`Token obtained successfully, redirecting to playlists page`);

      // Redirect to the playlists page
      res.redirect("/playlists");
    } catch (error) {
      console.error("Error during callback processing:", error);
      res.status(500).send("Internal server error.");
    }
  });

  // API endpoint to get user playlists
  app.get("/api/playlists", async (req: Request, res: Response) => {
    try {
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

      const playlistsResponse = await fetch(
        "https://api.spotify.com/v1/me/playlists",
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
      res.json(playlistsData);
    } catch (error) {
      console.error("Error fetching playlists:", error);
      res.status(500).json({ error: "Server error" });
    }
  });

  // API endpoint to get current user profile
  app.get("/api/user", async (req: Request, res: Response) => {
    try {
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

      const userData: SpotifyUser = (await userResponse.json()) as SpotifyUser;
      res.json(userData);
    } catch (error) {
      console.error("Error fetching user profile:", error);
      res.status(500).json({ error: "Server error" });
    }
  });

  // Check auth status
  app.get("/api/auth-status", (req: Request, res: Response) => {
    const tokens = getTokensFromFile();

    if (!tokens) {
      const response: AuthStatusResponse = { authenticated: false };
      return res.json(response);
    }

    try {
      // Check if token is expired by converting date string to timestamp
      const now = Date.now();
      // Add 5 minutes buffer to account for any clock differences
      const expiresAt = new Date(tokens.expires_at).getTime() + 5 * 60 * 1000;

      const isAuthenticated = now < expiresAt;
      console.log(
        `Auth check: now=${now}, expires=${expiresAt}, authenticated=${isAuthenticated}`
      );

      const response: AuthStatusResponse = {
        authenticated: isAuthenticated,
        expiresAt: tokens.expires_at,
      };

      res.json(response);
    } catch (error) {
      console.error("Date parsing error:", error);
      res.json({ authenticated: false, error: "Date parsing error" });
    }
  });

  // API endpoint to refresh the token
  app.post("/api/refresh-token", async (req: Request, res: Response) => {
    try {
      const tokens = getTokensFromFile();

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
      ).toLocaleString();

      // Save updated tokens
      const tokensFilename = config.isProduction
        ? ".spotify-tokens-prod.json"
        : ".spotify-tokens-dev.json";
      fs.writeFileSync(
        tokensFilename,
        JSON.stringify(newTokenData, null, 2),
        "utf8"
      );

      res.json({ success: true });
    } catch (error) {
      console.error("Error refreshing token:", error);
      res.status(500).json({ error: "Server error" });
    }
  });

  // Serve index.html for client-side routing
  app.get(["/", "/playlists"], (req: Request, res: Response) => {
    res.sendFile(path.join(__dirname, "..", "public", "index.html"));
  });

  // Replace the /api/user-data endpoint with this improved version:

  // Combined API endpoint to get both user and playlists
  app.get("/api/user-data", async (req: Request, res: Response) => {
    console.log("User-data endpoint called");

    try {
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

      const userData: SpotifyUser = (await userResponse.json()) as SpotifyUser;
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
      console.log(`User-data: ${playlistsData.items.length} playlists fetched`);

      // Return combined data
      res.json({
        user: userData,
        playlists: playlistsData,
      });

      console.log("User-data: Response sent successfully");
    } catch (error: any) {
      console.error("Error fetching user data:", error);
      res.status(500).json({ error: "Server error", details: error.message });
    }
  });

  // Token debug endpoint - ONLY FOR DEVELOPMENT
  if (!config.isProduction) {
    app.get("/debug-token", (req: Request, res: Response) => {
      try {
        const tokensFilename = ".spotify-tokens-dev.json";

        // Check if file exists
        if (!fs.existsSync(tokensFilename)) {
          return res.json({
            exists: false,
            message: "Token file does not exist",
          });
        }

        // Read the file
        const data = fs.readFileSync(tokensFilename, "utf8");

        // Check if file is empty
        if (!data || data.trim() === "") {
          return res.json({
            exists: true,
            empty: true,
            message: "Token file exists but is empty",
          });
        }

        try {
          // Try to parse the JSON
          const parsedData = JSON.parse(data);

          // Check if it has the required fields
          const hasRequiredFields =
            typeof parsedData.access_token === "string" &&
            typeof parsedData.token_type === "string" &&
            typeof parsedData.expires_in === "number" &&
            typeof parsedData.refresh_token === "string" &&
            typeof parsedData.expires_at === "string";

          // Check token expiration
          const now = new Date();
          const expiresAt = new Date(parsedData.expires_at);
          const secondsRemaining = Math.floor(
            (expiresAt.getTime() - now.getTime()) / 1000
          );
          const isExpired = now > expiresAt;

          // Return token debug info (don't expose the actual token)
          return res.json({
            exists: true,
            empty: false,
            valid: hasRequiredFields,
            isExpired,
            secondsRemaining,
            expiresAt: parsedData.expires_at,
            tokenStart: parsedData.access_token
              ? parsedData.access_token.substring(0, 5) + "..."
              : null,
            tokenLength: parsedData.access_token
              ? parsedData.access_token.length
              : 0,
            refreshTokenExists: !!parsedData.refresh_token,
            scopes: parsedData.scope,
            message: hasRequiredFields
              ? isExpired
                ? "Token exists but has expired"
                : "Token is valid"
              : "Token exists but is missing required fields",
          });
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          return res.json({
            exists: true,
            empty: false,
            valid: false,
            jsonError: errorMessage,
            message: "Token file contains invalid JSON",
          });
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        return res.status(500).json({
          error: errorMessage,
          message: "Server error while checking token",
        });
      }
    });

    // Logout endpoint
    app.get("/api/logout", (req: Request, res: Response) => {
      try {
        const tokensFilename = config.isProduction
          ? ".spotify-tokens-prod.json"
          : ".spotify-tokens-dev.json";

        // Check if the token file exists
        if (fs.existsSync(tokensFilename)) {
          // Delete the token file
          fs.unlinkSync(tokensFilename);
          console.log(`Token file ${tokensFilename} deleted successfully`);
        }

        // Send a success response
        res.json({ success: true, message: "Logged out successfully" });
      } catch (error) {
        console.error("Error during logout:", error);
        res.status(500).json({ error: "Server error during logout" });
      }
    });

    // Enhance the playlists endpoint to support pagination
    app.get("/api/playlists", async (req: Request, res: Response) => {
      try {
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

        // Add the offset and limit to the API request
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
        res.json(playlistsData);
      } catch (error) {
        console.error("Error fetching playlists:", error);
        res.status(500).json({ error: "Server error" });
      }
    });
  }

  // Start server
  app.listen(config.port, () => {
    console.log(`Server running at http://localhost:${config.port}`);
    if (!config.isProduction) open(`http://localhost:${config.port}`);
  });

  // Graceful shutdown
  process.on("SIGINT", () => process.exit());
}

// Execute the function
if (require.main === module) {
  startServer().catch((error) => {
    console.error("An error occurred:", error);
  });
}

export default startServer;
