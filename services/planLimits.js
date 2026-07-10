// /var/www/dropify-backend/services/planLimits.js
const Drop = require("../models/Drop");
const PlanUsage = require("../models/PlanUsage");

/**
 * Monthly plan limits
 */
const PLAN_LIMITS = {
  free: {
    viewerDropsPerMonth: 10,
    globalDropsPerMonth: 10,
    viewerCooldownSeconds: 3600,  // 1 hour
    globalCooldownSeconds: 86400, // 24 hours
  },
  pro: {
    viewerDropsPerMonth: 500,
    globalDropsPerMonth: 30,
    viewerCooldownSeconds: 1800,  // 30 min
    globalCooldownSeconds: 3600,  // 1 hour
  },
  creator: {
    viewerDropsPerMonth: 3000,
    globalDropsPerMonth: Infinity,
    viewerCooldownSeconds: 300,   // 5 min
    globalCooldownSeconds: 1800,  // 30 min
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
 * Read usage from the counter collection.
 */
async function getMonthlyDropUsage(streamerId, kind, date = new Date()) {
  const periodKey = getPeriodKey(date);

  const existing = await PlanUsage.findOne({
    streamerId,
    kind,
    periodKey,
  }).lean();

  if (existing) return existing.used;

  const { start } = getMonthWindow(date);
  const query = { streamerId, kind, createdAt: { $gte: start } };
  const total = await Drop.countDocuments(query);

  try {
    await PlanUsage.create({ streamerId, kind, periodKey, used: total });
  } catch (e) {
    if (e?.code !== 11000) throw e;
  }

  return total;
}

/**
 * Atomic reserve monthly drop slot.
 */
async function reserveMonthlyDrop({ streamer, kind }) {
  const plan = getPlanForStreamer(streamer);
  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;

  const limit =
    kind === "global" ? limits.globalDropsPerMonth : limits.viewerDropsPerMonth;

  const periodKey = getPeriodKey(new Date());

  // Unlimited
  if (limit === Infinity || !Number.isFinite(limit)) {
    const doc = await PlanUsage.findOneAndUpdate(
      { streamerId: streamer._id, kind, periodKey },
      { $inc: { used: 1 } },
      { upsert: true, new: true }
    ).lean();
    
    return { ok: true, plan, limit: Infinity, used: doc.used };
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
          ? `You've hit your ${plan} plan limit for global drops this month.`
          : `You've hit your ${plan} plan limit for viewer drops this month.`,
    };
  }

  // Step 1: Try atomic increment with limit check
  let doc = await PlanUsage.findOneAndUpdate(
    { 
      streamerId: streamer._id, 
      kind, 
      periodKey, 
      used: { $lt: limit }
    },
    { $inc: { used: 1 } },
    { new: true }
  ).lean();

  if (doc) {
    // Success - check for 80% warning
    const warningThreshold = Math.floor(limit * 0.8);
    const warning = doc.used >= warningThreshold ? {
      message: `⚠️ You've used ${doc.used}/${limit} ${kind} drops (${Math.round(doc.used/limit*100)}%)`,
      threshold: warningThreshold,
      percentage: Math.round(doc.used/limit*100)
    } : null;

    return { ok: true, plan, limit, used: doc.used, warning };
  }

  // Step 2: Document doesn't exist - try to create with used: 1
  try {
    const created = await PlanUsage.create({
      streamerId: streamer._id,
      kind,
      periodKey,
      used: 1,
    });

    return { ok: true, plan, limit, used: created.used };
  } catch (e) {
    // Duplicate key - retry
    if (e?.code === 11000) {
      doc = await PlanUsage.findOneAndUpdate(
        { 
          streamerId: streamer._id, 
          kind, 
          periodKey, 
          used: { $lt: limit } 
        },
        { $inc: { used: 1 } },
        { new: true }
      ).lean();

      if (doc) {
        const warningThreshold = Math.floor(limit * 0.8);
        const warning = doc.used >= warningThreshold ? {
          message: `⚠️ You've used ${doc.used}/${limit} ${kind} drops`,
          threshold: warningThreshold
        } : null;

        return { ok: true, plan, limit, used: doc.used, warning };
      }

      const used = await getMonthlyDropUsage(streamer._id, kind);
      return {
        ok: false,
        plan,
        limit,
        used,
        message:
          kind === "global"
            ? `You've hit your ${plan} plan limit for global drops this month.`
            : `You've hit your ${plan} plan limit for viewer drops this month.`,
      };
    }

    throw e;
  }
}

/**
 * Release a reserved slot if drop creation fails.
 */
async function releaseMonthlyDrop({ streamer, kind }) {
  const periodKey = getPeriodKey(new Date());

  await PlanUsage.updateOne(
    { streamerId: streamer._id, kind, periodKey, used: { $gt: 0 } },
    { $inc: { used: -1 } }
  );
}

/**
 * Backwards-compatible alias
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
