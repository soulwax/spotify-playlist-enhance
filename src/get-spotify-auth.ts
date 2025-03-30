// File: src/get-spotify-auth.ts
import * as dotenv from "dotenv";
import * as fs from "fs";
import express from "express";
import open from "open";
import { randomBytes } from "crypto";

// Initialize environment variables
dotenv.config();

// --- Configuration Types ---
interface SpotifyAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string;
  port: number;
}

// --- Configuration ---
const config: SpotifyAuthConfig = {
  // Get Client ID from environment variables
  clientId: process.env.SPOTIFY_CLIENT_ID ?? "",

  // Get Client Secret from environment variables
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET ?? "",

  // Use the localhost redirect URI instead of the production one
  // This is the key change - using the first URL in the list (localhost) instead of the second (production)
  redirectUri:
    (process.env.SPOTIFY_REDIRECT_URLS || "").split(",")[0]?.trim() ?? "",

  // Define the scopes (permissions) needed
  scopes:
    "user-read-private user-read-email playlist-read-private user-modify-playback-state",

  // Server port
  port: parseInt(process.env.PORT ?? "3030", 10),
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
  console.log("--- Spotify Token Server (Authorization Code Flow) ---");

  // Validation checks
  if (!config.clientId) {
    console.error("ERROR: Please set SPOTIFY_CLIENT_ID in your .env file.");
    process.exit(1);
  }

  if (!config.clientSecret) {
    console.error("ERROR: Please set SPOTIFY_CLIENT_SECRET in your .env file.");
    process.exit(1);
  }

  if (!config.redirectUri) {
    console.error("ERROR: Please set SPOTIFY_REDIRECT_URLS in your .env file.");
    process.exit(1);
  }

  console.log(`Using redirect URI: ${config.redirectUri}`);

  // Generate and store a random state string for security
  const state = generateRandomString(16);
  storeState(state);

  // Create Express app
  const app = express();

  // Create a server instance to store token data
  let tokenData: any = null;
  let serverStarted = false;

  // Create html success page
  const successHtml = `
  <!DOCTYPE html>
  <html>
  <head>
    <title>Spotify Authentication Successful</title>
    <style>
      body {
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        background-color: #121212;
        color: white;
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100vh;
        margin: 0;
      }
      .container {
        text-align: center;
        background-color: #282828;
        padding: 2rem;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
        max-width: 500px;
      }
      h1 {
        color: #1DB954;
        margin-bottom: 1rem;
      }
      p {
        margin-bottom: 1.5rem;
        line-height: 1.6;
      }
      pre {
        background-color: #181818;
        padding: 1rem;
        border-radius: 4px;
        text-align: left;
        overflow: auto;
        white-space: pre-wrap;
        word-break: break-all;
        font-family: monospace;
      }
      .success-icon {
        font-size: 4rem;
        color: #1DB954;
        margin-bottom: 1rem;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="success-icon">✓</div>
      <h1>Authentication Successful!</h1>
      <p>Your Spotify access token has been obtained successfully. You can now close this window and return to the terminal.</p>
      <p>Token details:</p>
      <pre id="token-details">Processing...</pre>
    </div>
    <script>
      // The token details will be injected by the server
      document.getElementById('token-details').textContent = JSON.stringify(TOKEN_DATA_PLACEHOLDER, null, 2);
    </script>
  </body>
  </html>
  `;

  // Route for the initial authorization
  app.get("/login", (req, res) => {
    // Construct the Spotify Authorization URL
    let url = "https://accounts.spotify.com/authorize";
    url += "?response_type=code";
    url += "&client_id=" + encodeURIComponent(config.clientId);
    url += "&scope=" + encodeURIComponent(config.scopes);
    url += "&redirect_uri=" + encodeURIComponent(config.redirectUri);
    url += "&state=" + encodeURIComponent(state);

    // Redirect the user to Spotify's authorization page
    res.redirect(url);
  });

  // Callback route that Spotify will redirect to after authorization
  app.get("/api/spotify/callback", async (req, res) => {
    console.log("Callback received with query params:", req.query);

    const code = req.query.code as string;
    const receivedState = req.query.state as string;
    const storedState = getStoredState();

    // Clean up state file
    cleanupState();

    // Verify state to prevent CSRF attacks
    if (receivedState !== storedState) {
      console.error("State mismatch!", { receivedState, storedState });
      return res.status(400).send("State mismatch error! Please try again.");
    }

    if (!code) {
      return res
        .status(400)
        .send("Authorization code not found in the response.");
    }

    try {
      console.log("Exchanging code for token...");

      // Exchange authorization code for access token
      const tokenResponse = await fetch(
        "https://accounts.spotify.com/api/token",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization:
              "Basic " +
              Buffer.from(config.clientId + ":" + config.clientSecret).toString(
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
        try {
          const errorData = JSON.parse(errorText);
          console.error("Parsed error:", errorData);
        } catch (e) {
          // Not JSON, just log the text
        }
        return res
          .status(tokenResponse.status)
          .send("Failed to exchange authorization code for token.");
      }

      // Parse token response
      tokenData = await tokenResponse.json();
      console.log("Token received successfully!");

      // Add expiry date for better UX
      tokenData.expires_at = new Date(
        Date.now() + tokenData.expires_in * 1000
      ).toLocaleString();

      // Send success page with token details
      let responseHtml = successHtml.replace(
        "TOKEN_DATA_PLACEHOLDER",
        JSON.stringify(
          {
            access_token: tokenData.access_token,
            token_type: tokenData.token_type,
            expires_in: tokenData.expires_in,
            refresh_token: tokenData.refresh_token,
            expires_at: tokenData.expires_at,
          },
          null,
          2
        )
      );

      res.send(responseHtml);

      // Log token data to console
      console.log("\n--- SUCCESS! ---");
      console.log("Access Token:", tokenData.access_token);
      console.log("Token Type:", tokenData.token_type);
      console.log("Expires In:", tokenData.expires_in, "seconds");
      console.log("Expires At:", tokenData.expires_at);
      console.log("Refresh Token:", tokenData.refresh_token);
      console.log(
        "\nIMPORTANT: Store these tokens securely. Do NOT commit them to version control."
      );

      // Save tokens to a file for easy access
      fs.writeFileSync(
        "spotify-tokens.json",
        JSON.stringify(tokenData, null, 2),
        "utf8"
      );
      console.log("\nTokens have been saved to spotify-tokens.json");
    } catch (error) {
      console.error("Error exchanging code for token:", error);
      res
        .status(500)
        .send("Internal server error occurred while exchanging token.");
    }
  });

  // Handle root route
  app.get("/", (req, res) => {
    res.redirect("/login");
  });

  // Start server
  const server = app.listen(config.port, () => {
    serverStarted = true;
    console.log(`\nServer is running on http://localhost:${config.port}`);
    console.log("Opening browser to start authentication flow...");

    // Open browser to start the flow
    open(`http://localhost:${config.port}/login`);

    console.log("\nWaiting for authentication to complete...");
  });

  // Handle server errors
  server.on("error", (error: any) => {
    if (error.code === "EADDRINUSE") {
      console.error(
        `Port ${config.port} is already in use. Please try a different port.`
      );
    } else {
      console.error("Server error:", error);
    }
    process.exit(1);
  });

  // Shutdown server after token is received or timeout
  const timeout = setTimeout(() => {
    if (serverStarted && !tokenData) {
      console.log("\nAuthentication timed out after 5 minutes.");
      server.close();
      process.exit(0);
    }
  }, 5 * 60 * 1000); // 5 minutes timeout

  // Handle process termination
  process.on("SIGINT", () => {
    clearTimeout(timeout);
    server.close();
    console.log("\nServer stopped by user.");
    process.exit(0);
  });
}

// Execute the function
startSpotifyAuthServer().catch((error) => {
  console.error("An error occurred:", error);
  process.exit(1);
});
