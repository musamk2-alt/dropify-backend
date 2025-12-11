// /var/www/dropify-backend/scripts/send-test-order-webhook.js
require("dotenv").config();
const crypto = require("crypto");
const axios = require("axios");

// 🔧 CHANGE THIS to your actual dev store domain
const SHOP_DOMAIN =
  "test-store-1100000000000000000000000000000002337.myshopify.com";

// 🔧 CHANGE THIS to a real Dropify discount code you generated via !discount or !drop
const TEST_DISCOUNT_CODE = "XQCISNEWDROPIFYBOT-2997";

// This secret MUST match what your webhook verifier uses.
// Usually this is the app "Secret" from the Shopify app settings.
const WEBHOOK_SECRET =
  process.env.SHOPIFY_CLIENT_SECRET || process.env.SHOPIFY_API_SECRET;

if (!WEBHOOK_SECRET) {
  console.error("❌ No SHOPIFY_CLIENT_SECRET / SHOPIFY_API_SECRET in .env");
  process.exit(1);
}

// Minimal fake orders/create payload
const payload = {
  id: 999999999999,
  name: "#1001",
  email: "test+dropify@example.com",
  customer: {
    id: 1234567890,
    email: "test+dropify@example.com",
  },
  // This is what your webhook handler reads: payload.discount_codes[0]
  discount_codes: [
    {
      code: TEST_DISCOUNT_CODE,
      amount: "10.00",
      type: "percentage",
    },
  ],
};

const body = JSON.stringify(payload);

// Compute HMAC like Shopify does
const hmac = crypto
  .createHmac("sha256", WEBHOOK_SECRET)
  .update(body, "utf8")
  .digest("base64");

(async () => {
  try {
    console.log("▶ Sending test orders/create webhook to local backend...");
    const res = await axios.post(
      "http://localhost:4000/webhooks/shopify/orders",
      body,
      {
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Topic": "orders/create",
          "X-Shopify-Shop-Domain": SHOP_DOMAIN,
          "X-Shopify-Hmac-Sha256": hmac,
          "X-Shopify-Api-Version": "2025-01",
        },
      }
    );

    console.log("✅ Webhook accepted by backend");
    console.log("Status:", res.status);
    console.log("Response:", res.data);
  } catch (err) {
    console.error("❌ Webhook call failed");
    if (err.response) {
      console.error("Status:", err.response.status);
      console.error("Body:", err.response.data);
    } else {
      console.error(err.message);
    }
  }
})();
