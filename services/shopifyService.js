// services/shopifyService.js
require("dotenv").config();
const axios = require("axios");

/**
 * Create a Shopify price rule for a personal viewer discount.
 * Uses the streamer's stored Shopify config.
 */
async function createViewerPriceRule(streamer, percent = 10) {
  const storeDomain =
    streamer.shopifyStoreDomain || process.env.SHOPIFY_STORE_DOMAIN;
  const adminToken =
    streamer.shopifyAdminToken || process.env.SHOPIFY_ADMIN_TOKEN;
  const apiVersion =
    streamer.shopifyApiVersion || process.env.SHOPIFY_API_VERSION || "2025-01";

  if (!storeDomain || !adminToken) {
    throw new Error("Streamer has no Shopify config");
  }

  const BASE_URL = `https://${storeDomain}/admin/api/${apiVersion}`;

  const body = {
    price_rule: {
      title: `Dropify Viewer Rule ${Date.now()}`,
      target_type: "line_item",
      target_selection: "all",
      allocation_method: "across",
      value_type: "percentage",
      value: `-${percent}.0`,

      customer_selection: "all",
      usage_limit: 1, // 1 time total
      once_per_customer: false,

      starts_at: new Date(Date.now() - 1000).toISOString(),
      ends_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10 mins
    },
  };

  const res = await axios.post(`${BASE_URL}/price_rules.json`, body, {
    headers: {
      "X-Shopify-Access-Token": adminToken,
      "Content-Type": "application/json",
    },
  });

  return {
    priceRuleId: res.data.price_rule.id,
    storeDomain,
    adminToken,
    apiVersion,
  };
}

/**
 * Create the actual discount code for a viewer.
 */
async function createViewerDiscountCode({
  priceRuleId,
  storeDomain,
  adminToken,
  apiVersion,
  viewerName,
}) {
  const BASE_URL = `https://${storeDomain}/admin/api/${apiVersion}`;

  const random = Math.floor(1000 + Math.random() * 9000);
  const code = `DROP-${viewerName.toUpperCase()}-${random}`;

  const body = {
    discount_code: { code },
  };

  const res = await axios.post(
    `${BASE_URL}/price_rules/${priceRuleId}/discount_codes.json`,
    body,
    {
      headers: {
        "X-Shopify-Access-Token": adminToken,
        "Content-Type": "application/json",
      },
    }
  );

  return {
    code,
    id: res.data.discount_code.id,
    url: `https://${storeDomain}/discount/${code}`,
  };
}

/**
 * High-level helper: create a viewer discount based on a Streamer doc.
 */
async function createViewerDiscount(streamer, viewerName, percent = 10) {
  const base = await createViewerPriceRule(streamer, percent);
  const discount = await createViewerDiscountCode({
    ...base,
    viewerName,
  });
  return discount;
}

module.exports = {
  createViewerDiscount,
};
