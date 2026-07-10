const express = require("express");
const Redemption = require("../models/Redemption");
const Streamer = require("../models/Streamer");
const Drop = require("../models/Drop");
const router = express.Router();

/**
 * Shopify "orders/create" webhook.
 *
 * We:
 *  - Parse JSON body
 *  - Check discount_codes
 *  - Find streamer by shop domain
 *  - Save a Redemption record
 *  - 🆕 Update the Drop record with redemption data
 */
router.post(
  "/shopify/orders",
  express.json({ type: "application/json" }),
  async (req, res) => {
    try {
      const shopDomain = req.get("X-Shopify-Shop-Domain") || null;
      const payload = req.body || {};

      console.log("🛒 [SHOPIFY-ORDER] Received webhook:", {
        shop: shopDomain,
        orderId: payload.id,
        orderNumber: payload.order_number || payload.name,
        discountCodes: payload.discount_codes,
      });

      const discountCodes = payload.discount_codes || [];
      if (!discountCodes.length) {
        console.log("🛒 [SHOPIFY-ORDER] No discount codes, skipping");
        return res.status(200).send("No discount codes");
      }

      const code = discountCodes[0];
      const discountCodeStr = code.code;
      const discountAmount = parseFloat(code.amount) || 0;

      console.log(`🛒 [SHOPIFY-ORDER] Code used: ${discountCodeStr}, Amount saved: $${discountAmount}`);

      // Find streamer by shop domain
      const streamer = shopDomain
        ? await Streamer.findOne({ shopifyStoreDomain: shopDomain })
        : null;

      if (!streamer) {
        console.log(`⚠️ [SHOPIFY-ORDER] No streamer found for shop: ${shopDomain}`);
      }

      // Save redemption record (existing logic)
      await Redemption.create({
        streamerId: streamer?._id || null,
        twitchLogin: streamer?.twitchLogin || null,
        shopifyStoreDomain: shopDomain,
        shopifyOrderId: String(payload.id),
        shopifyOrderNumber: payload.order_number || payload.name || null,
        discountCode: discountCodeStr,
        discountAmount: discountAmount,
        discountType: code.type || "unknown",
        customerEmail: payload.email || null,
        customerId: payload.customer?.id ? String(payload.customer.id) : null,
        rawOrder: payload,
      });

      console.log(`✅ [SHOPIFY-ORDER] Redemption record created`);

      // 🆕 Find and update the Drop record
      const drop = await Drop.findOne({ discountCode: discountCodeStr });

      if (drop) {
        await Drop.findByIdAndUpdate(drop._id, {
          redeemed: true,
          redeemedAt: new Date(payload.created_at || Date.now()),
          orderId: String(payload.id),
          orderNumber: payload.order_number || payload.name || null,
          orderTotal: parseFloat(payload.total_price) || 0,
          orderCurrency: payload.currency || "USD",
          customerEmail: payload.email || null,
          discountAmount: discountAmount,
        });

        console.log(`✅ [SHOPIFY-ORDER] Drop ${drop._id} marked as redeemed`);
      } else {
        console.log(`⚠️ [SHOPIFY-ORDER] Code ${discountCodeStr} not found in Dropify drops (might be non-Dropify code)`);
      }

      return res.status(200).send("ok");
    } catch (err) {
      console.error("❌ [SHOPIFY-ORDER] Webhook error:", err);
      return res.status(500).send("error");
    }
  }
);

module.exports = router;
