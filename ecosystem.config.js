// File: ecosystem.config.js
module.exports = {
  apps: [
    {
      name: "spotify-playlist-viewer",
      script: "./dist/src/index.js", // Make sure this points to the correct file
      instances: 1,
      watch: false,
      max_memory_restart: "256M",
      env: {
        NODE_ENV: "production",
        PORT: 3030,
      },
      env_production: {
        NODE_ENV: "production",
      },
      time: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    },
  ],
};
