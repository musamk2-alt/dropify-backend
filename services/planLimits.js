// /var/www/dropify-backend/services/planLimits.js
const Drop = require("../models/Drop");

// You can tweak these numbers later.
// Right now this matches the marketing site.
const PLAN_LIMITS = {
  free: {
    viewerDropsPerMonth: 1,
    globalDropsPerMonth: 0,
  },
  pro: {
    viewerDropsPerMonth: 500,
    globalDropsPerMonth: 30,
  },
  creator: {
    viewerDropsPerMonth: 3000,
    globalDropsPerMonth: Infinity, // "fair use" – no hard cap
  },
};

/**
 * Decide which plan a streamer is on.
 * For now: everything is "free".
 * Later you can store streamer.plan or use Stripe metadata.
 */
function getPlanForStreamer(streamer) {
  if (!streamer) return "free";

  // If you later add a "plan" field on the Streamer model, this line just works.
  if (streamer.plan && PLAN_LIMITS[streamer.plan]) {
    return streamer.plan;
  }

  // Optional override by env:
  // e.g. DROPIFY_DEFAULT_PLAN=pro for your own account
  if (process.env.DROPIFY_DEFAULT_PLAN && PLAN_LIMITS[process.env.DROPIFY_DEFAULT_PLAN]) {
    return process.env.DROPIFY_DEFAULT_PLAN;
  }

  return "free";
}

/**
 * Count drops for this streamer in the current month.
 * kind can be "viewer" or "global" or undefined for all.
 */
async function getMonthlyDropUsage(streamerId, kind) {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const query = {
    streamerId,
    createdAt: { $gte: startOfMonth },
  };

  if (kind) {
    query.kind = kind;
  }

  const total = await Drop.countDocuments(query);
  return total;
}

/**
 * Ensure the streamer hasn't hit their plan limit
 * before creating a new drop.
 *
 * kind: "viewer" | "global"
 *
 * Returns:
 *  - { ok: true, plan, limit, used }  if allowed
 *  - { ok: false, plan, limit, used, message } if blocked
 */
async function ensureDropLimit({ streamer, kind }) {
  const plan = getPlanForStreamer(streamer);
  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;

  const limit =
    kind === "global"
      ? limits.globalDropsPerMonth
      : limits.viewerDropsPerMonth;

  // creator global drops Infinity => no limit
  if (!limit || !Number.isFinite(limit)) {
    return { ok: true, plan, limit: Infinity, used: 0 };
  }

  const used = await getMonthlyDropUsage(streamer._id, kind);

  if (used >= limit) {
    const message =
      kind === "global"
        ? `You’ve hit your ${plan} plan limit for global drops this month.`
        : `You’ve hit your ${plan} plan limit for viewer drops this month.`;

    return {
      ok: false,
      plan,
      limit,
      used,
      message,
    };
  }

  return {
    ok: true,
    plan,
    limit,
    used,
  };
}

module.exports = {
  PLAN_LIMITS,
  getPlanForStreamer,
  getMonthlyDropUsage,
  ensureDropLimit,
};
