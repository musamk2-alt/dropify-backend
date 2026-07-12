// /var/www/dropify-backend/routes/discounts.js
const express = require("express");
const router = express.Router();

const Streamer = require("../models/Streamer");
const Drop = require("../models/Drop");

const {
  createViewerDiscount,
  createGlobalDrop,
} = require("../services/discounts");

const {
  createOrRefreshPendingClaim,
} = require("../services/claims");

// ✅ FIX: use the actual atomic plan counter functions
const {
  PLAN_LIMITS,
  getPlanForStreamer,
  reserveMonthlyDrop,
  releaseMonthlyDrop,
} = require("../services/planLimits");

function secondsSince(date) {
  return Math.floor((Date.now() - new Date(date).getTime()) / 1000);
}

// ==========================================
// 🔒 REQUEST DEDUPLICATION (RACE CONDITION FIX)
// ==========================================
const activeRequests = new Map();

function createRequestKey(login, viewerId) {
  return `${login}:${viewerId}`;
}

async function withDeduplication(key, handler) {
  if (activeRequests.has(key)) {
    const startTime = activeRequests.get(key);
    const waitTime = Date.now() - startTime;

    console.log(
      `🔒 [DEDUPE] Blocked duplicate request: ${key} (gap: ${waitTime}ms)`
    );

    throw new Error("DUPLICATE_REQUEST");
  }

  activeRequests.set(key, Date.now());
  console.log(`✅ [DEDUPE] Processing: ${key}`);

  try {
    return await handler();
  } finally {
    setTimeout(() => {
      activeRequests.delete(key);
      console.log(`🧹 [DEDUPE] Cleaned up: ${key}`);
    }, 3000);
  }
}

/**
 * POST /api/discounts/:login/claim-request
 *
 * Creates or refreshes a pending private claim.
 *
 * Body:
 * {
 *   viewerId,
 *   viewerLogin,
 *   viewerDisplayName
 * }
 *
 * This does NOT create a Shopify discount yet.
 */
router.post("/:login/claim-request", async (req, res) => {
  const routeId = Math.random().toString(36).slice(2, 9);

  const login = (req.params.login || "").toLowerCase();
  const { viewerId, viewerLogin, viewerDisplayName } = req.body || {};

  console.log(
    `🔐 [CLAIM-${routeId}] POST /api/discounts/${login}/claim-request`
  );

  console.log(
    `🔐 [CLAIM-${routeId}] Body:`,
    JSON.stringify(req.body)
  );

  if (!login) {
    return res.status(400).json({
      ok: false,
      error: "login is required",
    });
  }

  if (!viewerId || !viewerLogin) {
    return res.status(400).json({
      ok: false,
      error: "viewerId and viewerLogin are required",
    });
  }

  const requestKey = createRequestKey(
    `${login}:claim`,
    String(viewerId)
  );

  try {
    return await withDeduplication(requestKey, async () => {
      try {
        const streamer = await Streamer.findOne({
          twitchLogin: login,
        });

        if (!streamer) {
          console.log(
            `🔐 [CLAIM-${routeId}] Streamer not found: ${login}`
          );

          return res.status(404).json({
            ok: false,
            reason: "not_found",
          });
        }

        if (!streamer.settings?.enabled) {
          console.log(
            `🔐 [CLAIM-${routeId}] Discounts disabled for ${login}`
          );

          return res.status(200).json({
            ok: false,
            reason: "disabled",
          });
        }

        if (
          !streamer.shopifyConnected ||
          !streamer.shopifyStoreDomain ||
          !streamer.shopifyAdminToken
        ) {
          console.log(
            `🔐 [CLAIM-${routeId}] Shopify not connected for ${login}`
          );

          return res.status(200).json({
            ok: false,
            reason: "not_connected",
          });
        }

        const result = await createOrRefreshPendingClaim({
          streamerId: streamer._id,
          twitchChannelId: streamer.twitchId,
          viewerTwitchId: String(viewerId),
          viewerLogin: String(viewerLogin).toLowerCase(),
          viewerDisplayName: viewerDisplayName || viewerLogin,
        });

        console.log(
          `🔐 [CLAIM-${routeId}] Pending claim ready for ${viewerLogin}`
        );

        return res.status(200).json({
          ok: true,
          delivery: "claim_page",
          claimUrl: "https://dropifybot.com/claim",
          created: result.created,
          expiresAt: result.claim.expiresAt,
        });
      } catch (err) {
        console.error(
          `❌ [CLAIM-${routeId}] Failed to create pending claim`,
          err
        );

        return res.status(500).json({
          ok: false,
          error: "Internal server error",
        });
      }
    });
  } catch (err) {
    if (err.message === "DUPLICATE_REQUEST") {
      console.log(
        `⚠️ [CLAIM-${routeId}] Duplicate claim request blocked`
      );

      return res.status(429).json({
        ok: false,
        reason: "duplicate",
        message: "Request already processing, please wait",
      });
    }

    console.error(
      `❌ [CLAIM-${routeId}] Unexpected claim route error`,
      err
    );

    return res.status(500).json({
      ok: false,
      error: "Internal server error",
    });
  }
});

