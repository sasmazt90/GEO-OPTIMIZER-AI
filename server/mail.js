// Outgoing email over SMTP (IONOS or any other provider).
import nodemailer from 'nodemailer'

export function createMailer({ host = '', port = 587, user = '', pass = '', from = '', transport = null } = {}) {
  const enabled = Boolean(transport || (host && user && pass))
  const sender = from || (user ? `GEO Optimizer AI <${user}>` : '')
  let cached = transport
  const connection = () => {
    // Port 465 uses TLS from the start; 587 upgrades with STARTTLS.
    cached ||= nodemailer.createTransport({ host, port: Number(port) || 587, secure: Number(port) === 465, requireTLS: Number(port) !== 465, auth: { user, pass }, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000 })
    return cached
  }
  return {
    enabled,
    sender,
    async send({ to, subject, text, html }) {
      if (!enabled) throw new Error('Email is not configured')
      return connection().sendMail({ from: sender, to, subject: String(subject).replace(/[\r\n]+/g, ' ').slice(0, 200), text, html })
    },
  }
}
