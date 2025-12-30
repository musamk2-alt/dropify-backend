// /var/www/dropify-backend/services/planLimits.js
const Drop = require("../models/Drop");
const PlanUsage = require("../models/PlanUsage");

/**
 * Monthly plan limits
 * NOTE:
 * - 0 = hard limit (allow none)
 * - Infinity = unlimited
 * - null/undefined = unlimited
 */
const PLAN_LIMITS = {
  free: {
    viewerDropsPerMonth: 1,
    globalDropsPerMonth: 1, // 🚫 none on free
  },
  pro: {
    viewerDropsPerMonth: 500,
    globalDropsPerMonth: 30,
  },
  creator: {
    viewerDropsPerMonth: 3000,
    globalDropsPerMonth: Infinity, // ♾ unlimited
  },
};

function getPlanForStreamer(streamer) {
  if (!streamer) return "free";

  if (streamer.plan && PLAN_LIMITS[streamer.plan]) {
    return streamer.plan;
  }

  if (
    process.env.DROPIFY_DEFAULT_PLAN &&
    PLAN_LIMITS[process.env.DROPIFY_DEFAULT_PLAN]
  ) {
    return process.env.DROPIFY_DEFAULT_PLAN;
  }

  return "free";
}

function getPeriodKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function getMonthWindow(date = new Date()) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 1);
  return { start, end };
}

/**
 * Read usage from the counter collection (fast + consistent).
 * If missing (first run), we can fallback to counting drops and seed the counter.
 */
async function getMonthlyDropUsage(streamerId, kind, date = new Date()) {
  const periodKey = getPeriodKey(date);

  const existing = await PlanUsage.findOne({ streamerId, kind, periodKey }).lean();
  if (existing) return existing.used;

  // Fallback for older data: count Drops and seed counter once
  const { start } = getMonthWindow(date);
  const query = { streamerId, kind, createdAt: { $gte: start } };
  const total = await Drop.countDocuments(query);

  try {
    await PlanUsage.create({ streamerId, kind, periodKey, used: total });
  } catch (e) {
    // If two requests seed at once, ignore duplicate key and continue
    if (e?.code !== 11000) throw e;
  }

  return total;
}

/**
 * Atomic "reserve" a monthly slot:
 * - If limit is reached, returns ok:false
 * - If allowed, increments usage safely even under concurrency.
 *
 * Returns:
 *  - { ok:true, plan, limit, used }   used = AFTER increment
 *  - { ok:false, plan, limit, used, message }
 */
async function reserveMonthlyDrop({ streamer, kind }) {
  const plan = getPlanForStreamer(streamer);
  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;

  const limit =
    kind === "global"
      ? limits.globalDropsPerMonth
      : limits.viewerDropsPerMonth;

  // Unlimited cases
  if (limit == null || limit === Infinity || !Number.isFinite(limit)) {
    const used = await getMonthlyDropUsage(streamer._id, kind);
    return { ok: true, plan, limit: Infinity, used };
  }

  // Hard stop (0 means none allowed)
  if (limit === 0) {
    const used = await getMonthlyDropUsage(streamer._id, kind);
    return {
      ok: false,
      plan,
      limit,
      used,
      message:
        kind === "global"
          ? `You’ve hit your ${plan} plan limit for global drops this month.`
          : `You’ve hit your ${plan} plan limit for viewer drops this month.`,
    };
  }

  const periodKey = getPeriodKey(new Date());

  // Step 1: try atomic increment on existing counter where used < limit
  let doc = await PlanUsage.findOneAndUpdate(
    { streamerId: streamer._id, kind, periodKey, used: { $lt: limit } },
    { $inc: { used: 1 } },
    { new: true }
  ).lean();

  if (doc) {
    return { ok: true, plan, limit, used: doc.used };
  }

  // Step 2: if counter doesn't exist yet, race-safe create {used:1}
  try {
    const created = await PlanUsage.create({
      streamerId: streamer._id,
      kind,
      periodKey,
      used: 1,
    });
    return { ok: true, plan, limit, used: created.used };
  } catch (e) {
    // Another request created it first; retry atomic increment once
    if (e?.code === 11000) {
      doc = await PlanUsage.findOneAndUpdate(
        { streamerId: streamer._id, kind, periodKey, used: { $lt: limit } },
        { $inc: { used: 1 } },
        { new: true }
      ).lean();

      if (doc) return { ok: true, plan, limit, used: doc.used };

      const used = await getMonthlyDropUsage(streamer._id, kind);
      return {
        ok: false,
        plan,
        limit,
        used,
        message:
          kind === "global"
            ? `You’ve hit your ${plan} plan limit for global drops this month.`
            : `You’ve hit your ${plan} plan limit for viewer drops this month.`,
      };
    }

    throw e;
  }
}

/**
 * If drop creation fails AFTER reserving, release the slot.
 * (Never let it go below 0.)
 */
async function releaseMonthlyDrop({ streamer, kind }) {
  const periodKey = getPeriodKey(new Date());
  await PlanUsage.updateOne(
    { streamerId: streamer._id, kind, periodKey, used: { $gt: 0 } },
    { $inc: { used: -1 } }
  );
}

/**
 * Backwards compatible name:
 * Previously: ensureDropLimit checked only.
 * Now: it RESERVES a slot atomically.
 */
async function ensureDropLimit({ streamer, kind }) {
  return reserveMonthlyDrop({ streamer, kind });
}

module.exports = {
  PLAN_LIMITS,
  getPlanForStreamer,
  getMonthlyDropUsage,
  ensureDropLimit,
  reserveMonthlyDrop,
  releaseMonthlyDrop,
  getPeriodKey,
  getMonthWindow,
};
