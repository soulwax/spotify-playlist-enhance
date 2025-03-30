export interface SpotifyAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string;
  port: number;
  isProduction: boolean;
}

// --- Configuration Types ---
export interface SpotifyAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string;
  port: number;
  isProduction: boolean;
}

/**
 * Interface for Spotify image object
 */
export interface SpotifyImage {
  url: string;
  height: number | null;
  width: number | null;
}

/**
 * Interface for Spotify user object
 */
export interface SpotifyUser {
  display_name: string | null;
  external_urls: {
    spotify: string;
  };
  followers?: {
    href: string | null;
    total: number;
  };
  href: string;
  id: string;
  images: SpotifyImage[];
  type: "user";
  uri: string;
}

/**
 * Interface for Spotify playlist tracks reference
 */
export interface PlaylistTracksRef {
  href: string;
  total: number;
}

/**
 * Interface for Spotify playlist object
 */
export interface SpotifyPlaylist {
  collaborative: boolean;
  description: string | null;
  external_urls: {
    spotify: string;
  };
  href: string;
  id: string;
  images: SpotifyImage[];
  name: string;
  owner: SpotifyUser;
  public: boolean | null;
  snapshot_id: string;
  tracks: PlaylistTracksRef;
  type: "playlist";
  uri: string;
}

/**
 * Interface for Spotify playlists response
 */
export interface SpotifyPlaylistsResponse {
  href: string;
  items: SpotifyPlaylist[];
  limit: number;
  next: string | null;
  offset: number;
  previous: string | null;
  total: number;
}

/**
 * Interface for auth status response
 */
export interface AuthStatusResponse {
  authenticated: boolean;
  expiresAt?: string;
}

/**
 * Interface representing Spotify OAuth token data
 * Based on Spotify API documentation: https://developer.spotify.com/documentation/general/guides/authorization/code-flow/
 */
export interface TokenData {
  /** The access token that can be used to authenticate Spotify API requests */
  access_token: string;

  /** The type of token, usually "Bearer" */
  token_type: string;

  /** The number of seconds after which the access token expires */
  expires_in: number;

  /** The refresh token that can be used to obtain a new access token */
  refresh_token: string;

  /** Space-separated list of scopes that were approved by the user */
  scope: string;

  /** Human-readable timestamp of when the token expires (added by our application) */
  expires_at: string;
}
