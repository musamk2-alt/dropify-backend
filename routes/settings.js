// /opt/dropify/Discount API/dropify-backend/routes/settings.js
const express = require("express");
const router = express.Router();

const Streamer = require("../models/Streamer");

/**
 * Normalize login to lower case.
 */
function normalizeLogin(loginParam) {
  return (loginParam || "").toLowerCase();
}

/**
 * GET /api/settings/:login
 *
 * Returns the settings object for a streamer.
 */
router.get("/:login", async (req, res) => {
  try {
    const login = normalizeLogin(req.params.login);

    const streamer = await Streamer.findOne({
      twitchLogin: login,
    }).lean();

    if (!streamer) {
      return res.status(404).json({ ok: false, error: "Streamer not found" });
    }

    return res.json({
      ok: true,
      login,
      settings: streamer.settings || {},
    });
  } catch (err) {
    console.error("❌ Error in GET /api/settings/:login", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

/**
 * PATCH /api/settings/:login
 *
 * Body: partial or full settings object.
 * Example:
 * {
 *   "discountType": "percentage",
 *   "discountValue": 10,
 *   "discountPrefix": "DROP-",
 *   "maxPerViewerPerStream": 1,
 *   "globalCooldownSeconds": 120,
 *   "orderMinSubtotal": 0,
 *   "autoEnableOnStreamStart": false,
 *   "enabled": true
 * }
 */
router.patch("/:login", async (req, res) => {
  try {
    const login = normalizeLogin(req.params.login);

    const streamer = await Streamer.findOne({
      twitchLogin: login,
    });

    if (!streamer) {
      return res.status(404).json({ ok: false, error: "Streamer not found" });
    }

    const body = req.body || {};
    const s = streamer.settings || {};

    // Simple validation / coercion helpers
    const toNumber = (v, fallback) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : fallback;
    };
    const toBool = (v, fallback) => {
      if (typeof v === "boolean") return v;
      if (v === "true") return true;
      if (v === "false") return false;
      return fallback;
    };

    if (body.discountType !== undefined) {
      if (body.discountType === "percentage" || body.discountType === "fixed_amount") {
        s.discountType = body.discountType;
      }
    }

    if (body.discountValue !== undefined) {
      const n = toNumber(body.discountValue, s.discountValue || 0);
      s.discountValue = Math.max(0, n);
    }

    if (body.discountPrefix !== undefined) {
      s.discountPrefix = String(body.discountPrefix || "").trim() || "DROP-";
    }

    if (body.maxPerViewerPerStream !== undefined) {
      const n = toNumber(body.maxPerViewerPerStream, s.maxPerViewerPerStream || 1);
      s.maxPerViewerPerStream = Math.max(0, Math.floor(n));
    }

    if (body.globalCooldownSeconds !== undefined) {
      const n = toNumber(body.globalCooldownSeconds, s.globalCooldownSeconds || 120);
      s.globalCooldownSeconds = Math.max(0, Math.floor(n));
    }

    if (body.orderMinSubtotal !== undefined) {
      const n = toNumber(body.orderMinSubtotal, s.orderMinSubtotal || 0);
      s.orderMinSubtotal = Math.max(0, n);
    }

    if (body.autoEnableOnStreamStart !== undefined) {
      s.autoEnableOnStreamStart = toBool(
        body.autoEnableOnStreamStart,
        !!s.autoEnableOnStreamStart
      );
    }

    if (body.enabled !== undefined) {
      s.enabled = toBool(body.enabled, s.enabled !== false);
    }

    streamer.settings = s;
    await streamer.save();

    return res.json({
      ok: true,
      login,
      settings: streamer.settings,
    });
  } catch (err) {
    console.error("❌ Error in PATCH /api/settings/:login", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

module.exports = router;
