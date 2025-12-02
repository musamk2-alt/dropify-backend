const express = require("express");
const Redemption = require("../models/Redemption");
const Streamer = require("../models/Streamer");

const router = express.Router();

/**
 * Shopify "orders/create" webhook.
 *
 * For now we:
 *  - let Express parse JSON (no HMAC yet)
 *  - check discount_codes
 *  - find streamer by shop domain
 *  - save a Redemption record
 */
router.post(
  "/shopify/orders",
  // Let Express parse JSON body for us
  express.json({ type: "application/json" }),
  async (req, res) => {
    try {
      const shopDomain = req.get("X-Shopify-Shop-Domain") || null;

      // Body is already parsed JSON here
      const payload = req.body || {};

      console.log("🛒 Received Shopify order webhook:", {
        bodyType: typeof req.body,
        id: payload.id,
        order_number: payload.order_number || payload.name,
        discount_codes: payload.discount_codes,
      });

      const discountCodes = payload.discount_codes || [];
      if (!discountCodes.length) {
        return res.status(200).send("No discount codes, skipping");
      }

      const code = discountCodes[0];

      const streamer = shopDomain
        ? await Streamer.findOne({ shopifyStoreDomain: shopDomain })
        : null;

      await Redemption.create({
        streamerId: streamer?._id || null,
        twitchLogin: streamer?.twitchLogin || null,

        shopifyStoreDomain: shopDomain,
        shopifyOrderId: String(payload.id),
        shopifyOrderNumber: payload.order_number || payload.name || null,

        discountCode: code.code,
        discountAmount: Number(code.amount) || 0,
        discountType: code.type || "unknown",

        customerEmail: payload.email || null,
        customerId: payload.customer?.id ? String(payload.customer.id) : null,

        rawOrder: payload,
      });

      return res.status(200).send("ok");
    } catch (err) {
      console.error("Shopify order webhook error:", err);
      return res.status(500).send("error");
    }
  }
);

module.exports = router;
