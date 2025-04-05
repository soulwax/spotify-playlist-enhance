// File (old): public/js/app.js

// DOM Elements
const loginPage = document.getElementById("loginPage");
const playlistsPage = document.getElementById("playlistsPage");
const playlistsContainer = document.getElementById("playlistsContainer");
const loadingIndicator = document.getElementById("loadingIndicator");
const userProfile = document.getElementById("userProfile");
const userAvatar = document.getElementById("userAvatar");
const userName = document.getElementById("userName");
const playlistCount = document.getElementById("playlistCount");

// Debug helper
function debug(message) {
  console.log(`[DEBUG] ${message}`);
}

// App state
let currentUser = null;
let currentPlaylists = [];
let isRefreshingToken = false;
let isLoadingData = false;
let isLoadingMorePlaylists = false;
let hasMorePlaylists = true;
let playlistsOffset = 0;
let playlistsLimit = 20;
let totalPlaylists = 0;

// Initialize the app
async function initApp() {
  debug("App initializing");

  try {
    window.addEventListener("unhandledrejection", function (event) {
      debug(`UNHANDLED PROMISE ERROR: ${event.reason}`);
      console.error("Unhandled promise rejection:", event.reason);
    });

    // Handle browser navigation
    window.addEventListener("popstate", handleLocationChange);

    // Setup infinite scroll
    window.addEventListener("scroll", handleScroll);

    // Initial routing
    debug("Running initial routing");
    await handleLocationChange();

    debug("App initialization complete");
  } catch (error) {
    debug(`ERROR DURING INITIALIZATION: ${error.message}`);
    console.error("Initialization error:", error);
    // Fall back to login page if anything goes wrong during initialization
    showPage(loginPage);
  }
}

// Infinite scroll handler
function handleScroll() {
  if (
    !hasMorePlaylists ||
    isLoadingMorePlaylists ||
    !playlistsPage ||
    playlistsPage.classList.contains("hidden")
  ) {
    return;
  }

  const scrollPosition = window.innerHeight + window.scrollY;
  const bodyHeight = document.body.offsetHeight;
  const scrollThreshold = bodyHeight - 300; // 300px before bottom

  if (scrollPosition >= scrollThreshold) {
    loadMorePlaylists();
  }
}

// Load more playlists
async function loadMorePlaylists() {
  if (isLoadingMorePlaylists || !hasMorePlaylists) {
    return;
  }

  isLoadingMorePlaylists = true;
  debug(`Loading more playlists from offset ${playlistsOffset}`);

  try {
    // Show loading indicator
    const loadingMore = document.getElementById("loadingMore");
    if (loadingMore) {
      loadingMore.classList.remove("hidden");
    }

    // Load next batch of playlists
    const response = await makeAuthenticatedRequest(
      `/api/playlists?offset=${playlistsOffset}&limit=${playlistsLimit}`
    );
    const data = await response.json();

    if (data && data.items) {
      // Append new playlists to the container
      renderAdditionalPlaylists(data.items);

      // Update state
      currentPlaylists = [...currentPlaylists, ...data.items];
      playlistsOffset += data.items.length;
      totalPlaylists = data.total;

      // Update playlist count display
      if (playlistCount) {
        playlistCount.textContent = `${
          currentPlaylists.length
        } of ${totalPlaylists} ${
          totalPlaylists === 1 ? "playlist" : "playlists"
        }`;
      }

      // Check if there are more playlists to load
      hasMorePlaylists = currentPlaylists.length < totalPlaylists;

      debug(
        `Loaded ${data.items.length} more playlists. Total loaded: ${currentPlaylists.length}/${totalPlaylists}`
      );
    } else {
      hasMorePlaylists = false;
      debug("No more playlists to load");
    }
  } catch (error) {
    debug(`Error loading more playlists: ${error.message}`);
    console.error("Error loading more playlists:", error);
  } finally {
    isLoadingMorePlaylists = false;

    // Hide loading indicator
    const loadingMore = document.getElementById("loadingMore");
    if (loadingMore) {
      loadingMore.classList.add("hidden");
    }

    // If no more playlists, show end message
    if (!hasMorePlaylists) {
      const endMessage = document.createElement("div");
      endMessage.className = "end-message";
      endMessage.textContent = "You've reached the end of your playlists";
      playlistsContainer.appendChild(endMessage);
      debug("End of playlists message displayed");
    }
  }
}

