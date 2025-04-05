<!-- File: src/components/PlaylistCard.vue -->

<template>
  <div class="playlist-card">
    <a
      :href="playlist.external_urls.spotify"
      class="playlist-link"
      target="_blank"
    >
      <img :src="playlistImage" :alt="playlist.name" class="playlist-image" />
      <div class="playlist-details">
        <h3 class="playlist-name">{{ playlist.name }}</h3>
        <p class="playlist-owner">
          By {{ playlist.owner.display_name || playlist.owner.id }}
        </p>
        <p class="playlist-tracks">
          {{ playlist.tracks.total }}
          {{ playlist.tracks.total === 1 ? "track" : "tracks" }}
        </p>
      </div>
    </a>
  </div>
</template>

<script>
export default {
  name: "PlaylistCard",

  props: {
    playlist: {
      type: Object,
      required: true,
    },
  },

  computed: {
    playlistImage() {
      return this.playlist.images && this.playlist.images.length > 0
        ? this.playlist.images[0].url
        : "https://community.spotify.com/t5/image/serverpage/image-id/55829iC2AD64ADB887E2A5/image-size/medium?v=v2&px=400";
    },
  },
};
</script>
