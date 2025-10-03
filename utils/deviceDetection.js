const UAParser = require("ua-parser-js");
const geoip = require("fast-geoip");

/**
 * Extract device information from request
 * @param {Object} req - Express request object
 * @returns {Promise<Object>} Device information object with location
 */
exports.extractDeviceInfo = async (req) => {
  const parser = new UAParser();
  const userAgent = req.headers["user-agent"] || "";

  // Extract IP address, handling x-forwarded-for properly
  let ipAddress = req.ip || req.connection.remoteAddress || "unknown";

  // Handle x-forwarded-for header (may contain comma-separated IPs)
  const forwardedFor = req.headers["x-forwarded-for"];
  if (forwardedFor) {
    // Take the first IP (client's real IP)
    ipAddress = forwardedFor.split(",")[0].trim();
  }

  // Remove IPv6 prefix if present (::ffff:192.168.1.1 -> 192.168.1.1)
  if (ipAddress.startsWith("::ffff:")) {
    ipAddress = ipAddress.substring(7);
  }

  parser.setUA(userAgent);
  const result = parser.getResult();

  // Perform geolocation lookup
  let location = null;
  console.log(`🌍 Attempting geolocation lookup for IP: ${ipAddress}`);

  // Check if this is localhost
  const isLocalhost = ipAddress === "::1" || ipAddress === "127.0.0.1" || ipAddress === "unknown";

  if (isLocalhost) {
    console.log(`⚠️ Localhost detected (${ipAddress}) - location will be null in production`);
    console.log(`💡 To test: Add "x-forwarded-for: 8.8.8.8" header in Postman`);
  }

  if (ipAddress && !isLocalhost) {
    try {
      const geo = await geoip.lookup(ipAddress);
      console.log(`🌍 Geolocation result for ${ipAddress}:`, geo);

      if (geo) {
        location = {
          country: geo.country || null,
          city: geo.city || null,
        };
        console.log(`✅ Location saved:`, location);
      }
    } catch (error) {
      console.warn(`⚠️ Geolocation lookup failed for IP ${ipAddress}:`, error.message);
      location = null;
    }
  }

  return {
    userAgent,
    ipAddress,
    browser: `${result.browser.name || "Unknown"} ${
      result.browser.version || ""
    }`.trim(),
    os: `${result.os.name || "Unknown"} ${result.os.version || ""}`.trim(),
    deviceType: result.device.type || "desktop", // mobile, tablet, desktop
    location,
  };
};

/**
 * Create device fingerprint for identification
 * @param {Object} deviceInfo - Device information object
 * @returns {String} Device fingerprint
 */
exports.createDeviceFingerprint = (deviceInfo) => {
  return `${deviceInfo.browser}_${deviceInfo.os}_${deviceInfo.deviceType}`;
};

/**
 * Generate human-readable device description
 * @param {Object} deviceInfo - Device information object
 * @returns {String} Human readable device description
 */
exports.getDeviceDescription = (deviceInfo) => {
  const browser = deviceInfo.browser || "Unknown Browser";
  const os = deviceInfo.os || "Unknown OS";
  return `${browser} on ${os}`;
};
