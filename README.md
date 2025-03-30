# Spotify Playlist Viewer

A web application that displays a user's Spotify playlists after authentication with the Spotify API.

<p align="center">
  <img src="docs/screenshot.png" alt="App Screenshot" width="700"/>
</p>

## Features

- **Spotify Authentication**: Secure login using OAuth 2.0 Authorization Code flow
- **Playlist Display**: View all your Spotify playlists in a clean grid layout
- **User Profile**: Display of the authenticated user's profile information
- **Responsive Design**: Works on desktop and mobile devices
- **External Links**: Easy access to open playlists directly in Spotify

## Technologies Used

- **Backend**:
  - Node.js with TypeScript
  - Express.js for API and serving static files
  - Spotify Web API for authentication and data retrieval

- **Frontend**:
  - HTML5, CSS3, and vanilla JavaScript
  - Responsive design using CSS Grid and Flexbox
  - Modern ES6+ JavaScript features

## Quick Start

1. Clone this repository
2. Set up a Spotify Developer account and create an application
3. Create a `.env` file with your Spotify credentials
4. Install dependencies with `npm install`
5. Start the development server with `npm start`

For detailed instructions, see the [Setup Guide](SETUP.md).

## Project Structure

```plaintext
/
├── public/                  # Static frontend files
│   ├── css/                 # Stylesheets
│   ├── js/                  # Client-side JavaScript
│   └── index.html           # Main HTML file
├── src/                     # TypeScript source files
│   └── server.ts            # Server and authentication logic
├── .env                     # Environment variables (create this)
└── package.json             # Project dependencies and scripts
```

## Development

To run the application in development mode:

```bash
npm start
```

This will start the server and automatically open a browser window to the application.

## Production

To run the application in production mode:

```bash
# For macOS/Linux
npm run start:prod

# For Windows
npm run start:prod:win
```

## Authentication Flow

The application uses the Spotify OAuth 2.0 Authorization Code flow:

1. User initiates login → Redirected to Spotify for authentication
2. User authorizes the app → Spotify redirects back with an authorization code
3. Server exchanges the code for access and refresh tokens
4. Application uses the access token to fetch data from Spotify API

## License

MIT

## Acknowledgements

- [Spotify Web API](https://developer.spotify.com/documentation/web-api/)
- [Spotify Brand Guidelines](https://developer.spotify.com/documentation/general/design-and-branding/)

## Future Enhancements

- Token refresh implementation
- Playlist search functionality
- Playlist creation and management
- Track listing and playback controls
- Integration with other Spotify features