// Logout function
async function logout() {
  debug("Logging out");

  try {
    // Call logout endpoint
    await fetch("/api/logout");

    // Clear app state
    currentUser = null;
    currentPlaylists = [];
    hasMorePlaylists = true;
    playlistsOffset = 0;
    totalPlaylists = 0;

    // Redirect to login page
    window.history.pushState({}, "", "/");
    showPage(loginPage);

    debug("Logout successful");
  } catch (error) {
    debug(`Logout error: ${error.message}`);
    console.error("Logout error:", error);

    // Redirect to login page anyway
    window.history.pushState({}, "", "/");
    showPage(loginPage);
  }
}

// Show a specific page and hide others
function showPage(pageElement) {
  if (!pageElement) {
    debug("ERROR: Tried to show a page that doesn't exist");
    return;
  }

  debug(`Showing page: ${pageElement.id}`);

  // Hide all pages
  loginPage.classList.add("hidden");
  playlistsPage.classList.add("hidden");

  // Show the specified page
  pageElement.classList.remove("hidden");
}

// Check if the user is authenticated
async function checkAuthStatus() {
  debug("Checking auth status");
  try {
    const response = await fetch("/api/auth-status");

    if (!response.ok) {
      debug(`Auth status check failed with status ${response.status}`);
      return { authenticated: false };
    }

    const data = await response.json();
    debug(`Auth status: ${JSON.stringify(data)}`);
    return data;
  } catch (error) {
    debug(`Auth status check error: ${error.message}`);
    return { authenticated: false };
  }
}

// Refresh the access token
async function refreshToken() {
  if (isRefreshingToken) {
    debug("Token refresh already in progress, skipping");
    return false;
  }

  debug("Refreshing token");
  isRefreshingToken = true;

  try {
    const response = await fetch("/api/refresh-token", {
      method: "POST",
    });

    if (!response.ok) {
      debug(`Token refresh failed: ${response.status}`);
      return false;
    }

    const result = await response.json();
    debug("Token refreshed successfully");
    return result.success;
  } catch (error) {
    debug(`Token refresh error: ${error.message}`);
    return false;
  } finally {
    isRefreshingToken = false;
  }
}

// Make an authenticated request with automatic token refresh
async function makeAuthenticatedRequest(url, options = {}) {
  debug(`Making authenticated request to ${url}`);

  try {
    // First attempt
    let response = await fetch(url, options);

    // If unauthorized, try refreshing token and retry
    if (response.status === 401) {
      debug("Token expired, attempting to refresh...");
      const refreshed = await refreshToken();

      if (refreshed) {
        debug("Token refreshed, retrying request");
        // Retry request with new token
        response = await fetch(url, options);
      } else {
        debug("Token refresh failed, redirecting to login");
        // If refresh failed, redirect to login
        showPage(loginPage);
        window.history.pushState({}, "", "/");
        throw new Error("Authentication failed");
      }
    }

    if (!response.ok) {
      debug(`Request failed: ${response.status}`);
      throw new Error(`Request failed with status: ${response.status}`);
    }

    debug("Request successful");
    return response;
  } catch (error) {
    debug(`Error in makeAuthenticatedRequest: ${error.message}`);
    throw error; // Re-throw to let caller handle it
  }
}

