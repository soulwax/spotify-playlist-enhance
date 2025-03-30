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
- **Production Ready**: PM2 configuration for robust production deployment

## Technologies Used

- **Backend**:
  - Node.js with TypeScript
  - Express.js for API and serving static files
  - Spotify Web API for authentication and data retrieval
  - PM2 for production process management

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
│   ├── server.ts            # Server and authentication logic
│   ├── get-spotify-auth.ts  # Spotify OAuth handling
│   ├── index.ts             # Application entry point
│   ├── types/               # TypeScript type definitions
│   └── utils/               # Utility functions
├── ecosystem.config.js      # PM2 configuration
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

The application comes with PM2 configuration for production deployment. To deploy:

```bash
# Build the TypeScript application
npm run build

# Start with PM2
npm run pm2:start

# Or use the combined command
npm run production
```

Additional PM2 scripts:

```bash
# View application logs
npm run pm2:logs

# Monitor application performance
npm run pm2:monitor

# Restart the application
npm run pm2:restart

# Stop the application
npm run pm2:stop
```

For detailed deployment instructions, see the [Production Deployment Guide](DEPLOYMENT.md).

## Authentication Flow

The application uses the Spotify OAuth 2.0 Authorization Code flow:

1. User initiates login → Redirected to Spotify for authentication
2. User authorizes the app → Spotify redirects back with an authorization code
3. Server exchanges the code for access and refresh tokens
4. Application uses the access token to fetch data from Spotify API

## Token Management

This application includes:

- Automatic token refresh when expired
- Persistent token storage (development vs production environments)
- CSRF protection using state verification
- Separate token files for development and production

## Security Considerations

- Store your `.env` file securely and don't commit it to version control
- Configure PM2 properly in production environments
- Consider using a reverse proxy like Nginx to handle HTTPS
- Regularly update dependencies to address security vulnerabilities

## License

MIT

## Acknowledgements

- [Spotify Web API](https://developer.spotify.com/documentation/web-api/)
- [Spotify Brand Guidelines](https://developer.spotify.com/documentation/general/design-and-branding/)
- [PM2](https://pm2.keymetrics.io/) for production process management

## Future Enhancements

- Token refresh implementation
- Playlist search functionality
- Playlist creation and management
- Track listing and playback controls
- Integration with other Spotify features
