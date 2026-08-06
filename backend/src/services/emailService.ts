import nodemailer from 'nodemailer';

export const isEmailConfigured = (): boolean => {
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;

  return Boolean(smtpUser && smtpPass && smtpPass !== 'your_gmail_app_password_here');
};

const escapeHtml = (value: string): string =>
  value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  })[character] || character);

const accountTransport = () => {
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  if (!smtpUser || !smtpPass || smtpPass === 'your_gmail_app_password_here') {
    throw new Error('SMTP credentials are not configured.');
  }
  return {
    smtpUser,
    organization: process.env.ORGANIZATION_NAME?.trim() || 'WorkSync',
    transporter: nodemailer.createTransport({ service: 'gmail', auth: { user: smtpUser, pass: smtpPass } })
  };
};

export interface CredentialEmailInput {
  toEmail: string;
  recipientName: string;
  password: string;
  role: string;
}

export interface AccountUpdateEmailInput {
  toEmail: string;
  recipientName: string;
  role: string;
  department: string;
  title: string;
  changedBy: string;
  password?: string;
  previous?: {
    name?: string;
    email?: string;
    role?: string;
    department?: string;
    title?: string;
  };
}

export const buildCredentialEmailContent = (
  input: CredentialEmailInput,
  organization: string,
  loginUrl: string
): { subject: string; text: string; html: string } => {
  const safe = {
    organization: escapeHtml(organization),
    name: escapeHtml(input.recipientName),
    email: escapeHtml(input.toEmail),
    password: escapeHtml(input.password),
    role: escapeHtml(input.role),
    loginUrl: escapeHtml(loginUrl)
  };
  return {
    subject: `Your ${organization} account credentials`,
    text: [
      `Hello ${input.recipientName},`,
      '',
      `Your ${organization} account is ready.`,
      `Email: ${input.toEmail}`,
      `Password: ${input.password}`,
      `Role: ${input.role}`,
      'This is your permanent sign-in password.',
      loginUrl ? `Sign in: ${loginUrl}` : '',
      '',
      'Keep your password secure and do not share it with anyone.'
    ].filter(Boolean).join('\n'),
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#1f2937">
      <h1 style="font-size:22px">Welcome to ${safe.organization}</h1>
      <p>Hello ${safe.name},</p>
      <p>Your account has been created. Use these credentials to sign in:</p>
      <table style="border-collapse:collapse;width:100%">
        <tr><td style="padding:6px"><strong>Email</strong></td><td style="padding:6px">${safe.email}</td></tr>
        <tr><td style="padding:6px"><strong>Password</strong></td><td style="padding:6px">${safe.password}</td></tr>
        <tr><td style="padding:6px"><strong>Role</strong></td><td style="padding:6px">${safe.role}</td></tr>
      </table>
      <p>This is your permanent sign-in password.</p>
      ${loginUrl ? `<p><a href="${safe.loginUrl}">Sign in to ${safe.organization}</a></p>` : ''}
      <p>Keep your password secure and do not share it with anyone.</p>
    </div>`
  };
};

export const sendCredentialEmail = async (input: CredentialEmailInput): Promise<void> => {
  const { smtpUser, organization, transporter } = accountTransport();
  const loginUrl = process.env.APP_LOGIN_URL?.trim() || '';
  await transporter.sendMail({
    from: `"${organization.replace(/[\r\n"]/g, '')}" <${smtpUser}>`,
    to: input.toEmail,
    ...buildCredentialEmailContent(input, organization, loginUrl)
  });
};

