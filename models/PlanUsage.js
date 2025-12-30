const mongoose = require("mongoose");

const PlanUsageSchema = new mongoose.Schema(
  {
    streamerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Streamer",
      required: true,
      index: true,
    },
    kind: {
      type: String,
      enum: ["viewer", "global"],
      required: true,
      index: true,
    },
    periodKey: {
      type: String, // "YYYY-MM"
      required: true,
      index: true,
    },
    used: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { timestamps: true }
);

// Unique per streamer+kind+month
PlanUsageSchema.index({ streamerId: 1, kind: 1, periodKey: 1 }, { unique: true });

module.exports = mongoose.model("PlanUsage", PlanUsageSchema);
