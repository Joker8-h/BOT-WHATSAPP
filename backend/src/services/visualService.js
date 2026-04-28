const cloudinary = require('../config/cloudinary');
const logger = require('../utils/logger');
const { formatCOP } = require('../utils/helpers');

class VisualService {
  constructor() {
    this.baseImagePublicId = 'fantasias_ticket_v1';
    this.isInitialized = false;
  }

  /**
   * Genera una URL de Cloudinary con el texto del pedido superpuesto
   * @param {object} order - Datos del pedido { products, total, clientName, city }
   * @returns {string} URL de la imagen generada
   */
  generateOrderTicket(order) {
    const { products, total, clientName, city } = order;
    
    // Limitar productos para que quepan
    const items = products.slice(0, 5).map(p => 
      `${p.quantity}x ${p.name.substring(0, 20)}... $${formatCOP(p.price * p.quantity)}`
    ).join('%0A'); // %0A es salto de línea en URL

    // Construir transformaciones de Cloudinary (Texto superpuesto)
    // l_text:Font_Size_Style:Texto / fl_layer_apply,g_north,y_offset
    const transformations = [
      `w_600,h_900,c_fill`, // Tamaño base
      // Encabezado
      `l_text:Inter_28_bold:RESUMEN DE PEDIDO,co_rgb:FFFFFF,g_north,y_150`,
      // Nombre Cliente
      `l_text:Inter_20_bold:CLIENTE: ${clientName.toUpperCase()},co_rgb:FFD700,g_north_west,x_60,y_230`,
      // Ciudad
      `l_text:Inter_18:CIUDAD: ${city.toUpperCase()},co_rgb:FFFFFF,g_north_west,x_60,y_260`,
      // Línea divisoria
      `l_text:Inter_18:____________________________________,co_rgb:FFD700,g_north,y_290`,
      // Productos
      `l_text:Inter_18_light:${items},co_rgb:FFFFFF,g_north_west,x_60,y_340`,
      // Total
      `l_text:Inter_24_bold:TOTAL PRODUCTOS: $${formatCOP(total)},co_rgb:FFD700,g_south,y_250`,
      // Nota Envío
      `l_text:Inter_16_italic:EL ENVIO SE PAGA AL RECIBIR,co_rgb:FFFFFF,g_south,y_200`,
    ].join('/');

    // Retorna la URL final combinando la base y las transformaciones
    return `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload/${transformations}/${this.baseImagePublicId}.jpg`;
  }

  /**
   * Sube la imagen base a Cloudinary (Ejecutar una vez)
   */
  async uploadBaseImage(filePath) {
    try {
      const result = await cloudinary.uploader.upload(filePath, {
        public_id: this.baseImagePublicId,
        overwrite: true
      });
      logger.info('✅ Imagen base de Ticket subida a Cloudinary');
      this.isInitialized = true;
      return result;
    } catch (error) {
      logger.error('❌ Error subiendo imagen base:', error);
      return null;
    }
  }
}

module.exports = new VisualService();
