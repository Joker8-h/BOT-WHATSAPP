// ─────────────────────────────────────────────────────────
//  SERVICE: Email — Notificaciones vía Nodemailer
// ─────────────────────────────────────────────────────────
const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

class EmailService {
  constructor() {
    this.transporter = null;
    this.from = process.env.EMAIL_FROM || '"Chatbot Fantasías" <no-reply@fantasias.com>';
    
    // Configurar transportador (usando variables de entorno)
    if (process.env.EMAIL_HOST) {
      this.transporter = nodemailer.createTransport({
        host: process.env.EMAIL_HOST,
        port: parseInt(process.env.EMAIL_PORT) || 587,
        secure: process.env.EMAIL_SECURE === 'true',
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS,
        },
      });
    } else {
      logger.warn('⚠️ EMAIL_HOST no configurado. Los correos se mostrarán solo en consola.');
    }
  }

  /**
   * Envía un email genérico
   */
  async sendEmail(to, subject, html) {
    if (!this.transporter) {
      logger.info(`📧 [Simulación Email] Para: ${to} | Asunto: ${subject}`);
      return true;
    }

    try {
      const info = await this.transporter.sendMail({
        from: this.from,
        to,
        subject,
        html,
      });
      logger.info(`✅ Email enviado: ${info.messageId}`);
      return true;
    } catch (error) {
      logger.error('❌ Error enviando email:', error);
      return false;
    }
  }

  /**
   * Notificación de registro exitoso (esperando aprobación)
   */
  async sendWelcomeEmail(to, username, branchName) {
    const subject = '🎉 Registro Recibido - Chatbot Fantasías';
    const html = `
      <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee;">
        <h2 style="color: #d63384;">¡Hola, ${username}!</h2>
        <p>Tu solicitud para registrar la sucursal <strong>${branchName}</strong> ha sido recibida con éxito.</p>
        <p>Actualmente, tu cuenta está en proceso de revisión por nuestro administrador central.</p>
        <p>Te enviaremos otro correo en cuanto tu acceso sea habilitado para que puedas conectar tu WhatsApp y comenzar a vender.</p>
        <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="font-size: 12px; color: #777;">Este es un mensaje automático, por favor no respondas a este correo.</p>
      </div>
    `;
    return this.sendEmail(to, subject, html);
  }

  /**
   * Notificación de activación de cuenta
   */
  async sendActivationEmail(to, username) {
    const subject = '🚀 Tu cuenta ha sido habilitada - Chatbot Fantasías';
    const html = `
      <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee;">
        <h2 style="color: #198754;">¡Buenas noticias, ${username}!</h2>
        <p>Tu cuenta ha sido aprobada por el administrador.</p>
        <p>Ya puedes iniciar sesión en tu panel de control para:</p>
        <ul>
          <li>Vincular tu número de WhatsApp mediante el código QR.</li>
          <li>Subir tu catálogo de productos mediante Excel.</li>
          <li>Empezar a gestionar tus ventas automatizadas.</li>
        </ul>
        <div style="margin: 30px 0; text-align: center;">
          <a href="${process.env.ADMIN_PANEL_URL || '#'}" style="background: #d63384; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold;">Acceder a mi Dashboard</a>
        </div>
        <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="font-size: 12px; color: #777;">¡Estamos felices de acompañarte en este crecimiento!</p>
      </div>
    `;
    return this.sendEmail(to, subject, html);
  }
}

module.exports = new EmailService();
