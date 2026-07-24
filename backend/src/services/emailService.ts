import nodemailer from 'nodemailer';

export const isEmailConfigured = (): boolean => {
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;

  return Boolean(smtpUser && smtpPass && smtpPass !== 'your_gmail_app_password_here');
};

export const sendOTPEmail = async (toEmail: string, name: string, otp: string): Promise<void> => {
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;

  if (!smtpUser || !smtpPass || smtpPass === 'your_gmail_app_password_here') {
    throw new Error('Nodemailer SMTP credentials (SMTP_USER & SMTP_PASS) are missing in .env.');
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: smtpUser,
      pass: smtpPass
    }
  });

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

  await transporter.sendMail({
    from: `"WorkSync Security" <${smtpUser}>`,
    to: toEmail,
    subject: `${otp} is your WorkSync verification code`,
    html: htmlContent
  });

  console.log(`[Nodemailer] OTP email sent successfully to ${toEmail} ✓`);
};
