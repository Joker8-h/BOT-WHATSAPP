const logger = require('../utils/logger');

class PaymentController {
  async paymentSuccess(req, res) {
    res.send(`
      <!DOCTYPE html>
      <html lang="es">
      <head><meta charset="UTF-8"><title>¡Pago Exitoso! - Fantasías</title>
      <style>body{font-family:system-ui;display:flex;justify-content:center;align-items:center;min-height:100vh;background:linear-gradient(135deg,#1a0a2e,#2d1b4e);color:white;margin:0}
      .card{text-align:center;padding:3rem;border-radius:20px;background:rgba(255,255,255,0.1);backdrop-filter:blur(10px)}
      h1{font-size:2rem}p{opacity:0.8;font-size:1.1rem}</style></head>
      <body><div class="card">
        <h1>✅ ¡Pago exitoso!</h1>
        <p>Gracias por tu compra en <strong>Fantasías</strong>.</p>
        <p>Recibirás confirmación por WhatsApp.</p>
        <p style="margin-top:2rem;font-size:0.9rem;opacity:0.6">Puedes cerrar esta ventana</p>
      </div></body></html>
    `);
  }

  async paymentCancel(req, res) {
    res.send(`
      <!DOCTYPE html>
      <html lang="es">
      <head><meta charset="UTF-8"><title>Pago Cancelado - Fantasías</title>
      <style>body{font-family:system-ui;display:flex;justify-content:center;align-items:center;min-height:100vh;background:linear-gradient(135deg,#2e0a0a,#4e1b1b);color:white;margin:0}
      .card{text-align:center;padding:3rem;border-radius:20px;background:rgba(255,255,255,0.1);backdrop-filter:blur(10px)}
      h1{font-size:2rem}p{opacity:0.8;font-size:1.1rem}</style></head>
      <body><div class="card">
        <h1>❌ Pago cancelado</h1>
        <p>No te preocupes, no se realizó ningún cargo.</p>
        <p>Escríbenos por WhatsApp si necesitas ayuda 😊</p>
      </div></body></html>
    `);
  }
}

module.exports = new PaymentController();
