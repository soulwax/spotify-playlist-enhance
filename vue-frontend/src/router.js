// File: src/router.js
import { createRouter, createWebHistory } from "vue-router";
import store from "./store";

// Components
import LoginPage from "./components/LoginPage.vue";
import PlaylistsPage from "./components/PlaylistsPage.vue";

const routes = [
  {
    path: "/",
    name: "Home",
    component: LoginPage,
  },
  {
    path: "/playlists",
    name: "Playlists",
    component: PlaylistsPage,
    meta: { requiresAuth: true },
  },
  {
    path: "/login",
    redirect: "/",
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

// Navigation guard to check authentication
router.beforeEach(async (to, from, next) => {
  // Check if route requires authentication
  if (to.matched.some((record) => record.meta.requiresAuth)) {
    try {
      // Check auth status if not already checked
      if (store.state.isAuthChecking || !store.state.isAuthChecked) {
        await store.dispatch("checkAuthStatus");
      }

      if (store.state.authenticated) {
        // User is authenticated, proceed to route
        next();
      } else {
        // Not authenticated, redirect to login
        next({ path: "/" });
      }
    } catch (error) {
      console.error("Navigation guard error:", error);
      next({ path: "/" });
    }
  } else {
    // Route doesn't require auth
    if (to.path === "/" && store.state.authenticated) {
      // If already authenticated and trying to access login page, redirect to playlists
      next({ path: "/playlists" });
    } else {
      next();
    }
  }
});

export default router;
