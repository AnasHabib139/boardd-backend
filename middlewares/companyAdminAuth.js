"use strict";

/**
 * Company Admin Authentication Middleware
 *
 * Ensures that only company admins can configure messaging channels
 * Prevents cross-company access and unauthorized provisioning
 *
 * Usage:
 *   router.post('/messaging/sms/provision', Auth, requireCompanyAdmin, handler);
 */

const { model: mongooseModel } = require("mongoose");
const User = mongooseModel("User");

/**
 * Require that user is an admin of the company specified in request
 *
 * Expects req.user to be populated by Auth middleware
 * Expects companyId in req.params, req.body, or req.query
 *
 * Allows:
 * - User who is admin of the specified company
 * - Platform super-admins (for support purposes)
 *
 * @param {Request} req - Express request
 * @param {Response} res - Express response
 * @param {Function} next - Express next middleware
 */
async function requireCompanyAdmin(req, res, next) {
  try {
    // User must be authenticated (Auth middleware should have run)
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        error: "Authentication required"
      });
    }

    // Fetch full user to get companyId (JWT token may not include it)
    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(401).json({
        success: false,
        error: "User not found"
      });
    }

    // Extract companyId from request (params, body, or query)
    const companyId =
      (req.params && req.params.companyId) ||
      (req.body && req.body.companyId) ||
      (req.query && req.query.companyId) ||
      user.companyId; // Fallback to user's company

    if (!companyId) {
      return res.status(400).json({
        success: false,
        error: "Company ID required"
      });
    }

    // Platform super-admins can access any company (for support)
    if (req.user.role === "super_admin" || req.user.role === "admin") {
      console.log(`Super admin ${req.user.id} accessing company ${companyId}`);
      req.companyId = companyId; // Attach to request for handlers
      return next();
    }

    // Check if user belongs to this company
    if (user.companyId.toString() !== companyId.toString()) {
      return res.status(403).json({
        success: false,
        error: "Access denied: You do not belong to this company"
      });
    }

    // Check if user has admin role within company
    // Adjust this check based on your user role structure
    const isCompanyAdmin =
      user.role === "company_admin" ||
      user.role === "admin" ||
      user.isCompanyOwner === true;

    if (!isCompanyAdmin) {
      return res.status(403).json({
        success: false,
        error: "Company admin access required to configure messaging channels"
      });
    }

    // User is authorized
    console.log(`Company admin ${user._id} (${user.email}) accessing company ${companyId}`);
    req.companyId = companyId; // Attach to request for handlers
    next();
  } catch (error) {
    console.error("Error in companyAdminAuth middleware:", error);
    return res.status(500).json({
      success: false,
      error: "Authentication error"
    });
  }
}

/**
 * Optional: Less strict version that just checks company ownership
 * Use for read-only operations
 *
 * @param {Request} req - Express request
 * @param {Response} res - Express response
 * @param {Function} next - Express next middleware
 */
async function requireCompanyAccess(req, res, next) {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        error: "Authentication required"
      });
    }

    // Fetch full user to get companyId (JWT token may not include it)
    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(401).json({
        success: false,
        error: "User not found"
      });
    }

    const companyId =
      (req.params && req.params.companyId) ||
      (req.body && req.body.companyId) ||
      (req.query && req.query.companyId) ||
      user.companyId;

    if (!companyId) {
      return res.status(400).json({
        success: false,
        error: "Company ID required"
      });
    }

    // Super-admins can access any company
    if (req.user.role === "super_admin" || req.user.role === "admin") {
      req.companyId = companyId;
      return next();
    }

    // Regular user: must belong to this company
    if (user.companyId.toString() !== companyId.toString()) {
      return res.status(403).json({
        success: false,
        error: "Access denied: You do not belong to this company"
      });
    }

    req.companyId = companyId;
    next();
  } catch (error) {
    console.error("Error in companyAccess middleware:", error);
    return res.status(500).json({
      success: false,
      error: "Authentication error"
    });
  }
}

module.exports = {
  requireCompanyAdmin,
  requireCompanyAccess
};