// Load initial user data (profile and playlists)
async function loadUserData() {
  if (isLoadingData) {
    debug("Already loading data, skipping");
    return;
  }

  debug("Loading user data");
  isLoadingData = true;

  try {
    // Reset playlist state
    playlistsOffset = 0;
    currentPlaylists = [];
    hasMorePlaylists = true;

    // Show loading indicator
    if (loadingIndicator) {
      loadingIndicator.classList.remove("hidden");
    }

    // Hide playlists container during loading
    if (playlistsContainer) {
      playlistsContainer.classList.add("hidden");
    }

    // Get user profile
    const userResponse = await makeAuthenticatedRequest("/api/user");
    const userData = await userResponse.json();

    // Update user profile UI
    currentUser = userData;
    debug(`User profile loaded: ${currentUser.display_name || currentUser.id}`);

    if (userAvatar && userName && userProfile) {
      if (currentUser.images && currentUser.images.length > 0) {
        userAvatar.src = currentUser.images[0].url;
      } else {
        // Fallback image if user has no profile picture
        userAvatar.src =
          "https://i.scdn.co/image/ab6761610000e5ebf5c9cb7c03d1e4e5226fc232";
      }

      userName.textContent = currentUser.display_name || currentUser.id;
      userProfile.classList.remove("hidden");
      debug("User profile UI updated");
    } else {
      debug("ERROR: User profile UI elements missing");
    }

    // Get initial playlists
    const playlistsResponse = await makeAuthenticatedRequest(
      `/api/playlists?offset=0&limit=${playlistsLimit}`
    );
    const playlistsData = await playlistsResponse.json();

    // Update playlists
    currentPlaylists = playlistsData.items || [];
    totalPlaylists = playlistsData.total || 0;
    playlistsOffset = currentPlaylists.length;
    hasMorePlaylists = currentPlaylists.length < totalPlaylists;

    debug(
      `Loaded ${currentPlaylists.length} playlists. Total: ${totalPlaylists}`
    );

    // Update playlist count and render playlists
    if (playlistCount && playlistsContainer) {
      playlistCount.textContent = `${
        currentPlaylists.length
      } of ${totalPlaylists} ${
        totalPlaylists === 1 ? "playlist" : "playlists"
      }`;

      // Render playlists
      renderPlaylists(currentPlaylists);
      debug("Playlists rendered");

      // Show the playlist container and hide loading indicator
      if (playlistsContainer && loadingIndicator) {
        loadingIndicator.classList.add("hidden");
        playlistsContainer.classList.remove("hidden");
      }
    } else {
      debug("ERROR: Playlist UI elements missing");
    }

    if (hasMorePlaylists && !document.getElementById("loadingMore")) {
      const loadingMore = document.createElement("div");
      loadingMore.id = "loadingMore";
      loadingMore.className = "loading-more hidden";
      loadingMore.innerHTML = `
        <div class="loading-spinner"></div>
        <p>Loading more playlists...</p>
      `;
      document.getElementById("playlistsPage").appendChild(loadingMore);
    }

    debug("All user data loaded and rendered successfully");
  } catch (error) {
    debug(`Error loading user data: ${error.message}`);
    console.error("Error loading user data:", error);

    // If unauthorized, show login page
    if (
      error.message.includes("401") ||
      error.message.includes("unauthorized") ||
      error.message.includes("Authentication failed")
    ) {
      debug("Authentication error, redirecting to login");
      showPage(loginPage);
      window.history.pushState({}, "", "/");
    }
  } finally {
    // Always hide loading indicator
    if (loadingIndicator) {
      loadingIndicator.classList.add("hidden");
    }

    isLoadingData = false;
  }
}

// Render initial playlists in the UI
function renderPlaylists(playlists) {
  if (!playlistsContainer) {
    debug("ERROR: Playlist container not found");
    return;
  }

  debug(`Rendering ${playlists.length} playlists`);

  // Clear previous playlists
  playlistsContainer.innerHTML = "";

  if (playlists.length === 0) {
    debug("No playlists to display");
    playlistsContainer.innerHTML = `
      <div class="no-playlists">
        <p>You don't have any playlists yet.</p>
      </div>
    `;
    return;
  }

  // Create a card for each playlist
  renderAdditionalPlaylists(playlists);
}

