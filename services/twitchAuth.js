// services/twitchAuth.js
require("dotenv").config();
const axios = require("axios");
const Streamer = require("../models/Streamer");

const TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;

/**
 * Refresh access token for a given streamer document.
 * - uses refresh_token
 * - updates accessToken, refreshToken (if rotated), expiresAt, scopes, lastSeenAt
 */
async function refreshToken(streamer) {
  if (!streamer.refreshToken) {
    console.warn(`⚠️ No refresh token for streamer ${streamer.twitchLogin}`);
    return null;
  }

  try {
    const params = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: streamer.refreshToken,
      client_id: TWITCH_CLIENT_ID,
      client_secret: TWITCH_CLIENT_SECRET,
    });

    const res = await axios.post(TWITCH_TOKEN_URL, params);
    const {
      access_token,
      refresh_token,
      expires_in,
      scope,
      token_type,
    } = res.data;

    const expiresAt = new Date(Date.now() + expires_in * 1000);

    streamer.accessToken = access_token;
    // Twitch may or may not rotate the refresh token; only overwrite if present
    if (refresh_token) {
      streamer.refreshToken = refresh_token;
    }
    streamer.tokenType = token_type || "bearer";
    if (scope) {
      streamer.scopes = scope;
    }
    streamer.expiresAt = expiresAt;
    streamer.lastSeenAt = new Date();

    await streamer.save();

    console.log(
      `✅ Refreshed token for ${streamer.twitchLogin}, new expiry: ${expiresAt.toISOString()}`
    );

    return streamer;
  } catch (err) {
    console.error(
      `❌ Failed to refresh token for ${streamer.twitchLogin}:`,
      err.response?.data || err.message
    );
    return null;
  }
}

module.exports = {
  refreshToken,
};
