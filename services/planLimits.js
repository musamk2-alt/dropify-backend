// /var/www/dropify-backend/services/planLimits.js
const Drop = require("../models/Drop");

/**
 * Monthly plan limits
 *
 * Rules:
 * - 0                = hard limit (allow none)
 * - Infinity         = unlimited
 * - null / undefined = unlimited
 * - Any finite >= 0  = hard limit
 */
const PLAN_LIMITS = {
  free: {
    viewerDropsPerMonth: 0,
    globalDropsPerMonth: 0, // 🚫 no global drops on free
  },
  pro: {
    viewerDropsPerMonth: 500,
    globalDropsPerMonth: 30,
  },
  creator: {
    viewerDropsPerMonth: 3000,
    globalDropsPerMonth: Infinity, // ♾ unlimited (fair use)
  },
};

/**
 * Decide which plan a streamer is on.
 * Default = free
 */
function getPlanForStreamer(streamer) {
  if (!streamer) return "free";

  if (streamer.plan && PLAN_LIMITS[streamer.plan]) {
    return streamer.plan;
  }

  // Optional override for testing (e.g. DROPIFY_DEFAULT_PLAN=pro)
  const override = process.env.DROPIFY_DEFAULT_PLAN;
  if (override && PLAN_LIMITS[override]) return override;

  return "free";
}

/**
 * Helper: start/end of current month in UTC-like JS Date terms
 */
function getCurrentMonthWindow(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { start, end, now };
}

/**
 * Count drops for the streamer in the current month
 * kind: "viewer" | "global" | undefined (all kinds)
 */
async function getMonthlyDropUsage(streamerId, kind) {
  const { start } = getCurrentMonthWindow();

  const query = {
    streamerId,
    createdAt: { $gte: start },
  };

  if (kind) query.kind = kind;

  return Drop.countDocuments(query);
}

/**
 * Normalize limit values into one of:
 * - { type: "unlimited" }
 * - { type: "finite", value: number }  (includes 0)
 */
function normalizeLimit(rawLimit) {
  // null/undefined => unlimited
  if (rawLimit == null) return { type: "unlimited" };

  // Infinity => unlimited
  if (rawLimit === Infinity) return { type: "unlimited" };

  // Non-number => treat as unlimited (defensive)
  if (typeof rawLimit !== "number") return { type: "unlimited" };

  // NaN or non-finite => unlimited
  if (!Number.isFinite(rawLimit)) return { type: "unlimited" };

  // Finite number (0 included) => finite hard limit
  return { type: "finite", value: Math.max(0, Math.floor(rawLimit)) };
}

/**
 * Enforce plan limits BEFORE creating a drop
 *
 * kind: "viewer" | "global"
 *
 * Returns:
 *  - { ok: true, plan, limit, used }
 *  - { ok: false, plan, limit, used, message }
 */
async function ensureDropLimit({ streamer, kind }) {
  const plan = getPlanForStreamer(streamer);
  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;

  const rawLimit =
    kind === "global"
      ? limits.globalDropsPerMonth
      : limits.viewerDropsPerMonth;

  const norm = normalizeLimit(rawLimit);

  const used = await getMonthlyDropUsage(streamer._id, kind);

  // Unlimited => always ok (but still return used for UI)
  if (norm.type === "unlimited") {
    return {
      ok: true,
      plan,
      limit: Infinity,
      used,
    };
  }

  const limit = norm.value; // includes 0

  // Hard limit check (0 blocks immediately because used >= 0)
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

/**
 * DEV-ONLY helper: reset THIS MONTH's drops for a streamer (for testing).
 *
 * Usage example (in a node script / REPL):
 *   await resetMonthlyDropUsage(streamerId, { kind: "viewer" })
 *
 * Safety:
 * - Only works if ALLOW_PLAN_RESET=true
 */
async function resetMonthlyDropUsage(streamerId, { kind } = {}) {
  if (process.env.ALLOW_PLAN_RESET !== "true") {
    return {
      ok: false,
      error:
        "Reset blocked. Set ALLOW_PLAN_RESET=true in env to enable dev resets.",
    };
  }

  const { start, end } = getCurrentMonthWindow();

  const query = {
    streamerId,
    createdAt: { $gte: start, $lt: end },
  };

  if (kind) query.kind = kind;

  const result = await Drop.deleteMany(query);

  return {
    ok: true,
    deleted: result?.deletedCount ?? 0,
    period: {
      monthStart: start.toISOString(),
      monthEnd: end.toISOString(),
    },
  };
}

module.exports = {
  PLAN_LIMITS,
  getPlanForStreamer,
  getMonthlyDropUsage,
  ensureDropLimit,

  // optional helpers (safe to export)
  getCurrentMonthWindow,
  resetMonthlyDropUsage,
};
