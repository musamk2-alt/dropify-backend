// /var/www/dropify-backend/routes/viewerAuth.js
require("dotenv").config();

const express = require("express");
const axios = require("axios");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const router = express.Router();

const TWITCH_CLIENT_ID =
  process.env.TWITCH_VIEWER_CLIENT_ID;

const TWITCH_CLIENT_SECRET =
  process.env.TWITCH_VIEWER_CLIENT_SECRET;

const TWITCH_VIEWER_REDIRECT_URI =
  process.env.TWITCH_VIEWER_REDIRECT_URI;

const VIEWER_SESSION_SECRET =
  process.env.VIEWER_SESSION_SECRET;

const FRONTEND_URL =
  process.env.FRONTEND_URL ||
  "https://dropifybot.com";

const TWITCH_AUTH_URL =
  "https://id.twitch.tv/oauth2/authorize";

const TWITCH_TOKEN_URL =
  "https://id.twitch.tv/oauth2/token";

const TWITCH_USERS_URL =
  "https://api.twitch.tv/helix/users";

const STATE_COOKIE =
  "dropify_viewer_oauth_state";

const SESSION_COOKIE =
  "dropify_viewer_session";

const IS_PRODUCTION =
  process.env.NODE_ENV === "production";

const STATE_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: IS_PRODUCTION,
  sameSite: "lax",
  path: "/api/auth/viewer",
  maxAge: 10 * 60 * 1000,
};

const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: IS_PRODUCTION,
  sameSite: "lax",
  path: "/",
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

function getMissingConfiguration() {
  const required = {
    TWITCH_CLIENT_ID,
    TWITCH_CLIENT_SECRET,
    TWITCH_VIEWER_REDIRECT_URI,
    VIEWER_SESSION_SECRET,
  };

  return Object.entries(required)
    .filter(([, value]) => !value)
    .map(([name]) => name);
}

function safeEqual(firstValue, secondValue) {
  if (!firstValue || !secondValue) {
    return false;
  }

  const firstBuffer = Buffer.from(
    String(firstValue)
  );

  const secondBuffer = Buffer.from(
    String(secondValue)
  );

  if (
    firstBuffer.length !==
    secondBuffer.length
  ) {
    return false;
  }

  return crypto.timingSafeEqual(
    firstBuffer,
    secondBuffer
  );
}

function createViewerSession(user) {
  return jwt.sign(
    {
      login: user.login,
      displayName: user.display_name,
      profileImageUrl:
        user.profile_image_url || null,
    },
    VIEWER_SESSION_SECRET,
    {
      algorithm: "HS256",
      subject: String(user.id),
      issuer: "dropifybot",
      audience: "dropify-viewer",
      expiresIn: "7d",
    }
  );
}

function clearStateCookie(res) {
  res.clearCookie(
    STATE_COOKIE,
    {
      httpOnly: true,
      secure: IS_PRODUCTION,
      sameSite: "lax",
      path: "/api/auth/viewer",
    }
  );
}

function clearSessionCookie(res) {
  res.clearCookie(
    SESSION_COOKIE,
    {
      httpOnly: true,
      secure: IS_PRODUCTION,
      sameSite: "lax",
      path: "/",
    }
  );
}

/**
 * GET /api/auth/viewer/twitch/login
 *
 * Starts private viewer authentication.
 */
router.get(
  "/twitch/login",
  (req, res) => {
    const missing =
      getMissingConfiguration();

    if (missing.length) {
      console.error(
        "[VIEWER AUTH] Missing configuration:",
        missing
      );

      return res.status(500).json({
        ok: false,
        error:
          "Viewer authentication is not configured.",
      });
    }

    const state = crypto
      .randomBytes(32)
      .toString("hex");

    res.cookie(
      STATE_COOKIE,
      state,
      STATE_COOKIE_OPTIONS
    );

    const params =
      new URLSearchParams({
        client_id:
          TWITCH_CLIENT_ID,

        redirect_uri:
          TWITCH_VIEWER_REDIRECT_URI,

        response_type: "code",

        // Identity only.
        scope: "openid",

	force_verify: "true",

        state,
      });

    const redirectUrl =
      `${TWITCH_AUTH_URL}?${params.toString()}`;

    return res.redirect(
      redirectUrl
    );
  }
);

/**
 * GET /api/auth/viewer/twitch/callback
 *
 * Receives the Twitch authorization code,
 * verifies the OAuth state and signs the viewer
 * into DropifyBot.
 */