/**
 * POST /api/discounts/:login
 * Viewer personal discount (kind: "viewer")
 * Body: { viewerId, viewerLogin, viewerDisplayName }
 */
router.post("/:login", async (req, res) => {
  const routeId = Math.random().toString(36).slice(2, 9);
  const timestamp = new Date().toISOString();

  console.log(
    `🌐 [ROUTE-${routeId}] ${timestamp} POST /api/discounts/${req.params.login}`
  );

  console.log(
    `🌐 [ROUTE-${routeId}] Body:`,
    JSON.stringify(req.body)
  );

  const login = (req.params.login || "").toLowerCase();
  const { viewerId, viewerLogin, viewerDisplayName } = req.body || {};

  if (!login) {
    console.log(`🌐 [ROUTE-${routeId}] ERROR: login missing`);

    return res.status(400).json({
      ok: false,
      error: "login is required",
    });
  }

  if (!viewerId || !viewerLogin) {
    console.log(
      `🌐 [ROUTE-${routeId}] ERROR: viewerId or viewerLogin missing`
    );

    return res.status(400).json({
      ok: false,
      error: "viewerId and viewerLogin are required",
    });
  }

  const requestKey = createRequestKey(login, viewerId);

  try {
    return await withDeduplication(requestKey, async () => {
      let streamer;
      let slot;

      try {
        console.log(
          `🌐 [ROUTE-${routeId}] Finding streamer: ${login}`
        );

        streamer = await Streamer.findOne({
          twitchLogin: login,
        });

        if (!streamer) {
          console.log(
            `🌐 [ROUTE-${routeId}] ERROR: Streamer not found`
          );

          return res.status(404).json({
            ok: false,
            reason: "not_found",
          });
        }

        console.log(
          `🌐 [ROUTE-${routeId}] Streamer found: ${streamer._id}`
        );

        const plan = getPlanForStreamer(streamer);
        const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;

        console.log(
          `🌐 [ROUTE-${routeId}] Checking cooldown...`
        );

        const last = await Drop.findOne({
          streamerId: streamer._id,
          kind: "viewer",
          viewerId: String(viewerId),
        })
          .sort({ createdAt: -1 })
          .lean();

        const viewerCd = limits.viewerCooldownSeconds ?? 0;

        if (last && viewerCd > 0) {
          const since = secondsSince(last.createdAt);

          if (since < viewerCd) {
            const remaining = viewerCd - since;

            console.log(
              `🌐 [ROUTE-${routeId}] COOLDOWN: ${remaining}s remaining`
            );

            return res.status(429).json({
              ok: false,
              reason: "cooldown",
              retryAfterSeconds: remaining,
              message: `Please wait ${remaining}s before requesting another discount.`,
            });
          }
        }

        console.log(
          `🌐 [ROUTE-${routeId}] Cooldown check passed`
        );

        console.log(
          `🌐 [ROUTE-${routeId}] Calling reserveMonthlyDrop...`
        );

        slot = await reserveMonthlyDrop({
          streamer,
          kind: "viewer",
        });

        console.log(
          `🌐 [ROUTE-${routeId}] reserveMonthlyDrop result:`,
          {
            ok: slot.ok,
            used: slot.used,
            limit: slot.limit,
          }
        );

        if (!slot.ok) {
          console.log(
            `🌐 [ROUTE-${routeId}] Plan limit reached`
          );

          return res.status(429).json({
            ok: false,
            reason: "plan_limit",
            message: slot.message,
            plan: slot.plan,
            limit: slot.limit,
            used: slot.used,
          });
        }

        console.log(
          `🌐 [ROUTE-${routeId}] Calling createViewerDiscount...`
        );

        const result = await createViewerDiscount(login, {
          viewerId: String(viewerId),
          viewerLogin: String(viewerLogin).toLowerCase(),
          viewerDisplayName: viewerDisplayName || viewerLogin,
        });

        console.log(
          `🌐 [ROUTE-${routeId}] createViewerDiscount result:`,
          {
            ok: result?.ok,
          }
        );

        if (!result?.ok) {
          console.log(
            `🌐 [ROUTE-${routeId}] createViewerDiscount failed, releasing slot`
          );

          await releaseMonthlyDrop({
            streamer,
            kind: "viewer",
          });

          return res.status(200).json(result);
        }

        console.log(
          `🌐 [ROUTE-${routeId}] SUCCESS - Discount created`
        );

        return res.status(200).json({
          ...result,
          usage: {
            kind: "viewer",
            used: slot.used,
            limit: slot.limit,
          },
          warning: slot.warning || null,
        });
      } catch (err) {
        console.error(
          `❌ [ROUTE-${routeId}] Error in POST /api/discounts/:login`,
          err
        );

        if (streamer && slot?.ok) {
          try {
            console.log(
              `🌐 [ROUTE-${routeId}] Exception caught, releasing slot`
            );

            await releaseMonthlyDrop({
              streamer,
              kind: "viewer",
            });
          } catch (_) {
            // Ignore release errors.
          }
        }

        return res.status(500).json({
          ok: false,
          error: "Internal server error",
        });
      }
    });
  } catch (err) {
    if (err.message === "DUPLICATE_REQUEST") {
      console.log(
        `⚠️ [ROUTE-${routeId}] Duplicate request blocked for ${requestKey}`
      );

      return res.status(429).json({
        ok: false,
        reason: "duplicate",
        message: "Request already processing, please wait",
      });
    }

    console.error(
      `❌ [ROUTE-${routeId}] Unexpected route error`,
      err
    );

    return res.status(500).json({
      ok: false,
      error: "Internal server error",
    });
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
    return res.status(400).json({
      ok: false,
      error: "login is required",
    });
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
    streamer = await Streamer.findOne({
      twitchLogin: login,
    });

    if (!streamer) {
      return res.status(404).json({
        ok: false,
        error: "Streamer not found",
      });
    }

    const plan = getPlanForStreamer(streamer);
    const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;

    const planGlobalCd =
      limits.globalCooldownSeconds ?? 0;

    const settingsGlobalCd =
      streamer?.settings?.globalCooldownSeconds ?? 0;

    const globalCd = Math.max(
      planGlobalCd,
      settingsGlobalCd
    );

    const lastGlobal = await Drop.findOne({
      streamerId: streamer._id,
      kind: "global",
    })
      .sort({ createdAt: -1 })
      .lean();

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

    slot = await reserveMonthlyDrop({
      streamer,
      kind: "global",
    });

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

    const drop = await createGlobalDrop(
      streamer,
      percent
    );

    if (!drop) {
      await releaseMonthlyDrop({
        streamer,
        kind: "global",
      });

      return res.status(500).json({
        ok: false,
        error: "Failed to create global drop",
      });
    }

    return res.status(200).json({
      ok: true,
      drop,
      usage: {
        kind: "global",
        used: slot.used,
        limit: slot.limit,
      },
      warning: slot.warning || null,
    });
  } catch (err) {
    console.error(
      "❌ Error in POST /api/discounts/:login/global",
      err
    );

    if (streamer && slot?.ok) {
      try {
        await releaseMonthlyDrop({
          streamer,
          kind: "global",
        });
      } catch (_) {
        // Ignore release errors.
      }
    }

    return res.status(500).json({
      ok: false,
      error: "Internal server error",
    });
  }
});

module.exports = router;
