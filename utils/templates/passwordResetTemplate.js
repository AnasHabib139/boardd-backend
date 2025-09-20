/**
 * Password reset email template
 */

/**
 * Generate password reset email template
 * @param {Object} params Parameters for the template
 * @param {string} params.code 6-digit reset code
 * @param {string} params.userName User's name
 * @param {string} params.userEmail User's email
 * @returns {Object} Object containing HTML and text versions of the email
 */
exports.generatePasswordResetEmail = ({ code, userName, userEmail }) => {
  const baseUrl = process.env.BACKEND_URL;
  const logoUrl = `${baseUrl}/assets/images/boardd-logo.png`;

  // HTML email with modern professional styling
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your Password - Boardd</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      line-height: 1.6;
      color: #1f2937;
      background-color: #f9fafb;
      -webkit-text-size-adjust: none;
    }
    
    .email-container {
      max-width: 600px;
      margin: 0 auto;
      background-color: #ffffff;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    }
    
    .email-header {
      background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%);
      padding: 32px 40px;
      text-align: center;
    }
    
    .logo {
      height: 48px;
      width: auto;
      margin-bottom: 16px;
      filter: brightness(0) invert(1);
    }
    
    .header-title {
      color: #ffffff;
      font-size: 28px;
      font-weight: 700;
      margin: 0;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
    }
    
    .header-subtitle {
      color: rgba(255, 255, 255, 0.9);
      font-size: 16px;
      margin-top: 8px;
    }
    
    .email-body {
      padding: 40px;
    }
    
    .greeting {
      font-size: 18px;
      color: #1f2937;
      margin-bottom: 24px;
      font-weight: 500;
    }
    
    .reset-message {
      font-size: 16px;
      color: #4b5563;
      margin-bottom: 32px;
      line-height: 1.7;
    }
    
    .code-card {
      background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%);
      border-left: 4px solid #3b82f6;
      padding: 24px;
      border-radius: 8px;
      margin: 24px 0;
      text-align: center;
    }
    
    .code-card-title {
      font-size: 14px;
      font-weight: 600;
      color: #1e40af;
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    
    .code-card-title::before {
      content: "🔑";
      margin-right: 8px;
    }
    
    .reset-code {
      font-size: 32px;
      font-weight: 700;
      color: #1e40af;
      letter-spacing: 8px;
      margin: 16px 0;
      font-family: ui-monospace, SFMono-Regular, 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
      background-color: #ffffff;
      padding: 16px 24px;
      border-radius: 8px;
      border: 2px solid #3b82f6;
      display: inline-block;
    }
    
    .code-instructions {
      font-size: 14px;
      color: #1e40af;
      margin-top: 12px;
    }
    
    .security-notice {
      background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
      border-left: 4px solid #f59e0b;
      padding: 20px;
      border-radius: 8px;
      margin: 24px 0;
    }
    
    .security-title {
      font-size: 14px;
      font-weight: 600;
      color: #92400e;
      margin-bottom: 12px;
      display: flex;
      align-items: center;
    }
    
    .security-title::before {
      content: "🔒";
      margin-right: 8px;
    }
    
    .security-text {
      font-size: 14px;
      color: #78350f;
      line-height: 1.5;
    }
    
    .security-text ul {
      margin-top: 8px;
      padding-left: 16px;
    }
    
    .security-text li {
      margin-bottom: 4px;
    }
    
    .expiry-notice {
      background-color: #fef2f2;
      border-left: 4px solid #ef4444;
      padding: 16px;
      border-radius: 6px;
      margin: 24px 0;
      text-align: center;
    }
    
    .expiry-text {
      font-size: 14px;
      color: #dc2626;
      font-weight: 500;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    
    .expiry-text::before {
      content: "⏰";
      margin-right: 8px;
    }
    
    .help-section {
      margin-top: 32px;
      padding-top: 24px;
      border-top: 1px solid #e5e7eb;
    }
    
    .help-title {
      font-size: 16px;
      font-weight: 600;
      color: #1f2937;
      margin-bottom: 12px;
    }
    
    .help-text {
      font-size: 14px;
      color: #6b7280;
      line-height: 1.5;
    }
    
    .email-footer {
      background-color: #f9fafb;
      padding: 32px 40px;
      text-align: center;
      border-top: 1px solid #e5e7eb;
    }
    
    .footer-text {
      font-size: 14px;
      color: #6b7280;
      margin-bottom: 16px;
    }
    
    .footer-branding {
      font-size: 12px;
      color: #9ca3af;
    }
    
    .footer-branding a {
      color: #3b82f6;
      text-decoration: none;
    }
    
    @media only screen and (max-width: 600px) {
      .email-container {
        margin: 0;
        border-radius: 0;
      }
      
      .email-header, .email-body, .email-footer {
        padding: 24px 20px;
      }
      
      .header-title {
        font-size: 24px;
      }
      
      .reset-code {
        font-size: 28px;
        letter-spacing: 6px;
        padding: 12px 16px;
      }
      
      .code-card {
        padding: 20px;
      }
    }
  </style>
</head>
<body>
  <div class="email-container">
    <!-- Header -->
    <div class="email-header">
      <img src="${logoUrl}" alt="Boardd" class="logo" />
      <h1 class="header-title">Reset Your Password</h1>
      <div class="header-subtitle">We received a request to reset your password</div>
    </div>
    
    <!-- Body -->
    <div class="email-body">
      <div class="greeting">Hello ${userName || 'there'}! 👋</div>
      
      <div class="reset-message">
        We received a request to reset the password for your Boardd account associated with <strong>${userEmail}</strong>.
        <br><br>
        Use the verification code below to reset your password:
      </div>
      
      <div class="code-card">
        <div class="code-card-title">Your Verification Code</div>
        <div class="reset-code">${code}</div>
        <div class="code-instructions">Enter this code in the password reset form</div>
      </div>
      
      <div class="security-notice">
        <div class="security-title">Security Information</div>
        <div class="security-text">
          <ul>
            <li>This code will expire in <strong>15 minutes</strong></li>
            <li>You can only use this code <strong>once</strong></li>
            <li>Maximum <strong>3 attempts</strong> allowed per code</li>
            <li>If you didn't request this, you can safely ignore this email</li>
          </ul>
        </div>
      </div>
      
      <div class="expiry-notice">
        <div class="expiry-text">This code expires in 15 minutes</div>
      </div>
      
      <div class="help-section">
        <div class="help-title">Need Help?</div>
        <div class="help-text">
          If you didn't request a password reset, please ignore this email. Your password will remain unchanged.
          <br><br>
          If you're having trouble resetting your password, please contact our support team.
        </div>
      </div>
    </div>
    
    <!-- Footer -->
    <div class="email-footer">
      <div class="footer-text">
        This email was sent because a password reset was requested for your Boardd account.
        <br>
        If you didn't make this request, please ignore this email.
      </div>
      <div class="footer-branding">
        Powered by <a href="${process.env.FRONTEND_URL}">Boardd</a>
      </div>
    </div>
  </div>
</body>
</html>
  `;

  // Plain text version
  const text = `
🔐 RESET YOUR PASSWORD - BOARDD

Hello ${userName || 'there'}!

We received a request to reset the password for your Boardd account associated with ${userEmail}.

YOUR VERIFICATION CODE:
═══════════════════════════════════════════════════════════
${code}
═══════════════════════════════════════════════════════════

Enter this code in the password reset form to continue.

🔒 SECURITY INFORMATION:
• This code will expire in 15 minutes
• You can only use this code once
• Maximum 3 attempts allowed per code
• If you didn't request this, you can safely ignore this email

⏰ This code expires in 15 minutes.

NEED HELP?
If you didn't request a password reset, please ignore this email. Your password will remain unchanged.

If you're having trouble resetting your password, please contact our support team.

This email was sent because a password reset was requested for your Boardd account.

Powered by Boardd - ${process.env.FRONTEND_URL}
  `;

  return { html, text };
};