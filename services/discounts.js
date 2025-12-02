// services/discounts.js
require("dotenv").config();
const axios = require("axios");

/**
 * Helper: Build BASE Shopify Admin URL
 */
function shopifyAdminBase(streamer) {
  const version = streamer.shopifyApiVersion || "2025-01";
  return `https://${streamer.shopifyStoreDomain}/admin/api/${version}`;
}

/**
 * 🔹 1) Create PRICE RULE
 */
async function createPriceRule(streamer, percent, usageLimit = 1) {
  const base = shopifyAdminBase(streamer);

  const body = {
    price_rule: {
      title: `Dropify ${Date.now()}`,
      target_type: "line_item",
      target_selection: "all",
      allocation_method: "across",
      value_type: "percentage",
      value: `-${percent}.0`,
      customer_selection: "all",
      usage_limit: usageLimit,
      once_per_customer: false,
      starts_at: new Date(Date.now() - 1000).toISOString(),
      ends_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    },
  };

  const res = await axios.post(`${base}/price_rules.json`, body, {
    headers: {
      "X-Shopify-Access-Token": streamer.shopifyAdminToken,
      "Content-Type": "application/json",
    },
  });

  return res.data.price_rule;
}

/**
 * 🔹 2) Create DISCOUNT CODE
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
 * 🔥 PERSONAL VIEWER DISCOUNT
 */
async function createViewerDiscount(streamer, viewerName) {
  const random = Math.floor(1000 + Math.random() * 9000);
  const code = `DROP-${viewerName.toUpperCase()}-${random}`;

  const rule = await createPriceRule(streamer, 10, 1);

  const discount = await createDiscountCode(streamer, rule.id, code);

  return { code, id: discount.id };
}

/**
 * 🔥 GLOBAL STREAM DROP
 */
async function createGlobalDrop(streamer, percent) {
  const random = Math.floor(1000 + Math.random() * 9999);
  const code = `${streamer.twitchLogin.toUpperCase()}${percent}-${random}`;

  const rule = await createPriceRule(streamer, percent, null);

  const discount = await createDiscountCode(streamer, rule.id, code);

  return { code, id: discount.id };
}

module.exports = {
  createViewerDiscount,
  createGlobalDrop,
};
