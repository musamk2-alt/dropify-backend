const express = require("express");
const router = express.Router();

const Streamer = require("../models/Streamer");
const { createViewerDiscount, createGlobalDrop } = require("../services/discounts");
const { reserveMonthlyDrop, releaseMonthlyDrop } = require("../services/planLimits");

/**
 * POST /api/discounts/:login
 * Viewer personal discount (kind: "viewer")
 * Body: { viewerId, viewerLogin, viewerDisplayName }
 */
router.post("/:login", async (req, res) => {
  const login = (req.params.login || "").toLowerCase();
  const { viewerId, viewerLogin, viewerDisplayName } = req.body || {};

  if (!login) {
    return res.status(400).json({ ok: false, error: "login is required" });
  }
  if (!viewerId || !viewerLogin) {
    return res.status(400).json({
      ok: false,
      error: "viewerId and viewerLogin are required",
    });
  }

  let streamer;
  try {
    streamer = await Streamer.findOne({ twitchLogin: login });
    if (!streamer) return res.status(404).json({ ok: false, reason: "not_found" });

    // ✅ reserve slot BEFORE doing any expensive work
    const limitCheck = await reserveMonthlyDrop({ streamer, kind: "viewer" });
    if (!limitCheck.ok) {
      return res.status(429).json({
        ok: false,
        reason: "plan_limit",
        message: limitCheck.message,
        plan: limitCheck.plan,
        limit: limitCheck.limit,
        used: limitCheck.used,
      });
    }

    // create discount (this will create Drop row)
    const result = await createViewerDiscount(login, {
      viewerId: String(viewerId),
      viewerLogin: String(viewerLogin).toLowerCase(),
      viewerDisplayName: viewerDisplayName || viewerLogin,
    });

    // If service fails, release reserved slot
    if (!result?.ok) {
      await releaseMonthlyDrop({ streamer, kind: "viewer" });
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error("❌ Error in POST /api/discounts/:login", err);
    if (streamer) {
      try {
        await releaseMonthlyDrop({ streamer, kind: "viewer" });
      } catch (_) {}
    }
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

/**
 * POST /api/discounts/:login/global
 * Global drop (kind: "global")
 * Body: { percent: number } (1..50)
 */
router.post("/:login/global", async (req, res) => {
  const login = (req.params.login || "").toLowerCase();
  const percent = Number.parseInt(req.body?.percent, 10);

  if (!login) {
    return res.status(400).json({ ok: false, error: "login is required" });
  }
  if (!Number.isFinite(percent) || percent < 1 || percent > 50) {
    return res.status(400).json({
      ok: false,
      error: "percent must be an integer between 1 and 50",
    });
  }

  let streamer;
  try {
    streamer = await Streamer.findOne({ twitchLogin: login });
    if (!streamer) return res.status(404).json({ ok: false, error: "Streamer not found" });

    const limitCheck = await reserveMonthlyDrop({ streamer, kind: "global" });
    if (!limitCheck.ok) {
      return res.status(429).json({
        ok: false,
        reason: "plan_limit",
        message: limitCheck.message,
        plan: limitCheck.plan,
        limit: limitCheck.limit,
        used: limitCheck.used,
      });
    }

    const drop = await createGlobalDrop(streamer, percent);

    // if createGlobalDrop ever returns structured failure
    if (!drop) {
      await releaseMonthlyDrop({ streamer, kind: "global" });
      return res.status(500).json({ ok: false, error: "Failed to create global drop" });
    }

    return res.status(200).json({ ok: true, drop });
  } catch (err) {
    console.error("❌ Error in POST /api/discounts/:login/global", err);
    if (streamer) {
      try {
        await releaseMonthlyDrop({ streamer, kind: "global" });
      } catch (_) {}
    }
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

module.exports = router;
