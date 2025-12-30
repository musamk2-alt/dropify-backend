// /var/www/dropify-backend/routes/discounts.js
const express = require("express");
const router = express.Router();

const Streamer = require("../models/Streamer");
const {
  createViewerDiscount,
  createGlobalDrop,
} = require("../services/discounts");
const { ensureDropLimit } = require("../services/planLimits");

/**
 * POST /api/discounts/:login
 * Viewer personal discount code (kind: "viewer")
 *
 * Body: { viewerId, viewerLogin, viewerDisplayName }
 */
router.post("/:login", async (req, res) => {
  try {
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

    // Load streamer so we can enforce plan limit + settings-aware service logic
    const streamer = await Streamer.findOne({ twitchLogin: login });
    if (!streamer) {
      return res.status(404).json({ ok: false, reason: "not_found" });
    }

    // ✅ Enforce plan limit BEFORE creation (viewer)
    const limitCheck = await ensureDropLimit({ streamer, kind: "viewer" });
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

    // Create viewer discount (your service creates the Drop row)
    const result = await createViewerDiscount(login, {
      viewerId: String(viewerId),
      viewerLogin: String(viewerLogin).toLowerCase(),
      viewerDisplayName: viewerDisplayName || viewerLogin,
    });

    // If service returns its own structured failures, pass through as 200
    // (example: disabled, cooldown, not_connected, limit_reached, not_found)
    return res.status(200).json(result);
  } catch (err) {
    console.error("❌ Error in POST /api/discounts/:login", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

/**
 * POST /api/discounts/:login/global
 * Global drop (kind: "global")
 *
 * Body: { percent: number }  (1..50)
 */
router.post("/:login/global", async (req, res) => {
  try {
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

    const streamer = await Streamer.findOne({ twitchLogin: login });
    if (!streamer) {
      return res.status(404).json({ ok: false, error: "Streamer not found" });
    }

    // ✅ Enforce plan limit BEFORE creation (global)
    const limitCheck = await ensureDropLimit({ streamer, kind: "global" });
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

    // Create global drop (your service creates the Drop row)
    const drop = await createGlobalDrop(streamer, percent);

    return res.status(200).json({
      ok: true,
      drop, // { code, id, discountType, discountValue, dropId }
    });
  } catch (err) {
    console.error("❌ Error in POST /api/discounts/:login/global", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

module.exports = router;
