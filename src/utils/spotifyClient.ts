// File: src/utils/spotifyClient.ts

import fetch from "node-fetch";
import apiCache from "./apiCache";
import rateLimiter from "./rateLimiter";
import tokenStorage from "./tokenStorage";
import {
  SpotifyUser,
  SpotifyPlaylistsResponse,
  TokenData,
} from "../types/types";
import * as dotenv from "dotenv";

dotenv.config();

/**
 * SpotifyClient provides a wrapper around the Spotify Web API
 * with integrated caching, rate limiting, and token management
 */
export class SpotifyClient {
  private baseUrl = "https://api.spotify.com/v1";
  private clientId: string;
  private clientSecret: string;
  private redirectUri: string;

  constructor() {
    this.clientId = process.env.SPOTIFY_CLIENT_ID || "";
    this.clientSecret = process.env.SPOTIFY_CLIENT_SECRET || "";
    this.redirectUri =
      process.env.SPOTIFY_REDIRECT_URLS?.split(",")[0].trim() || "";

    if (!this.clientId || !this.clientSecret || !this.redirectUri) {
      console.error("Spotify credentials not properly configured");
    }
  }

  /**
   * Refresh the access token if expired
   */
  private async ensureValidToken(
    userId: string = "default"
  ): Promise<TokenData> {
    // Get current tokens
    const tokens = await tokenStorage.getTokens(userId);
    if (!tokens) {
      throw new Error("No authentication tokens available");
    }

    // Check if token is expired
    if (tokenStorage.isTokenExpired(tokens)) {
      console.log(`Token expired for user ${userId}, refreshing...`);

      // Refresh the token
      const tokenResponse = await fetch(
        "https://accounts.spotify.com/api/token",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${Buffer.from(
              `${this.clientId}:${this.clientSecret}`
            ).toString("base64")}`,
          },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: tokens.refresh_token,
          }).toString(),
        }
      );

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        console.error(`Failed to refresh token: ${errorText}`);
        throw new Error("Failed to refresh access token");
      }

      const newTokens = (await tokenResponse.json()) as Partial<TokenData>;

      // Combine with existing tokens and update expiration
      const updatedTokens: TokenData = {
        ...tokens,
        ...newTokens,
        refresh_token: newTokens.refresh_token || tokens.refresh_token,
        expires_at: new Date(
          Date.now() + (newTokens.expires_in || 3600) * 1000
        ).toISOString(),
      };

      // Save the updated tokens
      await tokenStorage.saveTokens(updatedTokens, userId);
      return updatedTokens;
    }

    return tokens;
  }

  /**
   * Make an authenticated request to the Spotify API with caching and rate limiting
   */
  private async request<T>(
    endpoint: string,
    method: "GET" | "POST" | "PUT" | "DELETE" = "GET",
    params: Record<string, any> = {},
    body?: any,
    userId: string = "default",
    useCache: boolean = true
  ): Promise<T> {
    // Check rate limits
    const rateCheck = await rateLimiter.checkLimit(endpoint, userId);
    if (!rateCheck.allowed) {
      console.warn(
        `Rate limit exceeded for ${endpoint}. Reset at ${rateCheck.resetTime}`
      );
      throw new Error(
        `Rate limit exceeded. Try again after ${rateCheck.resetTime}`
      );
    }

    // For GET requests, check cache first
    if (method === "GET" && useCache) {
      const cachedData = await apiCache.get<T>(endpoint, params, userId);
      if (cachedData) {
        console.log(`Cache hit for ${endpoint}`);
        return cachedData;
      }
    }

    // Ensure we have a valid token
    const tokens = await this.ensureValidToken(userId);

    // Build URL with query parameters
    let url = `${this.baseUrl}${endpoint}`;
    if (Object.keys(params).length > 0) {
      const queryParams = new URLSearchParams();
      Object.entries(params).forEach(([key, value]) => {
        queryParams.append(key, String(value));
      });
      url += `?${queryParams.toString()}`;
    }

    // Make the request
    try {
      console.log(`Making ${method} request to ${url}`);

      const response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      // Handle non-success responses
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`API error (${response.status}): ${errorText}`);

        // Handle 401 specifically (token might have just expired)
        if (response.status === 401) {
          // Force token refresh and retry once
          await tokenStorage.saveTokens(
            {
              ...tokens,
              expires_at: new Date(0).toISOString(), // Force expiration
            },
            userId
          );

          // Retry the request (once)
          return this.request<T>(endpoint, method, params, body, userId, false);
        }

        throw new Error(`Spotify API error: ${response.status} ${errorText}`);
      }

      // Parse JSON response
      const data = (await response.json()) as T;

      // Cache the response for GET requests
      if (method === "GET" && useCache) {
        await apiCache.set(endpoint, params, data, userId);
      }

      return data;
    } catch (error) {
      console.error(`Request error for ${url}:`, error);
      throw error;
    }
  }

  /**
   * Get the current user's profile
   */
  async getCurrentUser(userId: string = "default"): Promise<SpotifyUser> {
    return this.request<SpotifyUser>("/me", "GET", {}, undefined, userId);
  }

  /**
   * Get the current user's playlists with pagination
   */
  async getCurrentUserPlaylists(
    offset: number = 0,
    limit: number = 20,
    userId: string = "default"
  ): Promise<SpotifyPlaylistsResponse> {
    return this.request<SpotifyPlaylistsResponse>(
      "/me/playlists",
      "GET",
      { offset, limit },
      undefined,
      userId
    );
  }

  /**
   * Get a specific playlist by ID
   */
  async getPlaylist(
    playlistId: string,
    userId: string = "default"
  ): Promise<any> {
    return this.request<any>(
      `/playlists/${playlistId}`,
      "GET",
      {},
      undefined,
      userId
    );
  }

  /**
   * Get tracks from a playlist with pagination
   */
  async getPlaylistTracks(
    playlistId: string,
    offset: number = 0,
    limit: number = 100,
    userId: string = "default"
  ): Promise<any> {
    return this.request<any>(
      `/playlists/${playlistId}/tracks`,
      "GET",
      { offset, limit },
      undefined,
      userId
    );
  }

  /**
   * Search the Spotify catalog
   */
  async search(
    query: string,
    type: string | string[],
    limit: number = 20,
    offset: number = 0,
    userId: string = "default"
  ): Promise<any> {
    const types = Array.isArray(type) ? type.join(",") : type;

    return this.request<any>(
      "/search",
      "GET",
      { q: query, type: types, limit, offset },
      undefined,
      userId
    );
  }

  /**
   * Clear API cache for a user when they log out
   */
  async clearUserCache(userId: string = "default"): Promise<void> {
    await apiCache.clearUserCache(userId);
  }
}

// Create and export default instance
const spotifyClient = new SpotifyClient();
export default spotifyClient;
