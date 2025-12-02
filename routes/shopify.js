// /opt/dropify/Discount API/dropify-backend/routes/shopify.js
require("dotenv").config();
const express = require("express");
const axios = require("axios");
const router = express.Router();

const Streamer = require("../models/Streamer");
const { ensureOrderCreateWebhook } = require("../services/shopify");

const {
  SHOPIFY_CLIENT_ID,
  SHOPIFY_CLIENT_SECRET,
  SHOPIFY_REDIRECT_URI,
  SHOPIFY_SCOPES,
} = process.env;

/**
 * 🔹 START Shopify OAuth
 *
 * GET /api/shopify/auth/start?login=<twitchLogin>&shop=<shop-domain>
 */
router.get("/auth/start", async (req, res) => {
  try {
    const { login, shop } = req.query;

    if (!login || !shop) {
      return res.status(400).send("Missing login or shop parameter.");
    }

    const twitchLogin = String(login).toLowerCase();
    const shopDomain = String(shop);

    // Optional: verify streamer exists
    const streamer = await Streamer.findOne({ twitchLogin });
    if (!streamer) {
      return res.status(404).send("Streamer not found.");
    }

    if (!SHOPIFY_CLIENT_ID || !SHOPIFY_REDIRECT_URI || !SHOPIFY_SCOPES) {
      console.error("Shopify env vars missing.");
      return res.status(500).send("Shopify config missing on server.");
    }

    // Simple state format: "login:<twitchLogin>"
    const state = `login:${twitchLogin}`;

    const redirectUrl = `https://${shopDomain}/admin/oauth/authorize` +
      `?client_id=${encodeURIComponent(SHOPIFY_CLIENT_ID)}` +
      `&scope=${encodeURIComponent(SHOPIFY_SCOPES)}` +
      `&redirect_uri=${encodeURIComponent(SHOPIFY_REDIRECT_URI)}` +
      `&state=${encodeURIComponent(state)}`;

    return res.redirect(302, redirectUrl);
  } catch (err) {
    console.error("Shopify auth start error:", err);
    return res.status(500).send("Shopify auth start error.");
  }
});

/**
 * 🔹 Shopify OAuth CALLBACK
 *
 * Configured in your Shopify app as SHOPIFY_REDIRECT_URI
 * e.g. https://api.dropifybot.com/api/shopify/auth/callback
 */
router.get("/auth/callback", async (req, res) => {
  try {
    const { code, shop, state } = req.query;

    if (!code || !shop || !state) {
      return res.status(400).send("Missing required query params.");
    }

    // state must be "login:<twitchLogin>"
    const parts = String(state).split(":");
    const stateType = parts[0];
    const loginFromState = parts[1];

    if (stateType !== "login" || !loginFromState) {
      return res.status(400).send("Invalid state parameter.");
    }

    const twitchLogin = loginFromState.toLowerCase();

    const streamer = await Streamer.findOne({ twitchLogin });
    if (!streamer) {
      return res.status(404).send("Streamer not found.");
    }

    if (!SHOPIFY_CLIENT_ID || !SHOPIFY_CLIENT_SECRET) {
      console.error("Shopify env vars missing.");
      return res.status(500).send("Shopify config missing on server.");
    }

    // Exchange code -> access token
    const tokenRes = await axios.post(
      `https://${shop}/admin/oauth/access_token`,
      {
        client_id: SHOPIFY_CLIENT_ID,
        client_secret: SHOPIFY_CLIENT_SECRET,
        code,
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    const accessToken = tokenRes.data.access_token;
    if (!accessToken) {
      console.error("[Shopify callback] No access_token in response:", tokenRes.data);
      return res.status(500).send("Failed to get Shopify access token.");
    }

    // Save Shopify connection details on Streamer
    streamer.shopifyStoreDomain = shop;
    streamer.shopifyAdminToken = accessToken;
    streamer.shopifyConnected = true;
    streamer.shopifyApiVersion = streamer.shopifyApiVersion || "2025-01";

    await streamer.save();

    // Ensure webhook is registered
    try {
      await ensureOrderCreateWebhook(shop, accessToken);
    } catch (webhookErr) {
      console.error("Error ensuring Shopify orders/create webhook:", webhookErr);
      // Don't block redirect on webhook failure
    }

    // Redirect back to dashboard
    const redirectUrl = `https://bot.dropifybot.com/?login=${encodeURIComponent(
      twitchLogin
    )}&shopify=connected`;

    return res.redirect(302, redirectUrl);
  } catch (err) {
    console.error("Shopify OAuth callback error:", err?.response?.data || err);
    return res.status(500).send("Shopify OAuth callback error.");
  }
});

module.exports = router;
