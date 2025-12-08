// /opt/dropify/Discount API/dropify-backend/services/discounts.js
// /opt/dropify/Discount API/dropify-backend/services/discounts.js
require("dotenv").config();
const axios = require("axios");

const Streamer = require("../models/Streamer");
const Drop = require("../models/Drop");

// Approximate "per stream" window (in ms)
// Later you can tie this to real Twitch stream sessions.
const STREAM_WINDOW_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * Helper: Build BASE Shopify Admin URL
 */
function shopifyAdminBase(streamer) {
  const version = streamer.shopifyApiVersion || "2025-01";
  return `https://${streamer.shopifyStoreDomain}/admin/api/${version}`;
}

/**
 * 🔹 Create PRICE RULE (supports percentage + fixed_amount)
 */
async function createPriceRule(streamer, options) {
  const {
    discountType,
    discountValue,
    usageLimit = 1, // null = unlimited
    durationMinutes = 10,
    orderMinSubtotal = 0,
  } = options;

  const base = shopifyAdminBase(streamer);

  const valueType =
    discountType === "fixed_amount" ? "fixed_amount" : "percentage";

  const value =
    valueType === "fixed_amount"
      ? `-${discountValue}` // e.g. -10 = $10 off
      : `-${discountValue}.0`; // e.g. -10.0 = 10% off

  const now = Date.now();

  const priceRuleBody = {
    price_rule: {
      title: `Dropify ${now}`,
      target_type: "line_item",
      target_selection: "all",
      allocation_method: "across",
      value_type: valueType,
      value,
      customer_selection: "all",
      usage_limit: usageLimit === null ? null : usageLimit,
      once_per_customer: false,
      starts_at: new Date(now - 1000).toISOString(),
      ends_at: new Date(now + durationMinutes * 60 * 1000).toISOString(),
    },
  };

  if (orderMinSubtotal && orderMinSubtotal > 0) {
    // Shopify PriceRule prerequisite subtotal
    priceRuleBody.price_rule.prerequisite_subtotal_range = {
      greater_than_or_equal_to: orderMinSubtotal.toString(),
    };
  }

  const res = await axios.post(`${base}/price_rules.json`, priceRuleBody, {
    headers: {
      "X-Shopify-Access-Token": streamer.shopifyAdminToken,
      "Content-Type": "application/json",
    },
  });

  return res.data.price_rule;
}

/**
 * 🔹 Create DISCOUNT CODE
 */
async function createDiscountCode(streamer, priceRuleId, code) {
  const base = shopifyAdminBase(streamer);

  const body = {
    discount_code: { code },
  };

  const res = await axios.post(
    `${base}/price_rules/${priceRuleId}/discount_codes.json`,
    body,
    {
      headers: {
        "X-Shopify-Access-Token": streamer.shopifyAdminToken,
        "Content-Type": "application/json",
      },
    }
  );

  return res.data.discount_code;
}

/**
 * Helper: generate a viewer-friendly code
 */
