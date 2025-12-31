const express = require("express");
const router = express.Router();
const Stripe = require("stripe");
const Streamer = require("../models/Streamer");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

/**
 * Map plan → Stripe price
 */
function getPriceId(plan) {
  if (plan === "pro") return process.env.STRIPE_PRO_PRICE_ID;
  if (plan === "creator") return process.env.STRIPE_CREATOR_PRICE_ID;
  return null;
}

/**
 * Map Stripe price → internal plan
 * (used for subscription.updated webhooks)
 */
function planFromPriceId(priceId) {
  if (!priceId) return null;
  if (priceId === process.env.STRIPE_PRO_PRICE_ID) return "pro";
  if (priceId === process.env.STRIPE_CREATOR_PRICE_ID) return "creator";
  return null;
}

/* ============================================================
   CREATE CHECKOUT
   ============================================================ */

router.post("/create-checkout", async (req, res) => {
  try {
    const login = String(req.body?.login || "").toLowerCase();
    const plan = String(req.body?.plan || "").toLowerCase();

    const priceId = getPriceId(plan);
    if (!login || !priceId) {
      return res.status(400).json({ ok: false, error: "login + valid plan required" });
    }

    const streamer = await Streamer.findOne({ twitchLogin: login });
    if (!streamer) {
      return res.status(404).json({ ok: false, error: "Streamer not found" });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `https://bot.dropifybot.com/dashboard?login=${encodeURIComponent(login)}&upgrade=success`,
      cancel_url: `https://bot.dropifybot.com/dashboard?login=${encodeURIComponent(login)}&upgrade=cancel`,
      client_reference_id: login,
      metadata: {
        twitchLogin: login,
        targetPlan: plan,
      },
    });

    return res.json({ ok: true, url: session.url });
  } catch (err) {
    console.error("❌ Stripe create-checkout error", err);
    return res.status(500).json({ ok: false, error: "Stripe error" });
  }
});

/* ============================================================
   BILLING PORTAL
   ============================================================ */

router.post("/create-portal", async (req, res) => {
  try {
    const login = String(req.body?.login || "").toLowerCase();
    if (!login) {
      return res.status(400).json({ ok: false, error: "login required" });
    }

    const streamer = await Streamer.findOne({ twitchLogin: login });
    if (!streamer || !streamer.stripeCustomerId) {
      return res.status(404).json({ ok: false, error: "No billing account found" });
    }

    const portal = await stripe.billingPortal.sessions.create({
      customer: streamer.stripeCustomerId,
      return_url: `https://bot.dropifybot.com/dashboard?login=${encodeURIComponent(login)}`,
    });

    return res.json({ ok: true, url: portal.url });
  } catch (err) {
    console.error("❌ Stripe create-portal error", err);
    return res.status(500).json({ ok: false, error: "Stripe portal error" });
  }
});

/* ============================================================
   WEBHOOK
   ============================================================ */

router.post("/webhook", async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    const payload = req.rawBody || req.body;
    event = stripe.webhooks.constructEvent(
      payload,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("❌ Stripe webhook signature error:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    /* --------------------------------------------
       CHECKOUT COMPLETED (initial purchase)
       -------------------------------------------- */
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const login = session?.metadata?.twitchLogin;
      const plan = session?.metadata?.targetPlan;

      if (login && plan) {
        await Streamer.findOneAndUpdate(
          { twitchLogin: login },
          {
            plan,
            stripeCustomerId: session.customer,
            stripeSubscriptionId: session.subscription,
            billingStatus: "active",
          }
        );
        console.log(`✅ Checkout complete → ${login} → ${plan}`);
      }
    }

    /* --------------------------------------------
       SUBSCRIPTION UPDATED (upgrade / downgrade)
       -------------------------------------------- */
    if (event.type === "customer.subscription.updated") {
      const sub = event.data.object;
      const priceId = sub.items?.data?.[0]?.price?.id;
      const plan = planFromPriceId(priceId);

      if (!plan) {
        console.warn("⚠️ Unknown price in subscription.updated", priceId);
      } else {
        await Streamer.findOneAndUpdate(
          { stripeSubscriptionId: sub.id },
          {
            plan,
            billingStatus: sub.status,
          }
        );
        console.log(`🔄 Subscription updated → ${plan} (${sub.status})`);
      }
    }

    /* --------------------------------------------
       SUBSCRIPTION CANCELED
       -------------------------------------------- */
    if (event.type === "customer.subscription.deleted") {
      const sub = event.data.object;

      await Streamer.findOneAndUpdate(
        { stripeSubscriptionId: sub.id },
        {
          plan: "free",
          billingStatus: "canceled",
          stripeSubscriptionId: null,
        }
      );

      console.log("🛑 Subscription canceled → downgraded to free");
    }

    /* --------------------------------------------
       PAYMENT FAILED
       -------------------------------------------- */
    if (event.type === "invoice.payment_failed") {
      const invoice = event.data.object;

      await Streamer.findOneAndUpdate(
        { stripeCustomerId: invoice.customer },
        {
          billingStatus: "past_due",
        }
      );

      console.log("⚠️ Payment failed → marked past_due");
    }

    return res.json({ received: true });
  } catch (err) {
    console.error("❌ Stripe webhook handler error", err);
    return res.status(500).json({ received: true });
  }
});

module.exports = router;
