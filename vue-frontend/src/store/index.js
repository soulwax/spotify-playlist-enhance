import { createStore } from "vuex";
import SpotifyService from "../services/spotify";

export default createStore({
  state: {
    // Auth
    authenticated: false,
    isAuthChecking: false,
    isAuthChecked: false,

    // User data
    user: null,

    // Playlists
    playlists: [],
    playlistsOffset: 0,
    playlistsLimit: 20,
    totalPlaylists: 0,
    hasMorePlaylists: true,

    // Loading states
    isLoadingPlaylists: false,
    isLoadingMorePlaylists: false,
    isRefreshingToken: false,
  },

  mutations: {
    setAuthStatus(state, status) {
      state.authenticated = status;
      state.isAuthChecked = true;
      state.isAuthChecking = false;
    },

    setAuthChecking(state, status) {
      state.isAuthChecking = status;
    },

    setUser(state, user) {
      state.user = user;
    },

    setPlaylists(state, { items, total }) {
      state.playlists = items;
      state.totalPlaylists = total;
      state.playlistsOffset = items.length;
      state.hasMorePlaylists = items.length < total;
    },

    addPlaylists(state, { items }) {
      state.playlists = [...state.playlists, ...items];
      state.playlistsOffset = state.playlists.length;
      state.hasMorePlaylists = state.playlists.length < state.totalPlaylists;
    },

    setLoadingPlaylists(state, isLoading) {
      state.isLoadingPlaylists = isLoading;
    },

    setLoadingMorePlaylists(state, isLoading) {
      state.isLoadingMorePlaylists = isLoading;
    },

    setRefreshingToken(state, isRefreshing) {
      state.isRefreshingToken = isRefreshing;
    },

    resetState(state) {
      state.user = null;
      state.playlists = [];
      state.playlistsOffset = 0;
      state.totalPlaylists = 0;
      state.hasMorePlaylists = true;
    },
  },

  actions: {
    async checkAuthStatus({ commit }) {
      commit("setAuthChecking", true);

      try {
        const response = await SpotifyService.checkAuthStatus();
        commit("setAuthStatus", response.authenticated);
        return response.authenticated;
      } catch (error) {
        console.error("Auth status check error:", error);
        commit("setAuthStatus", false);
        return false;
      }
    },

    async loadUserData({ commit, dispatch }) {
      commit("setLoadingPlaylists", true);

      try {
        // Load user profile
        const userData = await SpotifyService.getUserProfile();
        commit("setUser", userData);

        // Load initial playlists
        const playlistsData = await SpotifyService.getPlaylists(0, 20);
        commit("setPlaylists", {
          items: playlistsData.items || [],
          total: playlistsData.total || 0,
        });

        return true;
      } catch (error) {
        console.error("Error loading user data:", error);

        // If unauthorized, update auth status
        if (
          error.message.includes("401") ||
          error.message.includes("unauthorized") ||
          error.message.includes("Authentication failed")
        ) {
          commit("setAuthStatus", false);
        }

        return false;
      } finally {
        commit("setLoadingPlaylists", false);
      }
    },

    async loadMorePlaylists({ state, commit }) {
      if (state.isLoadingMorePlaylists || !state.hasMorePlaylists) {
        return false;
      }

      commit("setLoadingMorePlaylists", true);

      try {
        // Load next batch of playlists
        const playlistsData = await SpotifyService.getPlaylists(
          state.playlistsOffset,
          state.playlistsLimit
        );

        if (playlistsData && playlistsData.items) {
          commit("addPlaylists", {
            items: playlistsData.items,
          });

          return true;
        }

        return false;
      } catch (error) {
        console.error("Error loading more playlists:", error);
        return false;
      } finally {
        commit("setLoadingMorePlaylists", false);
      }
    },

    async refreshToken({ commit }) {
      commit("setRefreshingToken", true);

      try {
        const result = await SpotifyService.refreshToken();
        return result.success;
      } catch (error) {
        console.error("Token refresh error:", error);
        return false;
      } finally {
        commit("setRefreshingToken", false);
      }
    },

    async logout({ commit }) {
      try {
        await SpotifyService.logout();
      } catch (error) {
        console.error("Logout error:", error);
      } finally {
        commit("setAuthStatus", false);
        commit("resetState");
      }
    },
  },
});
