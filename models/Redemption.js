// /opt/dropify/Discount API/dropify-backend/models/Redemption.js
const mongoose = require("mongoose");

const RedemptionSchema = new mongoose.Schema(
  {
    streamerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Streamer",
      required: true,
      index: true,
    },
    twitchLogin: {
      type: String,
      required: true,
      index: true,
    },
    shopifyStoreDomain: {
      type: String,
      required: true,
    },
    shopifyOrderId: {
      type: String,
      required: true,
    },
    shopifyOrderNumber: {
      type: String,
    },
    discountCode: {
      type: String,
    },
    discountAmount: {
      type: String, // Shopify sends amounts as strings ("10.00")
    },
    discountType: {
      type: String, // e.g. "percentage", "fixed_amount"
    },
    customerEmail: {
      type: String,
    },
    customerId: {
      type: String,
    },
    rawOrder: {
      type: Object,
    },
  },
  {
    timestamps: true, // <-- this is important for "Recent" ordering
  }
);

module.exports = mongoose.model("Redemption", RedemptionSchema);
