'use strict';
/**
 * Sending e-mail for password reset codes. Configured only from the server environment:
 *   SMTP_HOST, SMTP_PORT (default 587), SMTP_USER, SMTP_PASS, MAIL_FROM (default SMTP_USER)
 * Any SMTP service works (Gmail with an app password, Brevo, Mailgun, Resend SMTP ...).
 * For local development only, MAIL_TRANSPORT=console prints the message instead of sending it (refused in production).
 * Returns null when nothing is configured, which turns the reset feature off.
 */

function createMailer(env = process.env, log = console) {
  if (env.SMTP_HOST) {
    const port = Number(env.SMTP_PORT) || 587;
    const transport = require('nodemailer').createTransport({
      host: env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS || '' } : undefined,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    });
    const from = env.MAIL_FROM || env.SMTP_USER;
    if (!from) return null;
    return { kind: 'smtp', send: ({ to, subject, text }) => transport.sendMail({ from, to, subject, text }) };
  }
  if (env.MAIL_TRANSPORT === 'console' && env.NODE_ENV !== 'production') {
    return { kind: 'console', send: async ({ to, subject, text }) => { log.log(`[mail:console] To: ${to}\nSubject: ${subject}\n${text}`); } };
  }
  return null;
}

module.exports = { createMailer };
