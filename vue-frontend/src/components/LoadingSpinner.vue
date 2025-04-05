<!-- File: src/components/LoadingSpinner.vue -->

<template>
  <div :class="containerClass">
    <div class="loading-spinner"></div>
    <p>{{ message }}</p>
  </div>
</template>

<script>
export default {
  name: "LoadingSpinner",

  props: {
    message: {
      type: String,
      default: "Loading...",
    },
    type: {
      type: String,
      default: "main", // 'main' or 'more'
      validator: (value) => ["main", "more"].includes(value),
    },
  },

  computed: {
    containerClass() {
      return this.type === "main" ? "loading-container" : "loading-more";
    },
  },
};
</script>
