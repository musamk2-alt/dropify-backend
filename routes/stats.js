// /opt/dropify/Discount API/dropify-backend/routes/stats.js
const express = require("express");
const router = express.Router();

const Streamer = require("../models/Streamer");
const Drop = require("../models/Drop");
const Redemption = require("../models/Redemption");

/**
 * Helper: get start-of-today in UTC
 */
function getStartOfTodayUTC() {
  const now = new Date();
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  return start;
}

/**
 * GET /api/stats/:login
 *
 * Returns high-level stats for a streamer:
 * - dropsToday
 * - redemptionsToday
 * - redemptionRate
 * - revenue24h
 * - discountValueToday
 */
router.get("/:login", async (req, res) => {
  try {
    const login = (req.params.login || "").toLowerCase();
    if (!login) {
      return res.status(400).json({
        ok: false,
        error: "login is required",
      });
    }

    // 1) Find streamer
    const streamer = await Streamer.findOne({ twitchLogin: login }).lean();
    if (!streamer) {
      return res.status(404).json({
        ok: false,
        error: "streamer_not_found",
      });
    }

    const streamerId = streamer._id;
    const now = new Date();
    const startOfToday = getStartOfTodayUTC();
    const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // 2) Query in parallel
    const [dropsToday, redemptionsToday, redemptions24hDocs, redemptionsTodayDocs] =
      await Promise.all([
        Drop.countDocuments({
          streamerId,
          createdAt: { $gte: startOfToday },
        }),

        Redemption.countDocuments({
          streamerId,
          createdAt: { $gte: startOfToday },
        }),

        Redemption.find({
          streamerId,
          createdAt: { $gte: since24h },
        }).select("rawOrder"),

        Redemption.find({
          streamerId,
          createdAt: { $gte: startOfToday },
        }).select("discountAmount rawOrder"),
      ]);

    // 3) Compute revenue last 24h
    let revenue24h = 0;
    for (const r of redemptions24hDocs) {
      // Shopify typically has total_price as a string
      const raw = r.rawOrder || {};
      const priceStr =
        raw.current_total_price ||
        raw.total_price ||
        raw.subtotal_price ||
        null;

      if (priceStr != null) {
        const val = parseFloat(priceStr);
        if (!Number.isNaN(val)) {
          revenue24h += val;
        }
      }
    }

    // 4) Sum discount value for today (optional metric)
    let discountValueToday = 0;
    for (const r of redemptionsTodayDocs) {
      // discountAmount is often a string -> parse as float
      if (r.discountAmount != null) {
        const val = parseFloat(String(r.discountAmount));
        if (!Number.isNaN(val)) {
          discountValueToday += val;
        }
      }
    }

    // 5) Redemption rate (today)
    const redemptionRate =
      dropsToday > 0 ? redemptionsToday / dropsToday : 0;

    return res.json({
      ok: true,
      stats: {
        dropsToday,
        redemptionsToday,
        redemptionRate,      // e.g. 0.25 -> 25%
        revenue24h,          // number (Shopify currency units)
        discountValueToday,  // total discount value across today's redemptions
        // For convenience you can also return raw timestamps:
        period: {
          startOfToday: startOfToday.toISOString(),
          since24h: since24h.toISOString(),
          now: now.toISOString(),
        },
      },
    });
  } catch (err) {
    console.error("❌ Error in GET /api/stats/:login", err);
    return res.status(500).json({
      ok: false,
      error: "Internal server error",
    });
  }
});

module.exports = router;
