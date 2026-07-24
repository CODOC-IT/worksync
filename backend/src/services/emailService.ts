import { Resend } from 'resend';

const BREVO_PLACEHOLDER = 'xkeysib-your-brevo-api-key-here';
const RESEND_PLACEHOLDER = 're_your_resend_api_key_here';

export const isEmailConfigured = (): boolean => {
  const brevoKey = process.env.BREVO_API_KEY;
  const resendKey = process.env.RESEND_API_KEY;

  const hasBrevo = Boolean(brevoKey && brevoKey !== BREVO_PLACEHOLDER && brevoKey.startsWith('xkeysib-'));
  const hasResend = Boolean(resendKey && resendKey !== RESEND_PLACEHOLDER && resendKey.startsWith('re_'));

  return hasBrevo || hasResend;
};

const getSenderInfo = () => {
  const fromEnv = process.env.BREVO_SENDER_EMAIL || process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
  // Parse name and email if in "Name <email@domain.com>" format
  const match = fromEnv.match(/^(?:"?([^"]*)"?\s)?<([^>]+)>$/);
  if (match) {
    return { name: match[1] || 'WorkSync', email: match[2] };
  }
  return { name: 'WorkSync', email: fromEnv };
};

export const sendOTPEmail = async (toEmail: string, name: string, otp: string): Promise<void> => {
  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>WorkSync OTP Verification</title>
</head>
<body style="margin:0;padding:0;background:#0a0f1e;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="500" cellpadding="0" cellspacing="0"
          style="background:linear-gradient(135deg,#0d1b2e,#112240);border:1px solid rgba(0,212,255,0.2);border-radius:16px;overflow:hidden;">
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#00d4ff22,#7c3aed22);padding:32px;text-align:center;border-bottom:1px solid rgba(0,212,255,0.15);">
              <div style="font-size:28px;font-weight:800;background:linear-gradient(135deg,#00d4ff,#7c3aed);-webkit-background-clip:text;-webkit-text-fill-color:transparent;letter-spacing:-0.5px;">
                WorkSync
              </div>
              <div style="color:#94a3b8;font-size:13px;margin-top:4px;letter-spacing:2px;text-transform:uppercase;">
                Email Verification
              </div>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px 48px;">
              <p style="color:#e2e8f0;font-size:16px;margin:0 0 8px;">Hi <strong style="color:#00d4ff;">${name}</strong>,</p>
              <p style="color:#94a3b8;font-size:15px;line-height:1.6;margin:0 0 32px;">
                Your one-time verification code for WorkSync registration is:
              </p>
              <!-- OTP Box -->
              <div style="text-align:center;margin:0 0 32px;">
                <div style="display:inline-block;background:linear-gradient(135deg,rgba(0,212,255,0.08),rgba(124,58,237,0.08));border:2px solid rgba(0,212,255,0.4);border-radius:12px;padding:20px 48px;">
                  <span style="font-size:42px;font-weight:800;letter-spacing:12px;color:#00d4ff;font-family:'Courier New',monospace;">
                    ${otp}
                  </span>
                </div>
              </div>
              <p style="color:#64748b;font-size:13px;line-height:1.6;margin:0 0 8px;text-align:center;">
                ⏱ This code expires in <strong style="color:#f59e0b;">10 minutes</strong>
              </p>
              <p style="color:#64748b;font-size:13px;line-height:1.6;margin:0;text-align:center;">
                🔒 Do not share this code with anyone
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 48px;border-top:1px solid rgba(255,255,255,0.05);text-align:center;">
              <p style="color:#475569;font-size:12px;margin:0;">
                If you didn't request this, please ignore this email.<br>
                &copy; 2026 WorkSync · Secure Workspace Platform
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const brevoKey = process.env.BREVO_API_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  const sender = getSenderInfo();

  // Try Brevo first if key starts with xkeysib-
  if (brevoKey && brevoKey.startsWith('xkeysib-')) {
    const brevoResponse = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'content-type': 'application/json',
        'api-key': brevoKey
      },
      body: JSON.stringify({
        sender,
        to: [{ email: toEmail, name }],
        subject: `${otp} is your WorkSync verification code`,
        htmlContent
      })
    });

    if (!brevoResponse.ok) {
      const errorData = await brevoResponse.json();
      throw new Error(`Brevo Error: ${errorData.message || brevoResponse.statusText}`);
    }

    console.log(`[Brevo] OTP email sent successfully to ${toEmail} ✓`);
    return;
  }

  // Fallback to Resend
  if (resendKey && resendKey.startsWith('re_')) {
    const resend = new Resend(resendKey);
    const { error } = await resend.emails.send({
      from: `${sender.name} <${sender.email}>`,
      to: toEmail,
      subject: `${otp} is your WorkSync verification code`,
      html: htmlContent
    });

    if (error) {
      throw new Error(`Resend Error: ${error.message}`);
    }

    console.log(`[Resend] OTP email sent successfully to ${toEmail} ✓`);
    return;
  }

  throw new Error('No valid email provider API key found (BREVO_API_KEY or RESEND_API_KEY).');
};