router.get(
  "/twitch/callback",
  async (req, res) => {
    const {
      code,
      state,
      error,
    } = req.query;

    const savedState =
      req.cookies?.[STATE_COOKIE];

    if (error) {
      clearStateCookie(res);

      console.warn(
        "[VIEWER AUTH] Twitch authorization denied:",
        String(error)
      );

      return res.redirect(
        `${FRONTEND_URL}/claim?auth=denied`
      );
    }

    if (
      !code ||
      !state ||
      !savedState
    ) {
      clearStateCookie(res);

      return res.redirect(
        `${FRONTEND_URL}/claim?auth=invalid_state`
      );
    }

    if (
      !safeEqual(
        state,
        savedState
      )
    ) {
      clearStateCookie(res);

      console.warn(
        "[VIEWER AUTH] OAuth state mismatch"
      );

      return res.redirect(
        `${FRONTEND_URL}/claim?auth=invalid_state`
      );
    }

    clearStateCookie(res);

    try {
      const tokenParams =
        new URLSearchParams({
          client_id:
            TWITCH_CLIENT_ID,

          client_secret:
            TWITCH_CLIENT_SECRET,

          code: String(code),

          grant_type:
            "authorization_code",

          redirect_uri:
            TWITCH_VIEWER_REDIRECT_URI,
        });

      const tokenResponse =
        await axios.post(
          TWITCH_TOKEN_URL,
          tokenParams,
          {
            headers: {
              "Content-Type":
                "application/x-www-form-urlencoded",
            },

            timeout: 10_000,
          }
        );

      const accessToken =
        tokenResponse.data
          ?.access_token;

      if (!accessToken) {
        throw new Error(
          "Twitch did not return an access token"
        );
      }

      /*
       * No ID or login parameter is supplied.
       * Twitch returns the user connected to
       * this user access token.
       */
      const userResponse =
        await axios.get(
          TWITCH_USERS_URL,
          {
            headers: {
              "Client-Id":
                TWITCH_CLIENT_ID,

              Authorization:
                `Bearer ${accessToken}`,
            },

            timeout: 10_000,
          }
        );

      const user =
        userResponse.data
          ?.data?.[0];

      if (
        !user ||
        !user.id ||
        !user.login
      ) {
        throw new Error(
          "Twitch user profile was missing"
        );
      }

      const sessionToken =
        createViewerSession(user);

      res.cookie(
        SESSION_COOKIE,
        sessionToken,
        SESSION_COOKIE_OPTIONS
      );

      console.log(
        `[VIEWER AUTH] Signed in Twitch viewer: ${user.login} (${user.id})`
      );

      return res.redirect(
        `${FRONTEND_URL}/claim?auth=success`
      );
    } catch (err) {
      /*
       * Do not log the entire Axios error.
       * It may contain OAuth headers or secrets.
       */
      console.error(
        "[VIEWER AUTH] Twitch callback failed:",
        {
          message:
            err?.message ||
            "Unknown error",

          status:
            err?.response?.status ||
            null,

          twitchError:
            err?.response?.data
              ?.message ||
            err?.response?.data
              ?.error ||
            null,
        }
      );

      clearSessionCookie(res);

      return res.redirect(
        `${FRONTEND_URL}/claim?auth=failed`
      );
    }
  }
);

/**
 * GET /api/auth/viewer/me
 *
 * Returns the viewer stored in the secure
 * DropifyBot session cookie.
 */
router.get(
  "/me",
  (req, res) => {
    const sessionToken =
      req.cookies?.[
        SESSION_COOKIE
      ];

    if (!sessionToken) {
      return res.status(401).json({
        ok: false,
        authenticated: false,
      });
    }

    try {
      const payload = jwt.verify(
        sessionToken,
        VIEWER_SESSION_SECRET,
        {
          algorithms: ["HS256"],
          issuer: "dropifybot",
          audience:
            "dropify-viewer",
        }
      );

      if (
        !payload ||
        typeof payload !== "object" ||
        !payload.sub
      ) {
        throw new Error(
          "Invalid viewer session"
        );
      }

      return res.json({
        ok: true,
        authenticated: true,

        viewer: {
          twitchId:
            String(payload.sub),

          login:
            payload.login,

          displayName:
            payload.displayName,

          profileImageUrl:
            payload.profileImageUrl ||
            null,
        },
      });
    } catch (_) {
      clearSessionCookie(res);

      return res.status(401).json({
        ok: false,
        authenticated: false,
      });
    }
  }
);

/**
 * POST /api/auth/viewer/logout
 */
router.post(
  "/logout",
  (req, res) => {
    clearSessionCookie(res);

    return res.json({
      ok: true,
    });
  }
);

module.exports = router;
