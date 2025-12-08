// server.js
require("dotenv").config();
const rateLimit = require("express-rate-limit");
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

// Routes
const authRoutes = require("./routes/auth");
const streamerRoutes = require("./routes/streamers");
const discountRoutes = require("./routes/discounts");
const shopifyRoutes = require("./routes/shopify");
const webhookRoutes = require("./routes/webhooks");
const redemptionsRouter = require("./routes/redemptions");
const settingsRouter = require("./routes/settings");
const dropsRouter = require("./routes/drops");
const statsRoutes = require("./routes/stats");

// NEW — import Twitch refresh helper
const { refreshToken } = require("./services/twitchAuth");
const Streamer = require("./models/Streamer");

const app = express();
app.set("trust proxy", 1); // trust first proxy (NGINX)

app.use(cors({
  origin: [
    "https://dropifybot.com",
    "https://www.dropifybot.com",
    "https://bot.dropifybot.com",
    "https://api.dropifybot.com"
  ],
  credentials: true
}));

app.use(express.json());
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120,            // Max 120 requests/min per IP
  message: { ok: false, error: "Too many requests, slow down." }
});

// Simple root route so hitting https://api.dropifybot.com/ doesn't 404
app.get("/", (req, res) => {
  res.send("Dropify API is running. Use the Dropify dashboard to connect Twitch + Shopify.");
});


app.use("/api/", apiLimiter);

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/streamers", streamerRoutes);
app.use("/api/discounts", discountRoutes);
app.use("/api/shopify", shopifyRoutes);
app.use("/webhooks", webhookRoutes);
app.use("/api/redemptions", redemptionsRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/drops", dropsRouter);
app.use("/api/stats", statsRoutes);


// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("Mongo error:", err));

// ⭐️ STEP 8 — Auto-refresh Cron Job
setInterval(async () => {
  const streamers = await Streamer.find({});
  if (!streamers.length) return; // nothing to log

  console.log(`⏳ Checking token status for ${streamers.length} streamer(s)...`);

  for (const s of streamers) {
    if (!s.expiresAt) continue;

    const expiresIn = s.expiresAt - Date.now();

    if (expiresIn < 10 * 60 * 1000) {
      await refreshToken(s);
    }
  }
}, 5 * 60 * 1000);


const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server running http://localhost:${PORT}`);
});
