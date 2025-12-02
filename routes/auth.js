// routes/auth.js
require("dotenv").config();
const express = require("express");
const axios = require("axios");
const Streamer = require("../models/Streamer");

const router = express.Router();

// Load from .env
const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;
const TWITCH_REDIRECT_URI = process.env.TWITCH_REDIRECT_URI; 
// e.g. http://localhost:4000/api/auth/twitch/callback

// Scopes: we keep it tight + safe
const TWITCH_SCOPES = [
  "user:read:email",
  "chat:read",
].join(" ");

const TWITCH_AUTH_URL = "https://id.twitch.tv/oauth2/authorize";
const TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const TWITCH_USERS_URL = "https://api.twitch.tv/helix/users";

/**
 * GET /api/auth/twitch/login
 * Redirects user to Twitch OAuth
 */
router.get("/twitch/login", (req, res) => {
  const state = "dropify-test-state"; // later: random per session

  const params = new URLSearchParams({
    client_id: TWITCH_CLIENT_ID,
    redirect_uri: TWITCH_REDIRECT_URI,
    response_type: "code",
    scope: TWITCH_SCOPES,
    force_verify: "true",
    state,
  });

  const redirectUrl = `${TWITCH_AUTH_URL}?${params.toString()}`;
  console.log("🔗 Redirecting to Twitch:", redirectUrl);
  res.redirect(redirectUrl);
});

/**
 * GET /api/auth/twitch/callback
 * 1) Receive ?code
 * 2) Exchange code -> access & refresh token
 * 3) Fetch Twitch user profile
 * 4) Upsert Streamer in MongoDB
 */
router.get("/twitch/callback", async (req, res) => {
  const { code, error, error_description } = req.query;

  if (error) {
    console.error("Twitch OAuth error:", error, error_description);
    return res.status(400).send(`Twitch error: ${error_description || error}`);
  }

  if (!code) {
    return res.status(400).send("Missing ?code from Twitch");
  }

  console.log("✅ Got Twitch code:", code);

  try {
    // 1) Exchange code for tokens
    const tokenParams = new URLSearchParams({
      client_id: TWITCH_CLIENT_ID,
      client_secret: TWITCH_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: TWITCH_REDIRECT_URI,
    });

    const tokenRes = await axios.post(TWITCH_TOKEN_URL, tokenParams);
    const {
      access_token,
      refresh_token,
      expires_in,
      scope,
      token_type,
    } = tokenRes.data;

    // 🔑 This is the part you were asking about:
    // We convert "expires_in" (seconds from now) into a real Date
    const expiresAt = new Date(Date.now() + expires_in * 1000);

    console.log("✅ Got Twitch tokens for streamer.");

    // 2) Fetch Twitch user info (who just connected)
    const userRes = await axios.get(TWITCH_USERS_URL, {
      headers: {
        "Client-Id": TWITCH_CLIENT_ID,
        Authorization: `Bearer ${access_token}`,
      },
    });

    const user = userRes.data.data && userRes.data.data[0];
    if (!user) {
      console.error("❌ Could not get Twitch user profile");
      return res
        .status(500)
        .send("Could not fetch Twitch user profile from Helix.");
    }

    const twitchId = user.id;
    const twitchLogin = user.login;
    const displayName = user.display_name;
    const email = user.email;

    // 3) Upsert streamer in MongoDB
    const update = {
      twitchId,
      twitchLogin,
      displayName,
      email: email || undefined,

      accessToken: access_token,
      refreshToken: refresh_token,
      tokenType: token_type,
      scopes: scope || [],
      expiresAt,                 // <-- stored as a Date
      lastSeenAt: new Date(),
    };

    const streamer = await Streamer.findOneAndUpdate(
      { twitchId },
      { $set: update },
      { upsert: true, new: true }
    );

    console.log("✅ Streamer saved/updated in MongoDB:", {
      id: streamer._id,
      twitchId: streamer.twitchId,
      login: streamer.twitchLogin,
    });

    // 4) Simple success page for now
    return res.redirect(
      `https://bot.dropifybot.com/?login=${encodeURIComponent(
        streamer.twitchLogin
      )}`
    );
  } catch (err) {
    console.error("Twitch OAuth callback error:", err);
    return res
      .status(500)
      .send("Error completing Twitch login. Please try again.");
  }
});

module.exports = router;
