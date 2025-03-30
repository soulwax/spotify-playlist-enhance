// File: src/get-spotify-auth.ts

import { randomBytes } from "crypto";
import * as dotenv from "dotenv";
import express, { Request, Response } from "express";
import * as fs from "fs";
import fetch from "node-fetch"; // Ensure you have installed node-fetch
import open from "open";
import { SpotifyAuthConfig } from "./types/types"; // Adjust the import path as necessary
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

// --- Main Function ---
async function startSpotifyAuthServer(): Promise<void> {
  console.log(
    `--- Spotify Token Server (${
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

  let tokenData: any = null;

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

      tokenData = await tokenResponse.json();
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

      res.send(`
        <h1>Authentication Successful!</h1>
        <p>Your Spotify access token has been obtained successfully.</p>
        <pre>${JSON.stringify(tokenData, null, 2)}</pre>
      `);

      console.log("\n--- Token Data ---");
      console.log(tokenData);
    } catch (error) {
      console.error("Error during callback processing:", error);
      res.status(500).send("Internal server error.");
    }
  });

  // Root route
  app.get("/", (req: Request, res: Response) => res.redirect("/login"));

  // Start server
  app.listen(config.port, () => {
    console.log(`Server running at http://localhost:${config.port}`);
    if (!config.isProduction) open(`http://localhost:${config.port}/login`);
  });

  // Graceful shutdown
  process.on("SIGINT", () => process.exit());
}

// Execute the function
startSpotifyAuthServer().catch((error) => {
  console.error("An error occurred:", error);
});
export default startSpotifyAuthServer;
export {
  cleanupState,
  generateRandomString,
  getStoredState,
  config as spotifyAuthConfig,
  startSpotifyAuthServer,
  storeState,
}; // Export the function for testing or other purposes
export type { SpotifyAuthConfig }; // Export the config type for external use
