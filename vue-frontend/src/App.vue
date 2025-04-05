<template>
  <div class="app-container">
    <AppHeader />
    <main id="mainContent">
      <router-view />
    </main>
    <footer>
      <p>Created with Spotify Web API</p>
    </footer>
  </div>
</template>

<script>
import AppHeader from "./components/AppHeader.vue";

export default {
  name: "App",
  components: {
    AppHeader,
  },
};
</script>
