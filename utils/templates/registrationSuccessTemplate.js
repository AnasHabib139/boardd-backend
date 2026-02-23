/**
 * Registration success email template
 */

/**
 * Generate registration success email template
 * @param {Object} params Parameters for the template
 * @param {string} params.userName User's name
 * @param {string} params.companyName Company/organization name
 * @param {string} params.loginLink URL to the login page
 * @returns {Object} Object containing HTML and text versions of the email
 */
exports.generateRegistrationSuccessEmail = ({
  userName,
  companyName,
  loginLink,
}) => {
  const baseUrl = process.env.BACKEND_URL;
  const logoUrl = `${baseUrl}/assets/images/boardd-logo.png`;

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to Boarddd!</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.6;
      color: #0f172a;
      background-color: #f1f5f9;
      -webkit-text-size-adjust: none;
      -ms-text-size-adjust: none;
    }

    .wrapper {
      padding: 40px 16px;
    }

    .email-container {
      max-width: 560px;
      margin: 0 auto;
      background-color: #ffffff;
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 1px 3px rgba(0,0,0,0.08), 0 8px 30px rgba(0,0,0,0.06);
    }

    /* ---- hero ---- */
    .hero {
      background: linear-gradient(160deg, #059669 0%, #10b981 50%, #34d399 100%);
      padding: 48px 40px 40px;
      text-align: center;
      position: relative;
      overflow: hidden;
    }

    .hero::before {
      content: "";
      position: absolute;
      top: -40%;
      right: -20%;
      width: 320px;
      height: 320px;
      background: radial-gradient(circle, rgba(255,255,255,0.12) 0%, transparent 70%);
      border-radius: 50%;
    }

    .hero::after {
      content: "";
      position: absolute;
      bottom: -30%;
      left: -10%;
      width: 240px;
      height: 240px;
      background: radial-gradient(circle, rgba(255,255,255,0.08) 0%, transparent 70%);
      border-radius: 50%;
    }

    .logo {
      height: 44px;
      width: auto;
      margin-bottom: 24px;
      filter: brightness(0) invert(1);
      position: relative;
      z-index: 1;
    }

    .hero-badge {
      display: inline-block;
      background: rgba(255,255,255,0.2);
      backdrop-filter: blur(4px);
      color: #ffffff;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 1.2px;
      text-transform: uppercase;
      padding: 6px 16px;
      border-radius: 20px;
      margin-bottom: 20px;
      position: relative;
      z-index: 1;
    }

    .hero-title {
      color: #ffffff;
      font-size: 30px;
      font-weight: 800;
      margin: 0 0 10px;
      letter-spacing: -0.3px;
      position: relative;
      z-index: 1;
    }

    .hero-sub {
      color: rgba(255,255,255,0.85);
      font-size: 15px;
      font-weight: 400;
      position: relative;
      z-index: 1;
    }

    /* ---- body ---- */
    .body {
      padding: 40px;
    }

    .greeting {
      font-size: 20px;
      font-weight: 700;
      color: #0f172a;
      margin-bottom: 12px;
    }

    .intro {
      font-size: 15px;
      color: #475569;
      line-height: 1.75;
      margin-bottom: 28px;
    }

    /* org pill */
    .org-strip {
      display: flex;
      align-items: center;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 16px 20px;
      margin-bottom: 32px;
    }

    .org-icon {
      width: 42px;
      height: 42px;
      min-width: 42px;
      background: linear-gradient(135deg, #059669, #10b981);
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-right: 16px;
    }

    .org-icon-letter {
      color: #ffffff;
      font-size: 20px;
      font-weight: 700;
      line-height: 1;
    }

    .org-label {
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.6px;
      text-transform: uppercase;
      color: #94a3b8;
      margin-bottom: 2px;
    }

    .org-name {
      font-size: 16px;
      font-weight: 700;
      color: #0f172a;
    }

    /* feature grid */
    .features {
      margin-bottom: 36px;
    }

    .features-heading {
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      color: #94a3b8;
      margin-bottom: 16px;
    }

    .feature-row {
      display: flex;
      align-items: flex-start;
      padding: 12px 0;
    }

    .feature-row + .feature-row {
      border-top: 1px solid #f1f5f9;
    }

    .feature-dot {
      width: 32px;
      height: 32px;
      min-width: 32px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-right: 14px;
      font-size: 15px;
    }

    .fd-blue { background: #eff6ff; }
    .fd-purple { background: #f5f3ff; }
    .fd-emerald { background: #ecfdf5; }
    .fd-amber { background: #fffbeb; }

    .feature-text {
      font-size: 14px;
      color: #334155;
      line-height: 1.5;
      padding-top: 5px;
    }

    .feature-text strong {
      color: #0f172a;
    }

    /* cta */
    .cta-wrap {
      text-align: center;
      margin-bottom: 36px;
    }

    .cta-btn {
      display: inline-block;
      background: linear-gradient(135deg, #059669 0%, #10b981 100%);
      color: #ffffff !important;
      text-decoration: none;
      padding: 14px 48px;
      border-radius: 10px;
      font-size: 15px;
      font-weight: 700;
      letter-spacing: 0.2px;
      box-shadow: 0 4px 14px rgba(16, 185, 129, 0.35);
      transition: box-shadow 0.2s;
    }

    .cta-link {
      display: block;
      margin-top: 12px;
      font-size: 12px;
      color: #94a3b8;
      word-break: break-all;
    }

    /* divider */
    .divider {
      height: 1px;
      background: #e2e8f0;
      margin: 0 0 28px;
    }

    .help {
      font-size: 13px;
      color: #64748b;
      line-height: 1.6;
      text-align: center;
    }

    .help a {
      color: #059669;
      text-decoration: none;
      font-weight: 600;
    }

    /* ---- footer ---- */
    .footer {
      background: #f8fafc;
      padding: 28px 40px;
      text-align: center;
      border-top: 1px solid #e2e8f0;
    }

    .footer-text {
      font-size: 12px;
      color: #94a3b8;
      line-height: 1.6;
      margin-bottom: 8px;
    }

    .footer-brand {
      font-size: 12px;
      color: #cbd5e1;
    }

    .footer-brand a {
      color: #059669;
      text-decoration: none;
      font-weight: 600;
    }

    /* ---- mobile ---- */
    @media only screen and (max-width: 600px) {
      .wrapper { padding: 16px 8px; }
      .email-container { border-radius: 12px; }
      .hero { padding: 36px 24px 32px; }
      .hero-title { font-size: 24px; }
      .body { padding: 28px 24px; }
      .footer { padding: 24px; }
      .org-strip { flex-direction: column; text-align: center; }
      .org-icon { margin: 0 auto 12px; }
      .feature-row { flex-direction: column; align-items: center; text-align: center; }
      .feature-dot { margin: 0 0 8px; }
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="email-container">

      <!-- Hero -->
      <div class="hero">
        <img src="${logoUrl}" alt="Boarddd" class="logo" />
        <div class="hero-badge">Account Created</div>
        <h1 class="hero-title">Welcome to Boarddd!</h1>
        <p class="hero-sub">You're all set. Let's build something great.</p>
      </div>

      <!-- Body -->
      <div class="body">
        <div class="greeting">Hi ${userName || "there"},</div>
        <p class="intro">
          Thanks for signing up! Your organization <strong>${companyName}</strong> is ready to go. Here's a quick look at what's waiting for you inside.
        </p>

        <!-- Org strip -->
        <div class="org-strip">
          <div class="org-icon">
            <span class="org-icon-letter">${(companyName || "O").charAt(0).toUpperCase()}</span>
          </div>
          <div>
            <div class="org-label">Organization</div>
            <div class="org-name">${companyName}</div>
          </div>
        </div>

        <!-- Features -->
        <div class="features">
          <div class="features-heading">What you can do</div>

          <div class="feature-row">
            <div class="feature-dot fd-blue">&#128203;</div>
            <div class="feature-text"><strong>Projects &amp; Tasks</strong> &mdash; Plan, assign, and track work across your team.</div>
          </div>

          <div class="feature-row">
            <div class="feature-dot fd-purple">&#128172;</div>
            <div class="feature-text"><strong>Team &amp; Client Chat</strong> &mdash; Real-time messaging with channels and DMs.</div>
          </div>

          <div class="feature-row">
            <div class="feature-dot fd-emerald">&#9202;</div>
            <div class="feature-text"><strong>Time Tracking</strong> &mdash; Log hours, generate reports, and stay on budget.</div>
          </div>

          <div class="feature-row">
            <div class="feature-dot fd-amber">&#128194;</div>
            <div class="feature-text"><strong>Files &amp; Collaboration</strong> &mdash; Share documents and work together in real time.</div>
          </div>
        </div>

        <!-- CTA -->
        <div class="cta-wrap">
          <a href="${loginLink}" class="cta-btn">Get Started</a>
          <span class="cta-link">${loginLink}</span>
        </div>

        <div class="divider"></div>

        <p class="help">
          Questions? Just reply to this email or reach out to our support team &mdash; we're happy to help.
        </p>
      </div>

      <!-- Footer -->
      <div class="footer">
        <div class="footer-text">
          You're receiving this because you created a Boarddd account.
        </div>
        <div class="footer-brand">
          Powered by <a href="${process.env.FRONTEND_URL}">Boarddd</a>
        </div>
      </div>

    </div>
  </div>
</body>
</html>
  `;

  const text = `
WELCOME TO BOARDDD!
====================

Hi ${userName || "there"},

Thanks for signing up! Your organization "${companyName}" is ready to go.

WHAT YOU CAN DO
----------------
- Projects & Tasks -- Plan, assign, and track work across your team
- Team & Client Chat -- Real-time messaging with channels and DMs
- Time Tracking -- Log hours, generate reports, and stay on budget
- Files & Collaboration -- Share documents and work together in real time

GET STARTED: ${loginLink}

Questions? Just reply to this email or reach out to our support team.

---
You're receiving this because you created a Boarddd account.
Powered by Boarddd - ${process.env.FRONTEND_URL}
  `;

  return { html, text };
};
