// routes/discounts.js
require("dotenv").config();
const express = require("express");
const router = express.Router();

const Streamer = require("../models/Streamer");
const {
  createViewerDiscount,
  createGlobalDrop
} = require("../services/discounts");

/**
 * 🔹 1) Create a PERSONAL discount for a viewer
 * POST /api/discounts/:twitchLogin/viewer
 */
router.post("/:twitchLogin/viewer", async (req, res) => {
  try {
    const { twitchLogin } = req.params;
    const { viewerName } = req.body;

    if (!viewerName) {
      return res.status(400).json({ ok: false, error: "viewerName is required" });
    }

    // Load config from DB
    const streamer = await Streamer.findOne({ twitchLogin });
    if (!streamer || !streamer.shopifyStoreDomain || !streamer.shopifyAdminToken) {
      return res.status(400).json({
        ok: false,
        error: "Streamer has not set up Shopify yet",
      });
    }

    const discount = await createViewerDiscount(
      streamer,
      viewerName
    );

    res.json({ ok: true, discount });
  } catch (err) {
    console.error("Viewer discount error:", err);
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

/**
 * 🔹 2) Create a GLOBAL drop (streamer controlled)
 * POST /api/discounts/:twitchLogin/global
 */
router.post("/:twitchLogin/global", async (req, res) => {
  try {
    const { twitchLogin } = req.params;
    const { percent } = req.body;

    if (!percent || percent < 1 || percent > 50) {
      return res
        .status(400)
        .json({ ok: false, error: "percent must be between 1–50" });
    }

    // Load streamer config
    const streamer = await Streamer.findOne({ twitchLogin });
    if (!streamer || !streamer.shopifyStoreDomain || !streamer.shopifyAdminToken) {
      return res.status(400).json({
        ok: false,
        error: "Streamer has not set up Shopify yet",
      });
    }

    const drop = await createGlobalDrop(streamer, percent);

    res.json({ ok: true, drop });
  } catch (err) {
    console.error("Global drop error:", err);
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

module.exports = router;
