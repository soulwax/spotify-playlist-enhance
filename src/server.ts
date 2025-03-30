// src/server.ts
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
      const data = fs.readFileSync(tokensFilename, "utf8");
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

  // Add request logging middleware
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
      ).toLocaleString();

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

    // Check if token is expired
    const now = new Date();
    const expiresAt = new Date(tokens.expires_at);

    const response: AuthStatusResponse = {
      authenticated: now < expiresAt,
      expiresAt: tokens.expires_at,
    };

    res.json(response);
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

  app.get("/api/user-data", async (req: Request, res: Response) => {
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

      // Fetch user profile
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

      // Fetch playlists
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

      // Return combined data
      res.json({
        user: userData,
        playlists: playlistsData,
      });
    } catch (error) {
      console.error("Error fetching user data:", error);
      res.status(500).json({ error: "Server error" });
    }
  });

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