function generateCode(prefix, viewerLogin) {
  const cleanViewer = (viewerLogin || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  const random = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}${cleanViewer}-${random}`;
}

/**
 * 🔥 SETTINGS-AWARE PERSONAL VIEWER DISCOUNT
 *
 * New signature used by route + bot:
 *   createViewerDiscount(login, { viewerId, viewerLogin, viewerDisplayName })
 */
async function createViewerDiscount(login, viewer) {
  const twitchLogin = (login || "").toLowerCase();

  const streamer = await Streamer.findOne({ twitchLogin });
  if (!streamer) {
    return { ok: false, reason: "not_found" };
  }

  if (
    !streamer.shopifyConnected ||
    !streamer.shopifyStoreDomain ||
    !streamer.shopifyAdminToken
  ) {
    return { ok: false, reason: "not_connected" };
  }

  const settings = streamer.settings || {};
  const enabled = settings.enabled !== false;
  if (!enabled) {
    return { ok: false, reason: "disabled" };
  }

  const discountType = settings.discountType || "percentage";
  const discountValue =
    typeof settings.discountValue === "number" ? settings.discountValue : 10;
  const discountPrefix = (settings.discountPrefix || "DROP-").toUpperCase();

  const maxPerViewerPerStream =
    typeof settings.maxPerViewerPerStream === "number"
      ? settings.maxPerViewerPerStream
      : 1;

  const globalCooldownSeconds =
    typeof settings.globalCooldownSeconds === "number"
      ? settings.globalCooldownSeconds
      : 120;

  const orderMinSubtotal =
    typeof settings.orderMinSubtotal === "number"
      ? settings.orderMinSubtotal
      : 0;

  const now = new Date();
  const cutoffForStream = new Date(now.getTime() - STREAM_WINDOW_MS);
  const cutoffForCooldown = new Date(
    now.getTime() - globalCooldownSeconds * 1000
  );

  // 1) Global cooldown check
  const lastDrop = await Drop.findOne({
    streamerId: streamer._id,
  })
    .sort({ createdAt: -1 })
    .lean();

  if (lastDrop && lastDrop.createdAt > cutoffForCooldown) {
    const diffMs = cutoffForCooldown.getTime() - lastDrop.createdAt.getTime();
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil(Math.abs(diffMs) / 1000)
    );
    return { ok: false, reason: "cooldown", retryAfterSeconds };
  }

  // 2) Per-viewer cap within stream window
  if (maxPerViewerPerStream > 0) {
    const viewerDropCount = await Drop.countDocuments({
      streamerId: streamer._id,
      viewerId: viewer.viewerId,
      createdAt: { $gte: cutoffForStream },
      kind: "viewer",
    });

    if (viewerDropCount >= maxPerViewerPerStream) {
      return {
        ok: false,
        reason: "limit_reached",
        maxPerViewerPerStream,
      };
    }
  }

  // 3) Generate code
  const discountCode = generateCode(discountPrefix, viewer.viewerLogin);

  // 4) Create price rule + discount code in Shopify
  const priceRule = await createPriceRule(streamer, {
    discountType,
    discountValue,
    usageLimit: 1, // one use per code
    durationMinutes: 10, // 10-minute window per code
    orderMinSubtotal,
  });

  const discount = await createDiscountCode(
    streamer,
    priceRule.id,
    discountCode
  );

  // 5) Save Drop record
  const drop = await Drop.create({
    streamerId: streamer._id,
    twitchLogin,
    kind: "viewer",
    viewerId: viewer.viewerId,
    viewerLogin: viewer.viewerLogin,
    viewerDisplayName: viewer.viewerDisplayName,
    discountCode,
    discountType,
    discountValue,
    metadata: {
      priceRuleId: priceRule.id,
      discountId: discount.id,
    },
  });

  return {
    ok: true,
    discountCode,
    discountType,
    discountValue,
    cooldownSeconds: globalCooldownSeconds,
    maxPerViewerPerStream,
    dropId: drop._id,
  };
}

/**
 * 🔥 GLOBAL STREAM DROP
 *
 * Used by POST /api/discounts/:login/global
 */
async function createGlobalDrop(streamer, percent) {
  const twitchLogin = streamer.twitchLogin.toLowerCase();
  const random = Math.floor(1000 + Math.random() * 9999);
  const code = `${streamer.twitchLogin.toUpperCase()}${percent}-${random}`;

  const priceRule = await createPriceRule(streamer, {
    discountType: "percentage",
    discountValue: percent,
    usageLimit: null, // unlimited
    durationMinutes: 60,
    orderMinSubtotal: 0,
  });

  const discount = await createDiscountCode(streamer, priceRule.id, code);

  // Save as a GLOBAL drop entry
  const drop = await Drop.create({
    streamerId: streamer._id,
    twitchLogin,
    kind: "global",
    viewerId: "__global__",
    viewerLogin: twitchLogin,
    viewerDisplayName: streamer.displayName || streamer.twitchLogin,
    discountCode: code,
    discountType: "percentage",
    discountValue: percent,
    metadata: {
      priceRuleId: priceRule.id,
      discountId: discount.id,
      global: true,
    },
  });

  return {
    code,
    id: discount.id,
    discountType: "percentage",
    discountValue: percent,
    dropId: drop._id,
  };
}

module.exports = {
  createViewerDiscount,
  createGlobalDrop,
};