// Render additional playlists (for infinite scrolling)
function renderAdditionalPlaylists(playlists) {
  if (!playlistsContainer) {
    debug("ERROR: Playlist container not found");
    return;
  }

  debug(`Rendering ${playlists.length} additional playlists`);

  // Create a card for each playlist
  playlists.forEach((playlist) => {
    try {
      const playlistCard = document.createElement("div");
      playlistCard.className = "playlist-card";

      const playlistImageUrl =
        playlist.images && playlist.images.length > 0
          ? playlist.images[0].url
          : "https://community.spotify.com/t5/image/serverpage/image-id/55829iC2AD64ADB887E2A5/image-size/medium?v=v2&px=400";

      playlistCard.innerHTML = `
        <a href="${
          playlist.external_urls.spotify
        }" class="playlist-link" target="_blank">
          <img src="${playlistImageUrl}" alt="${
        playlist.name
      }" class="playlist-image">
          <div class="playlist-details">
            <h3 class="playlist-name">${playlist.name}</h3>
            <p class="playlist-owner">By ${
              playlist.owner.display_name || playlist.owner.id
            }</p>
            <p class="playlist-tracks">${playlist.tracks.total} ${
        playlist.tracks.total === 1 ? "track" : "tracks"
      }</p>
          </div>
        </a>
      `;

      playlistsContainer.appendChild(playlistCard);
    } catch (error) {
      debug(`Error rendering playlist: ${error.message}`);
      console.error("Error rendering playlist:", error, playlist);
    }
  });

  debug("Playlist cards created and added to DOM");
}

// Handle page navigation based on URL
async function handleLocationChange() {
  try {
    const path = window.location.pathname;
    debug(`Handling location change: ${path}`);

    const status = await checkAuthStatus();

    if (path === "/playlists") {
      debug("On playlists page path");
      if (status.authenticated) {
        debug("User is authenticated, showing playlists page");
        showPage(playlistsPage);

        // Load playlists data
        await loadUserData();
      } else {
        debug("User not authenticated, redirecting to home");
        window.history.pushState({}, "", "/");
        showPage(loginPage);
      }
    } else {
      debug("On home/other path");
      if (status.authenticated) {
        debug("User is authenticated, redirecting to playlists");
        window.history.pushState({}, "", "/playlists");
        showPage(playlistsPage);

        // Load playlists data
        await loadUserData();
      } else {
        debug("User not authenticated, showing login page");
        showPage(loginPage);
      }
    }
  } catch (error) {
    debug(`Error in location change handler: ${error.message}`);
    console.error("Navigation error:", error);
    showPage(loginPage);
  }
}

// Attach logout function to window for button click
window.logoutClick = logout;

document.addEventListener("DOMContentLoaded", () => {
  debug(`DOM Content Loaded`);
  debug(`Login page element exists: ${!!loginPage}`);
  debug(`Playlists page element exists: ${!!playlistsPage}`);
  debug(`Playlists container element exists: ${!!playlistsContainer}`);
  debug(`Loading indicator element exists: ${!!loadingIndicator}`);

  // Attach event listener to the login button for better feedback
  const loginButton = document.querySelector(".login-button");
  if (loginButton) {
    debug("Login button found, adding click listener");
  } else {
    debug("Login button not found");
  }

  // Run the app
  initApp();
});

window.spotifyLoginClick = () => {
  debug("Login button clicked");
  window.location.href = "/login";
};

// Debug helper functions (unchanged)
window.debugSpotify = {
  // Other debug functions...

  // Force load more playlists
  loadMore: function () {
    loadMorePlaylists();
  },
};
