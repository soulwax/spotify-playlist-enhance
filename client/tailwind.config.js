/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        "spotify-green": "#1DB954",
        "spotify-black": "#191414",
        "spotify-light-black": "#212121",
        "spotify-white": "#FFFFFF",
        "spotify-gray": "#B3B3B3",
        "spotify-dark-gray": "#535353",
      },
    },
  },
  plugins: [],
};
