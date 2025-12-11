// /var/www/dropify-backend/routes/drops.js

const express = require("express");
const router = express.Router();

const Drop = require("../models/Drop");

/**
 * GET /api/drops/:login/recent?limit=10
 *
 * Returns the most recent drops (discount codes created) for a streamer.
 * Includes both viewer drops and global drops.
 */
router.get("/:login/recent", async (req, res) => {
  try {
    const login = (req.params.login || "").toLowerCase();
    const limit =
      Number.parseInt(req.query.limit, 10) > 0
        ? Number.parseInt(req.query.limit, 10)
        : 10;

    if (!login) {
      return res.status(400).json({
        ok: false,
        error: "login is required",
      });
    }

    // Fetch from MongoDB
    const drops = await Drop.find({ twitchLogin: login })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    // Map into clean, frontend-friendly format
    const mapped = drops.map((d) => ({
      id: d._id,
      kind: d.kind === "global" ? "global" : "viewer",
      viewerLogin: d.viewerLogin || null,
      viewerDisplayName: d.viewerDisplayName || null,
      discountCode: d.discountCode,
      discountType: d.discountType || null,
      discountValue: d.discountValue || null,
      createdAt: d.createdAt,
    }));

    return res.json({
      ok: true,
      drops: mapped,
    });
  } catch (err) {
    console.error("❌ Error in GET /api/drops/:login/recent", err);
    return res.status(500).json({
      ok: false,
      error: "Internal server error",
    });
  }
});

module.exports = router;
