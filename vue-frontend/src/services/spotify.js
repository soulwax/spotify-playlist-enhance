// File: src/services/spotify.js

import axios from "axios";

// Create axios instance
const apiClient = axios.create({
  baseURL: "/",
  withCredentials: true,
  headers: {
    Accept: "application/json",
    "Content-Type": "application/json",
  },
});

// Add response interceptor to handle token refresh
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // If error is 401 and we haven't already tried to refresh the token
    if (error.response.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        // Try to refresh the token
        const refreshResponse = await SpotifyService.refreshToken();

        if (refreshResponse.success) {
          // If token refresh was successful, retry the original request
          return apiClient(originalRequest);
        }
      } catch (refreshError) {
        console.error("Token refresh failed in interceptor:", refreshError);
      }
    }

    return Promise.reject(error);
  }
);

// Spotify service with API methods
const SpotifyService = {
  /**
   * Check if the user is currently authenticated
   * @returns {Promise<Object>} Authentication status
   */
  async checkAuthStatus() {
    try {
      const response = await apiClient.get("/api/auth-status");
      return response.data;
    } catch (error) {
      console.error("Auth status check error:", error);
      return { authenticated: false };
    }
  },

  /**
   * Refresh the access token
   * @returns {Promise<Object>} Success status
   */
  async refreshToken() {
    try {
      const response = await apiClient.post("/api/refresh-token");
      return response.data;
    } catch (error) {
      console.error("Token refresh error:", error);
      return { success: false };
    }
  },

  /**
   * Get the current user's profile
   * @returns {Promise<Object>} User profile data
   */
  async getUserProfile() {
    const response = await apiClient.get("/api/user");
    return response.data;
  },

  /**
   * Get the user's playlists
   * @param {number} offset - Starting position for fetching playlists
   * @param {number} limit - Number of playlists to fetch
   * @returns {Promise<Object>} Playlists data
   */
  async getPlaylists(offset = 0, limit = 20) {
    const response = await apiClient.get(
      `/api/playlists?offset=${offset}&limit=${limit}`
    );
    return response.data;
  },

  /**
   * Log the user out
   * @returns {Promise<void>}
   */
  async logout() {
    return await apiClient.get("/api/logout");
  },
};

export default SpotifyService;
