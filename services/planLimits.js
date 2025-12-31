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
    viewerDropsPerMonth: 10,
    globalDropsPerMonth: 10, // set to 0 if you truly want NONE
  },
  pro: {
    viewerDropsPerMonth: 500,
    globalDropsPerMonth: 30,
  },
  creator: {
    viewerDropsPerMonth: 3000,
    globalDropsPerMonth: Infinity,
  },
};

function getPlanForStreamer(streamer) {
  if (!streamer) return "free";

  if (streamer.plan && PLAN_LIMITS[streamer.plan]) {
    return streamer.plan;
  }

  // Optional override for testing (env)
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
 * Read usage from the counter collection.
 * If missing, fallback to Drop count and seed once.
 */
async function getMonthlyDropUsage(streamerId, kind, date = new Date()) {
  const periodKey = getPeriodKey(date);

  const existing = await PlanUsage.findOne({
    streamerId,
    kind,
    periodKey,
  }).lean();

  if (existing) return existing.used;

  // fallback: count drops for current month and seed counter
  const { start } = getMonthWindow(date);
  const query = { streamerId, kind, createdAt: { $gte: start } };
  const total = await Drop.countDocuments(query);

  try {
    await PlanUsage.create({ streamerId, kind, periodKey, used: total });
  } catch (e) {
    // ignore duplicate key (another request seeded first)
    if (e?.code !== 11000) throw e;
  }

  return total;
}

/**
 * Atomic reserve monthly drop slot.
 * Returns used AFTER increment (used is the new value).
 */
async function reserveMonthlyDrop({ streamer, kind }) {
  const plan = getPlanForStreamer(streamer);
  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;

  const limit =
    kind === "global" ? limits.globalDropsPerMonth : limits.viewerDropsPerMonth;

  // Unlimited (null/undefined/Infinity/non-finite)
  if (limit == null || limit === Infinity || !Number.isFinite(limit)) {
    const used = await getMonthlyDropUsage(streamer._id, kind);
    return { ok: true, plan, limit: Infinity, used };
  }

  // Hard stop (0 = none allowed)
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

  // Step 1: atomic increment if doc exists and used < limit
  let doc = await PlanUsage.findOneAndUpdate(
    { streamerId: streamer._id, kind, periodKey, used: { $lt: limit } },
    { $inc: { used: 1 } },
    { new: true }
  ).lean();

  if (doc) {
    return { ok: true, plan, limit, used: doc.used };
  }

  // Step 2: doc doesn't exist yet -> try create (race-safe)
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
 * (Never below 0.)
 */
async function releaseMonthlyDrop({ streamer, kind }) {
  const periodKey = getPeriodKey(new Date());

  await PlanUsage.updateOne(
    { streamerId: streamer._id, kind, periodKey, used: { $gt: 0 } },
    { $inc: { used: -1 } }
  );
}

/**
 * Backwards-compatible:
 * Previously: ensureDropLimit checked only.
 * Now: it reserves a slot atomically.
 */
async function ensureDropLimit({ streamer, kind }) {
  return reserveMonthlyDrop({ streamer, kind });
}

module.exports = {
  PLAN_LIMITS,
  getPlanForStreamer,
  getPeriodKey,
  getMonthWindow,
  getMonthlyDropUsage,
  ensureDropLimit,
  reserveMonthlyDrop,
  releaseMonthlyDrop,
};
