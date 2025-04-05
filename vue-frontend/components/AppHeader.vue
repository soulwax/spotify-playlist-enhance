<template>
  <header>
    <div class="header-content">
      <div class="logo">
        <svg viewBox="0 0 24 24" width="32" height="32">
          <path
            fill="currentColor"
            d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.48.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"
          />
        </svg>
        <h1>Spotify Playlists</h1>
      </div>
      <div v-if="user" class="user-profile">
        <img
          :src="userAvatar"
          :alt="`${user.display_name || user.id} avatar`"
        />
        <span>{{ user.display_name || user.id }}</span>
        <button @click="logout" class="logout-button" title="Logout">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
            <polyline points="16 17 21 12 16 7"></polyline>
            <line x1="21" y1="12" x2="9" y2="12"></line>
          </svg>
        </button>
      </div>
    </div>
  </header>
</template>

<script>
import { computed } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";

export default {
  name: "AppHeader",

  setup() {
    const store = useStore();
    const router = useRouter();

    const user = computed(() => store.state.user);

    const userAvatar = computed(() => {
      if (user.value && user.value.images && user.value.images.length > 0) {
        return user.value.images[0].url;
      }
      // Fallback image
      return "https://i.scdn.co/image/ab6761610000e5ebf5c9cb7c03d1e4e5226fc232";
    });

    const logout = async () => {
      await store.dispatch("logout");
      router.push("/");
    };

    return {
      user,
      userAvatar,
      logout,
    };
  },
};
</script>
