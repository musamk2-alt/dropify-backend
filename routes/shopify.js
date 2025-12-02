const express = require("express");
const axios = require("axios");
const crypto = require("crypto");

const Streamer = require("../models/Streamer");
const { ensureOrderCreateWebhook } = require("../services/shopify");

const router = express.Router();

const SHOPIFY_CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const SHOPIFY_CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const SHOPIFY_REDIRECT_URI = process.env.SHOPIFY_REDIRECT_URI;
const SHOPIFY_SCOPES =
  process.env.SHOPIFY_SCOPES ||
  "write_price_rules,read_price_rules,write_discounts,read_discounts,read_orders";

/**
 * START SHOPIFY OAUTH
 *
 * GET /api/shopify/auth/start?login=<twitchLogin>&shop=<shop-domain.myshopify.com>
 *
 * - Validates params
 * - Finds the streamer
 * - Encodes state (twitchLogin + shop)
 * - Redirects to Shopify /admin/oauth/authorize with scopes + redirect_uri
 */
router.get("/auth/start", async (req, res) => {
  try {
    const { login, shop } = req.query;

    if (!login || !shop) {
      return res.status(400).send("Missing login or shop");
    }

    const twitchLogin = String(login).toLowerCase();
    const shopDomain = String(shop);

    const streamer = await Streamer.findOne({
      twitchLogin,
    });

    if (!streamer) {
      return res.status(404).send("Streamer not found");
    }

    const stateRaw = JSON.stringify({
      t: streamer.twitchLogin, // twitch login
      s: shopDomain, // store domain
      r: crypto.randomBytes(8).toString("hex"), // random nonce
    });

    const state = Buffer.from(stateRaw, "utf8").toString("base64url");

    const installUrl = `https://${encodeURIComponent(
      shopDomain
    )}/admin/oauth/authorize?client_id=${SHOPIFY_CLIENT_ID}&scope=${encodeURIComponent(
      SHOPIFY_SCOPES
    )}&redirect_uri=${encodeURIComponent(
      SHOPIFY_REDIRECT_URI
    )}&state=${encodeURIComponent(state)}`;

    console.log("🔗 Shopify install URL:", installUrl);

    return res.redirect(installUrl);
  } catch (err) {
    console.error("Shopify auth start error:", err);
    return res.status(500).send("Error starting Shopify auth");
  }
});

/**
 * SHOPIFY OAUTH CALLBACK
 *
 * Shopify redirects here after merchant installs / approves app:
 *
 * GET /api/shopify/auth/callback?code=...&shop=...&state=...
 *
 * - Validates params
 * - Decodes state to find twitchLogin + shop
 * - Exchanges code -> access_token
 * - Saves token on streamer
 * - Registers orders/create webhook
 * - Redirects back to Dropify dashboard
 */
router.get("/auth/callback", async (req, res) => {
  try {
    const { code, shop, state } = req.query;

    if (!code || !shop || !state) {
      return res.status(400).send("Missing code, shop or state");
    }

    const shopDomain = String(shop);

    // Decode state to get twitchLogin etc.
    let twitchLogin;
    try {
      const decoded = JSON.parse(
        Buffer.from(String(state), "base64url").toString("utf8")
      );
      twitchLogin = decoded.t;
    } catch (e) {
      console.error("Invalid Shopify state:", state, e);
      return res.status(400).send("Invalid state");
    }

    if (!twitchLogin) {
      return res.status(400).send("Missing twitchLogin in state");
    }

    const streamer = await Streamer.findOne({
      twitchLogin: String(twitchLogin).toLowerCase(),
    });

    if (!streamer) {
      return res.status(404).send("Streamer not found");
    }

    // Exchange code for access token
    const tokenResp = await axios.post(
      `https://${shopDomain}/admin/oauth/access_token`,
      {
        client_id: SHOPIFY_CLIENT_ID,
        client_secret: SHOPIFY_CLIENT_SECRET,
        code,
      }
    );

    const accessToken = tokenResp.data.access_token;

    // Save Shopify connection info on streamer
    streamer.shopifyStoreDomain = shopDomain;
    streamer.shopifyAdminToken = accessToken;
    await streamer.save();

    console.log(
      `✅ Shopify connected for ${streamer.twitchLogin} (${shopDomain})`
    );

    // Try to register orders/create webhook (non-fatal if it fails)
    try {
      await ensureOrderCreateWebhook(shopDomain, accessToken);
    } catch (webhookErr) {
      console.error("Failed to register Shopify webhook:", webhookErr);
      // don't block redirect for this
    }

    // Redirect back to Dropify dashboard
    return res.redirect(
      `https://bot.dropifybot.com/?login=${encodeURIComponent(
        streamer.twitchLogin
      )}&shopify=connected`
    );
  } catch (err) {
    console.error(
      "Shopify auth callback error:",
      err.response?.data || err.message || err
    );
    return res
      .status(500)
      .send("Error completing Shopify connection. Please try again.");
  }
});

module.exports = router;
