// File: ecosystem.config.js
module.exports = {
  apps: [
    {
      name: "spotify-playlist-viewer",
      script: "dist/src/index.js",
      instances: 1,
      autostart: true,
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
