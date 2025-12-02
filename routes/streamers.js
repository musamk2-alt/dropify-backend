const express = require("express");
const Streamer = require("../models/Streamer");

const router = express.Router();

/**
 * Simple health check for this route group
 * GET /api/streamers/ping
 */
router.get("/ping", (req, res) => {
  res.json({ ok: true, message: "streamers routes alive" });
});

/**
 * List all streamer channels (for the bot to join)
 * GET /api/streamers/channels
 */
router.get("/channels", async (req, res) => {
  try {
    const streamers = await Streamer.find({}, "twitchLogin").lean();

    const channels = streamers
      .map((s) => s.twitchLogin)
      .filter(Boolean)
      .map((login) => login.toLowerCase());

    res.json({ ok: true, channels });
  } catch (err) {
    console.error("Channels endpoint error:", err);
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

/**
 * List "active" streamers.
 * For now we just return the same as /channels.
 * Later you can filter by a flag like { isActive: true }.
 *
 * GET /api/streamers/active
 */
router.get("/active", async (req, res) => {
  try {
    const streamers = await Streamer.find({}, "twitchLogin").lean();

    const channels = streamers
      .map((s) => s.twitchLogin)
      .filter(Boolean)
      .map((login) => login.toLowerCase());

    res.json({ ok: true, channels });
  } catch (err) {
    console.error("Active endpoint error:", err);
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

/**
 * Manually set Shopify settings for a streamer (legacy/manual method)
 *
 * PATCH /api/streamers/:twitchLogin/shopify
 * Body: { shopifyStoreDomain, shopifyAdminToken, shopifyApiVersion }
 */
router.patch("/:twitchLogin/shopify", async (req, res) => {
  try {
    const twitchLoginParam = String(req.params.twitchLogin).toLowerCase();

    const streamer = await Streamer.findOne({
      twitchLogin: twitchLoginParam,
    });

    if (!streamer) {
      return res
        .status(404)
        .json({ ok: false, error: "Streamer not found" });
    }

    const {
      shopifyStoreDomain,
      shopifyAdminToken,
      shopifyApiVersion,
    } = req.body || {};

    if (shopifyStoreDomain !== undefined) {
      streamer.shopifyStoreDomain = shopifyStoreDomain || null;
    }

    if (shopifyAdminToken !== undefined) {
      streamer.shopifyAdminToken = shopifyAdminToken || null;
    }

    if (shopifyApiVersion !== undefined) {
      streamer.shopifyApiVersion = shopifyApiVersion || null;
    }

    await streamer.save();

    res.json({
      ok: true,
      streamer: {
        twitchLogin: streamer.twitchLogin,
        shopifyStoreDomain: streamer.shopifyStoreDomain || null,
        shopifyConnected:
          !!streamer.shopifyStoreDomain && !!streamer.shopifyAdminToken,
      },
    });
  } catch (err) {
    console.error("PATCH /:twitchLogin/shopify error:", err);
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

/**
 * Get basic info for one streamer (for dashboard)
 *
 * GET /api/streamers/:twitchLogin/info
 */
router.get("/:twitchLogin/info", async (req, res) => {
  try {
    const twitchLoginParam = String(req.params.twitchLogin).toLowerCase();

    const streamer = await Streamer.findOne({
      twitchLogin: twitchLoginParam,
    });

    if (!streamer) {
      return res
        .status(404)
        .json({ ok: false, error: "Streamer not found" });
    }

    const shopifyConnected =
      !!streamer.shopifyStoreDomain && !!streamer.shopifyAdminToken;

    res.json({
      ok: true,
      streamer: {
        twitchId: streamer.twitchId,
        twitchLogin: streamer.twitchLogin,
        displayName: streamer.displayName,
        email: streamer.email,
        scopes: streamer.scopes || [],
        connectedAt: streamer.connectedAt,
        lastSeenAt: streamer.lastSeenAt,
        shopifyConnected,
        shopifyStoreDomain: streamer.shopifyStoreDomain || null,
      },
    });
  } catch (err) {
    console.error("INFO endpoint error:", err);
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

module.exports = router;
