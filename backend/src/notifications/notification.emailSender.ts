import nodemailer from 'nodemailer';

// The Notification Module's own email channel — deliberately separate from
// backend/src/services/emailService.ts (OTP verification / auth), which this module must never
// import from or modify. Self-contained: its own isEmailConfigured check, its own transporter,
// its own templates. Both files read the same SMTP_USER/SMTP_PASS from .env (the one mailbox
// this app sends through today), but nothing here reaches into the auth/login module and
// nothing there needs to know this file exists.

export const isEmailConfigured = (): boolean => {
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;

  return Boolean(smtpUser && smtpPass && smtpPass !== 'your_gmail_app_password_here');
};

// The company inbox for anyone who replies to a notification email. This is intentionally NOT
// the SMTP "From" address: the actual send still authenticates as SMTP_USER (a Gmail account),
// and Gmail's SMTP relay rejects or rewrites a "From" that doesn't match the authenticated
// account/verified alias. Claiming a company domain in "From" without SPF/DKIM/DMARC set up for
// that domain is exactly what gets legitimate mail flagged as spoofing and sent to spam --
// Reply-To carries the company identity without that risk. Swap SMTP_USER/SMTP_PASS for real
// info@codoc.it.com credentials (or a transactional provider with the domain verified) to send
// "From" that address directly.
const REPLY_TO_ADDRESS = 'info@codoc.it.com';
const SENDER_DISPLAY_NAME = 'WorkSync by Codoc';

// Notification titles/messages/names are user-influenced content (task titles, discussion
// subjects, display names) interpolated straight into an HTML email body -- escape it so a
// stray "<" or "&" can't break the layout or inject markup into an email client that renders it.
const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export interface NotificationEmailItem {
  title: string;
  message: string;
  priority: string;
}

// Generic sender for the Notification Module's email channel (see
// docs/Notification_Module_Guide.md Section 10) — used for both an immediate single-item email
// (Critical priority) and a batched digest (multiple items). A single renderer covers both,
// since "a digest of one" is just a list with one row.
export const sendNotificationEmail = async (
  toEmail: string,
  name: string,
  items: NotificationEmailItem[]
): Promise<void> => {
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;

  if (!smtpUser || !smtpPass || smtpPass === 'your_gmail_app_password_here') {
    throw new Error('Nodemailer SMTP credentials (SMTP_USER & SMTP_PASS) are missing in .env.');
  }
  if (items.length === 0) return;

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: smtpUser,
      pass: smtpPass
    }
  });

  const isSingleCritical = items.length === 1 && items[0].priority === 'Critical';
  const subject = isSingleCritical
    ? `Action required: ${items[0].title}`
    : items.length === 1
      ? items[0].title
      : `WorkSync: ${items.length} new notification${items.length === 1 ? '' : 's'}`;

  const rowsHtml = items
    .map(
      (item) => `
        <tr>
          <td style="padding:14px 0;border-bottom:1px solid rgba(255,255,255,0.06);">
            <div style="color:#e2e8f0;font-size:15px;font-weight:600;margin:0 0 4px;">${escapeHtml(item.title)}</div>
            <div style="color:#94a3b8;font-size:13px;line-height:1.5;margin:0;">${escapeHtml(item.message)}</div>
          </td>
        </tr>`
    )
    .join('');

  const textContent =
    `Hi ${name},\n\n` +
    items.map((item) => `- ${item.title}: ${item.message}`).join('\n') +
    `\n\nManage your email preferences from the Notification Center in WorkSync.\n\n${SENDER_DISPLAY_NAME}`;

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>WorkSync Notifications</title>
</head>
<body style="margin:0;padding:0;background:#0a0f1e;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0"
          style="background:linear-gradient(135deg,#0d1b2e,#112240);border:1px solid rgba(0,212,255,0.2);border-radius:16px;overflow:hidden;">
          <tr>
            <td style="background:linear-gradient(135deg,#00d4ff22,#7c3aed22);padding:32px;text-align:center;border-bottom:1px solid rgba(0,212,255,0.15);">
              <div style="font-size:28px;font-weight:800;background:linear-gradient(135deg,#00d4ff,#7c3aed);-webkit-background-clip:text;-webkit-text-fill-color:transparent;letter-spacing:-0.5px;">
                WorkSync
              </div>
              <div style="color:#94a3b8;font-size:13px;margin-top:4px;letter-spacing:2px;text-transform:uppercase;">
                ${isSingleCritical ? 'Urgent Notification' : 'Notification Summary'}
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 48px;">
              <p style="color:#e2e8f0;font-size:16px;margin:0 0 24px;">Hi <strong style="color:#00d4ff;">${escapeHtml(name)}</strong>,</p>
              <table width="100%" cellpadding="0" cellspacing="0">${rowsHtml}</table>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 48px;border-top:1px solid rgba(255,255,255,0.05);text-align:center;">
              <p style="color:#475569;font-size:12px;margin:0;">
                Manage email preferences from the Notification Center in WorkSync.<br>
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
    from: `"${SENDER_DISPLAY_NAME}" <${smtpUser}>`,
    replyTo: REPLY_TO_ADDRESS,
    to: toEmail,
    subject,
    text: textContent,
    html: htmlContent
  });

  console.log(`[Nodemailer] Notification email (${items.length} item(s)) sent to ${toEmail} ✓`);
};
