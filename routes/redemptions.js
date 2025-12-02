// /opt/dropify/Discount API/dropify-backend/routes/redemptions.js
const express = require("express");
const router = express.Router();

const Redemption = require("../models/Redemption");
const Streamer = require("../models/Streamer");

/**
 * GET /api/redemptions/:login
 *
 * Query params:
 *   - limit (optional, default 20, max 100)
 *   - page  (optional, default 1)
 *
 * Example:
 *   GET /api/redemptions/dropifybot?limit=10
 */
router.get("/:login", async (req, res) => {
  try {
    const loginParam = req.params.login;
    const login = loginParam.toLowerCase();

    // Pagination params
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const skip = (page - 1) * limit;

    // Ensure streamer exists
    const streamer = await Streamer.findOne({
      twitchLogin: login,
    });

    if (!streamer) {
      return res.status(404).json({ error: "Streamer not found" });
    }

    const query = { streamerId: streamer._id };

    const [total, redemptions] = await Promise.all([
      Redemption.countDocuments(query),
      Redemption.find(query)
        .sort({ createdAt: -1 }) // newest first
        .skip(skip)
        .limit(limit),
    ]);

    res.json({
      login,
      total,
      page,
      pageSize: redemptions.length,
      // Shape the payload for the dashboard
      redemptions: redemptions.map((r) => ({
        id: r._id,
        orderNumber: r.shopifyOrderNumber || null,
        orderId: r.shopifyOrderId,
        discountCode: r.discountCode || null,
        discountAmount: r.discountAmount || null,
        discountType: r.discountType || null,
        customerEmail: r.customerEmail || null,
        customerId: r.customerId || null,
        shopifyStoreDomain: r.shopifyStoreDomain,
        createdAt: r.createdAt,
      })),
    });
  } catch (err) {
    console.error("❌ Error in GET /api/redemptions/:login", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
