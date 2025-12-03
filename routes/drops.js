// /opt/dropify/Discount API/dropify-backend/routes/drops.js
const express = require("express");
const router = express.Router();

const Drop = require("../models/Drop");

/**
 * GET /api/drops/:login/recent?limit=10
 *
 * Returns the most recent drops (discount codes created) for a streamer.
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

    const drops = await Drop.find({ twitchLogin: login })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    const mapped = drops.map((d) => ({
      id: d._id,
      viewerLogin: d.viewerLogin,
      viewerDisplayName: d.viewerDisplayName,
      discountCode: d.discountCode,
      discountType: d.discountType,
      discountValue: d.discountValue,
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
