// /var/www/dropify-backend/routes/plan.js
const express = require("express");
const router = express.Router();

const Streamer = require("../models/Streamer");
const {
  PLAN_LIMITS,
  getPlanForStreamer,
  getMonthlyDropUsage,
} = require("../services/planLimits");

/**
 * GET /api/plan/:login
 *
 * Returns current plan, limits and this-month usage
 * for viewer + global drops.
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

    const streamer = await Streamer.findOne({ twitchLogin: login }).lean();
    if (!streamer) {
      return res.status(404).json({
        ok: false,
        error: "Streamer not found",
      });
    }

    const plan = getPlanForStreamer(streamer);
    const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;

    // current month window
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    // usage for this month
    const [viewerUsed, globalUsed] = await Promise.all([
      getMonthlyDropUsage(streamer._id, "viewer"),
      getMonthlyDropUsage(streamer._id, "global"),
    ]);

    return res.json({
      ok: true,
      plan,
      limits: {
        viewerDropsPerMonth: limits.viewerDropsPerMonth ?? null,
        globalDropsPerMonth: limits.globalDropsPerMonth ?? null,
      },
      usage: {
        viewerDropsThisMonth: viewerUsed || 0,
        globalDropsThisMonth: globalUsed || 0,
      },
      period: {
        monthStart: monthStart.toISOString(),
        monthEnd: monthEnd.toISOString(),
        now: now.toISOString(),
      },
    });
  } catch (err) {
    console.error("❌ Error in GET /api/plan/:login", err);
    return res.status(500).json({
      ok: false,
      error: "Internal server error",
    });
  }
});

module.exports = router;
