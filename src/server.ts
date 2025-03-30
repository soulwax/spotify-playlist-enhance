// src/server.ts
import { randomBytes } from "crypto";
import * as dotenv from "dotenv";
import express, { Request, Response } from "express";
import * as fs from "fs";
import fetch from "node-fetch";
import open from "open";
import path from "path";
import {
  AuthStatusResponse,
  SpotifyAuthConfig,
  SpotifyImage,
  SpotifyPlaylist,
  SpotifyPlaylistsResponse,
  SpotifyUser,
  TokenData,
} from "./types/types"; // Adjust the import path as necessary

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
function generateRandomString(length: number): string {
  return randomBytes(Math.ceil(length / 2))
    .toString("hex")
    .slice(0, length);
}

function storeState(state: string): void {
  try {
    fs.writeFileSync(".spotify_auth_state", state);
  } catch (error) {
    console.error("Failed to write state to file:", error);
  }
}

function getStoredState(): string | null {
  try {
    if (fs.existsSync(".spotify_auth_state")) {
      return fs.readFileSync(".spotify_auth_state", "utf8");
    }
  } catch (error) {
    console.error("Failed to read state from file:", error);
  }
  return null;
}

function cleanupState(): void {
  try {
    if (fs.existsSync(".spotify_auth_state")) {
      fs.unlinkSync(".spotify_auth_state");
    }
  } catch (error) {
    console.error("Failed to delete state file:", error);
  }
}

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

  const state = generateRandomString(16);
  storeState(state);

  const app = express();

  // Serve static files from the public directory
  app.use(express.static(path.join(__dirname, "..", "public")));

  // Route for login
  app.get("/login", (req: Request, res: Response) => {
    const url = new URL("https://accounts.spotify.com/authorize");
    url.searchParams.append("response_type", "code");
    url.searchParams.append("client_id", config.clientId);
    url.searchParams.append("scope", config.scopes);
    url.searchParams.append("redirect_uri", config.redirectUri);
    url.searchParams.append("state", state);

    res.redirect(url.toString());
  });

  // Callback route
  app.get("/api/spotify/callback", async (req: Request, res: Response) => {
    try {
      const { code, state: receivedState } = req.query;

      if (!code || typeof code !== "string") {
        return res.status(400).send("Authorization code not found.");
      }

      const storedState = getStoredState();
      cleanupState();

      if (receivedState !== storedState) {
        return res.status(400).send("State mismatch error.");
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

  // Serve index.html for client-side routing
  app.get(["/", "/playlists"], (req: Request, res: Response) => {
    res.sendFile(path.join(__dirname, "..", "public", "index.html"));
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
export type {
  AuthStatusResponse,
  SpotifyAuthConfig,
  SpotifyImage,
  SpotifyPlaylist,
  SpotifyPlaylistsResponse,
  SpotifyUser,
  TokenData,
};