export const sendAccountUpdateEmail = async (input: AccountUpdateEmailInput): Promise<void> => {
  const { smtpUser, organization, transporter } = accountTransport();
  const loginUrl = process.env.APP_LOGIN_URL?.trim() || '';
  const safe = {
    organization: escapeHtml(organization),
    name: escapeHtml(input.recipientName),
    email: escapeHtml(input.toEmail),
    role: escapeHtml(input.role),
    department: escapeHtml(input.department),
    title: escapeHtml(input.title),
    changedBy: escapeHtml(input.changedBy),
    password: input.password ? escapeHtml(input.password) : '',
    loginUrl: escapeHtml(loginUrl)
  };

  const previous = input.previous || {};
  const changes = [
    ...(previous.name !== undefined && previous.name !== input.recipientName ? [['Name', previous.name || '', input.recipientName]] : []),
    ...(previous.email !== undefined && previous.email !== input.toEmail ? [['Email', previous.email || '', input.toEmail]] : []),
    ...(previous.role !== undefined && previous.role !== input.role ? [['Role', previous.role || '', input.role]] : []),
    ...(previous.department !== undefined && previous.department !== input.department ? [['Department', previous.department || '', input.department]] : []),
    ...(previous.title !== undefined && previous.title !== input.title ? [['Designation', previous.title || '', input.title]] : []),
  ];
  const passwordChanged = Boolean(input.password);
  const onlyPasswordChanged = passwordChanged && changes.length === 0;

  const changeRows = changes.map(([label, from, to]) =>
    `<tr><td style="padding:8px 6px;border-top:1px solid #e5e7eb"><strong>${escapeHtml(String(label))}</strong></td><td style="padding:8px 6px;border-top:1px solid #e5e7eb;color:#6b7280;text-decoration:line-through">${escapeHtml(String(from))}</td><td style="padding:8px 6px;border-top:1px solid #e5e7eb;color:#059669;font-weight:600">${escapeHtml(String(to))}</td></tr>`
  ).join('');

  const summaryText = onlyPasswordChanged
    ? 'Your password reset request has been approved. Your password was changed.'
    : changes.length > 0
      ? `Your account request has been approved. The following details were changed by ${input.changedBy}:`
      : `Your account details were reviewed by ${input.changedBy}.`;
  const summaryHtml = onlyPasswordChanged
    ? `<p>Your password reset request has been approved. Your password was changed.</p>`
    : changes.length > 0
      ? `<p>Your account request has been approved. The following details were changed by ${safe.changedBy}:</p>`
      : `<p>Your account details were reviewed by ${safe.changedBy}.</p>`;

  const textLines = [
    `Hello ${input.recipientName},`,
    '',
    summaryText,
    ...(changes.length > 0
      ? changes.map(([label, from, to]) => `  ${label}: ${from} \u2192 ${to}`)
      : []),
    passwordChanged ? `  Password: ${input.password}` : '',
    '',
    'Your current account details:',
    `  Name: ${input.recipientName}`,
    `  Email: ${input.toEmail}`,
    `  Role: ${input.role}`,
    `  Department: ${input.department}`,
    `  Designation: ${input.title}`,
    loginUrl ? `  Sign in: ${loginUrl}` : '',
    '',
    'If you did not expect this change, contact your administrator immediately.'
  ].filter(Boolean);

  await transporter.sendMail({
    from: `"${organization.replace(/[\r\n"]/g, '')}" <${smtpUser}>`,
    to: input.toEmail,
    subject: passwordChanged && !onlyPasswordChanged
      ? `Your ${organization} account was updated`
      : passwordChanged
        ? `Your ${organization} password reset request is approved`
        : `Your ${organization} account details were updated`,
    text: textLines.join('\n'),
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#1f2937">
      <h1 style="font-size:22px">${passwordChanged && !onlyPasswordChanged ? 'Your account was updated' : passwordChanged ? 'Your password reset request is approved' : 'Your account details were updated'}</h1>
      <p>Hello ${safe.name},</p>
      ${summaryHtml}
      ${changes.length > 0 ? `<table style="border-collapse:collapse;width:100%">
        <tr style="color:#374151;text-align:left"><th style="padding:8px 6px;border-bottom:2px solid #e5e7eb">Field</th><th style="padding:8px 6px;border-bottom:2px solid #e5e7eb">Previous</th><th style="padding:8px 6px;border-bottom:2px solid #e5e7eb">New</th></tr>
        ${changeRows}
      </table>` : ''}
      <p style="margin-top:16px">Your current account details:</p>
      <table style="border-collapse:collapse;width:100%">
        <tr><td style="padding:6px"><strong>Name</strong></td><td style="padding:6px">${safe.name}</td></tr>
        <tr><td style="padding:6px"><strong>Email</strong></td><td style="padding:6px">${safe.email}</td></tr>
        <tr><td style="padding:6px"><strong>Role</strong></td><td style="padding:6px">${safe.role}</td></tr>
        <tr><td style="padding:6px"><strong>Department</strong></td><td style="padding:6px">${safe.department}</td></tr>
        <tr><td style="padding:6px"><strong>Designation</strong></td><td style="padding:6px">${safe.title}</td></tr>
        ${passwordChanged ? `<tr><td style="padding:6px"><strong>Password</strong></td><td style="padding:6px">${safe.password}</td></tr>` : ''}
      </table>
      ${loginUrl ? `<p><a href="${safe.loginUrl}">Sign in to ${safe.organization}</a></p>` : ''}
      <p>If you did not expect this change, contact your administrator immediately.</p>
    </div>`
  });
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
                ⏱ This code expires in <strong style="color:#f59e0b;">1 minute</strong>
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
    ? `[Urgent] ${items[0].title}`
    : items.length === 1
      ? items[0].title
      : `WorkSync: ${items.length} new notification${items.length === 1 ? '' : 's'}`;

  const rowsHtml = items
    .map(
      (item) => `
        <tr>
          <td style="padding:14px 0;border-bottom:1px solid rgba(255,255,255,0.06);">
            <div style="color:#e2e8f0;font-size:15px;font-weight:600;margin:0 0 4px;">${item.title}</div>
            <div style="color:#94a3b8;font-size:13px;line-height:1.5;margin:0;">${item.message}</div>
          </td>
        </tr>`
    )
    .join('');

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
              <p style="color:#e2e8f0;font-size:16px;margin:0 0 24px;">Hi <strong style="color:#00d4ff;">${name}</strong>,</p>
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
    from: `"WorkSync Notifications" <${smtpUser}>`,
    to: toEmail,
    subject,
    html: htmlContent
  });

  console.log(`[Nodemailer] Notification email (${items.length} item(s)) sent to ${toEmail} ✓`);
};
