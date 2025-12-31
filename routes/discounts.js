// /var/www/dropify-backend/routes/discounts.js
const express = require("express");
const router = express.Router();

const Streamer = require("../models/Streamer");
const Drop = require("../models/Drop");

const { createViewerDiscount, createGlobalDrop } = require("../services/discounts");
const { PLAN_LIMITS, getPlanForStreamer, reserveDrop, releaseDrop } = require("../services/planLimits");

function secondsSince(date) {
  return Math.floor((Date.now() - new Date(date).getTime()) / 1000);
}

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
  let slot;

  try {
    streamer = await Streamer.findOne({ twitchLogin: login });
    if (!streamer) return res.status(404).json({ ok: false, reason: "not_found" });

    const plan = getPlanForStreamer(streamer);
    const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;

    // ✅ server-side viewer cooldown (per viewerId)
    const last = await Drop.findOne({
      streamerId: streamer._id,
      kind: "viewer",
      viewerId: String(viewerId),
    }).sort({ createdAt: -1 }).lean();

    const viewerCd = limits.viewerCooldownSeconds ?? 0;
    if (last && viewerCd > 0) {
      const since = secondsSince(last.createdAt);
      if (since < viewerCd) {
        const remaining = viewerCd - since;
        return res.status(429).json({
          ok: false,
          reason: "cooldown",
          retryAfterSeconds: remaining,
          message: `Please wait ${remaining}s before requesting another discount.`,
        });
      }
    }

    // ✅ reserve slot BEFORE doing any expensive work
    slot = await reserveDrop({ streamer, kind: "viewer" });
    if (!slot.ok) {
      return res.status(429).json({
        ok: false,
        reason: "plan_limit",
        message: slot.message,
        plan: slot.plan,
        limit: slot.limit,
        used: slot.used,
      });
    }

    // create discount (this will create Drop row)
    const result = await createViewerDiscount(login, {
      viewerId: String(viewerId),
      viewerLogin: String(viewerLogin).toLowerCase(),
      viewerDisplayName: viewerDisplayName || viewerLogin,
    });

    // If service fails, release reserved slot (using correct periodKey)
    if (!result?.ok) {
      await releaseDrop({ streamer, kind: "viewer", periodKey: slot.periodKey });
      return res.status(200).json(result);
    }

    // success: attach usage + warning (non-breaking for your bot/dashboard)
    return res.status(200).json({
      ...result,
      usage: { kind: "viewer", used: slot.used, limit: slot.limit },
      warning: slot.warning || null,
    });
  } catch (err) {
    console.error("❌ Error in POST /api/discounts/:login", err);

    // release if we reserved a slot
    if (streamer && slot?.ok) {
      try {
        await releaseDrop({ streamer, kind: "viewer", periodKey: slot.periodKey });
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
  let slot;

  try {
    streamer = await Streamer.findOne({ twitchLogin: login });
    if (!streamer) return res.status(404).json({ ok: false, error: "Streamer not found" });

    const plan = getPlanForStreamer(streamer);
    const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;

    // ✅ server-side global cooldown (per streamer)
    // also respect Streamer.settings.globalCooldownSeconds by taking the MAX
    const planGlobalCd = limits.globalCooldownSeconds ?? 0;
    const settingsGlobalCd = streamer?.settings?.globalCooldownSeconds ?? 0;
    const globalCd = Math.max(planGlobalCd, settingsGlobalCd);

    const lastGlobal = await Drop.findOne({
      streamerId: streamer._id,
      kind: "global",
    }).sort({ createdAt: -1 }).lean();

    if (lastGlobal && globalCd > 0) {
      const since = secondsSince(lastGlobal.createdAt);
      if (since < globalCd) {
        const remaining = globalCd - since;
        return res.status(429).json({
          ok: false,
          reason: "cooldown",
          retryAfterSeconds: remaining,
          message: `Global drop cooldown active. Try again in ${remaining}s.`,
        });
      }
    }

    // ✅ reserve slot (global monthly)
    slot = await reserveDrop({ streamer, kind: "global" });
    if (!slot.ok) {
      return res.status(429).json({
        ok: false,
        reason: "plan_limit",
        message: slot.message,
        plan: slot.plan,
        limit: slot.limit,
        used: slot.used,
      });
    }

    // Create global drop (your service creates the Drop row)
    const drop = await createGlobalDrop(streamer, percent);

    if (!drop) {
      await releaseDrop({ streamer, kind: "global", periodKey: slot.periodKey });
      return res.status(500).json({ ok: false, error: "Failed to create global drop" });
    }

    return res.status(200).json({
      ok: true,
      drop,
      usage: { kind: "global", used: slot.used, limit: slot.limit },
      warning: slot.warning || null,
    });
  } catch (err) {
    console.error("❌ Error in POST /api/discounts/:login/global", err);

    if (streamer && slot?.ok) {
      try {
        await releaseDrop({ streamer, kind: "global", periodKey: slot.periodKey });
      } catch (_) {}
    }

    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

module.exports = router;
