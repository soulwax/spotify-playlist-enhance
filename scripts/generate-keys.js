#!/usr/bin/env node

/**
 * This script generates secure random keys for your application's security settings.
 * Run with: node scripts/generate-keys.js
 */

const crypto = require("crypto");

// Generate a random 32-byte hex string for the state encryption key
const stateEncryptionKey = crypto.randomBytes(32).toString("hex");

// Generate random secrets for session and cookies
const sessionSecret = crypto.randomBytes(32).toString("base64");
const cookieSecret = crypto.randomBytes(32).toString("base64");

console.log(`\x1b[32m
=============================================
    Security Keys for Spotify Auth Server
=============================================\x1b[0m

Add these to your .env file:

\x1b[33m# Security settings
SESSION_SECRET="${sessionSecret}"
COOKIE_SECRET="${cookieSecret}"
STATE_ENCRYPTION_KEY="${stateEncryptionKey}"\x1b[0m

Keep these values private and never commit them to version control!

\x1b[32m=============================================\x1b[0m
`);
