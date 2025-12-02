// /opt/dropify/Discount API/dropify-backend/routes/discounts.js
const express = require("express");
const router = express.Router();

const Streamer = require("../models/Streamer");
const { createViewerDiscount, createGlobalDrop } = require("../services/discounts");

/**
 * 🔹 1) SETTINGS-AWARE PERSONAL DISCOUNT FOR A VIEWER
 *
 * POST /api/discounts/:login
 *
 * Body:
 * {
 *   "viewerId": "123456",
 *   "viewerLogin": "someviewer",
 *   "viewerDisplayName": "SomeViewer"
 * }
 */
router.post("/:login", async (req, res) => {
  try {
    const login = (req.params.login || "").toLowerCase();
    const { viewerId, viewerLogin, viewerDisplayName } = req.body || {};

    if (!viewerId || !viewerLogin) {
      return res.status(400).json({
        ok: false,
        error: "viewerId and viewerLogin are required",
      });
    }

    const result = await createViewerDiscount(login, {
      viewerId: String(viewerId),
      viewerLogin: String(viewerLogin).toLowerCase(),
      viewerDisplayName: viewerDisplayName || viewerLogin,
    });

    // Keep HTTP 200 so the bot just reads the JSON and reacts to result.ok / result.reason
    return res.status(200).json(result);
  } catch (err) {
    console.error("❌ Error in POST /api/discounts/:login", err);
    return res.status(500).json({
      ok: false,
      error: "Internal server error",
    });
  }
});

/**
 * 🔹 2) GLOBAL DROP (streamer-controlled, optional)
 *
 * POST /api/discounts/:login/global
 *
 * Body:
 * {
 *   "percent": 10
 * }
 */
router.post("/:login/global", async (req, res) => {
  try {
    const login = (req.params.login || "").toLowerCase();
    const { percent } = req.body || {};

    if (!percent || percent < 1 || percent > 50) {
      return res
        .status(400)
        .json({ ok: false, error: "percent must be between 1–50" });
    }

    // Load streamer config
    const streamer = await Streamer.findOne({ twitchLogin: login });
    if (
      !streamer ||
      !streamer.shopifyStoreDomain ||
      !streamer.shopifyAdminToken
    ) {
      return res.status(400).json({
        ok: false,
        error: "Streamer has not set up Shopify yet",
      });
    }

    const drop = await createGlobalDrop(streamer, percent);

    return res.json({ ok: true, drop });
  } catch (err) {
    console.error("❌ Global drop error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

module.exports = router;
