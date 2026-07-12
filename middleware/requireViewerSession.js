// /var/www/dropify-backend/middleware/requireViewerSession.js
const jwt = require("jsonwebtoken");

const VIEWER_SESSION_SECRET =
  process.env.VIEWER_SESSION_SECRET;

const SESSION_COOKIE =
  "dropify_viewer_session";

/**
 * Verifies the secure viewer session created
 * after Twitch login.
 *
 * On success, the Twitch viewer is available at:
 *
 * req.viewer.twitchId
 * req.viewer.login
 * req.viewer.displayName
 */
function requireViewerSession(req, res, next) {
  if (!VIEWER_SESSION_SECRET) {
    console.error(
      "[VIEWER SESSION] VIEWER_SESSION_SECRET is missing"
    );

    return res.status(500).json({
      ok: false,
      error: "Viewer authentication is not configured.",
    });
  }

  const sessionToken =
    req.cookies?.[SESSION_COOKIE];

  if (!sessionToken) {
    return res.status(401).json({
      ok: false,
      reason: "not_authenticated",
      message: "Please sign in with Twitch.",
    });
  }

  try {
    const payload = jwt.verify(
      sessionToken,
      VIEWER_SESSION_SECRET,
      {
        algorithms: ["HS256"],
        issuer: "dropifybot",
        audience: "dropify-viewer",
      }
    );

    if (
      !payload ||
      typeof payload !== "object" ||
      !payload.sub ||
      !payload.login
    ) {
      throw new Error(
        "Viewer session is missing required identity fields"
      );
    }

    req.viewer = {
      twitchId: String(payload.sub),
      login: String(payload.login).toLowerCase(),
      displayName:
        payload.displayName ||
        payload.login,
      profileImageUrl:
        payload.profileImageUrl ||
        null,
    };

    return next();
  } catch (error) {
    console.warn(
      "[VIEWER SESSION] Invalid or expired session:",
      error?.message || error
    );

    res.clearCookie(
      SESSION_COOKIE,
      {
        httpOnly: true,
        secure:
          process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
      }
    );

    return res.status(401).json({
      ok: false,
      reason: "invalid_session",
      message:
        "Your Twitch session expired. Please sign in again.",
    });
  }
}

module.exports = requireViewerSession;
