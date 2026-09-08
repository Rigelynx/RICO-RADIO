/**
 * UTILIDAD DE EMBEDS MILITARES - SARGENTO RICO
 * 
 * Genera mensajes con formato militar (estilo USMC), usando colores oscuros/tácticos
 * y lenguaje estricto propio de la personalidad del Sargento Rico.
 */

const { EmbedBuilder } = require('discord.js');
const config = require('../../config');

/**
 * Crea un embed con estilo de comunicado de éxito o confirmación de orden militar.
 * @param {string} titulo - Encabezado militar
 * @param {string} descripcion - Contenido de la orden o reporte
 * @returns {EmbedBuilder}
 */
function createSuccessEmbed(titulo, descripcion) {
  return new EmbedBuilder()
    .setColor(config.COLORS.TACTICAL_GREEN)
    .setTitle(`🎖️ [ORDEN CONFIRMADA] ${titulo}`)
    .setDescription(descripcion)
    .setFooter({ text: 'Sargento Rico • Cuerpo de Marines (USMC) | Base de Operaciones' })
    .setTimestamp();
}

/**
 * Crea un embed con estilo de alerta o infracción disciplinaria/error.
 * @param {string} titulo - Título de la alerta militar
 * @param {string} descripcion - Motivo del fallo o problema
 * @returns {EmbedBuilder}
 */
function createErrorEmbed(titulo, descripcion) {
  return new EmbedBuilder()
    .setColor(config.COLORS.USMC_RED)
    .setTitle(`⚠️ [ALERTA DE FALLO] ${titulo}`)
    .setDescription(descripcion)
    .setFooter({ text: 'Sargento Rico • Protocolo de Emergencia USMC' })
    .setTimestamp();
}

/**
 * Crea un embed para advertencias o estados en pausa / espera.
 * @param {string} titulo - Título de la advertencia
 * @param {string} descripcion - Detalle de la situación táctica
 * @returns {EmbedBuilder}
 */
function createWarningEmbed(titulo, descripcion) {
  return new EmbedBuilder()
    .setColor(config.COLORS.GOLD)
    .setTitle(`🛡️ [COMUNICADO TÁCTICO] ${titulo}`)
    .setDescription(descripcion)
    .setFooter({ text: 'Sargento Rico • Red de Frecuencia Táctica' })
    .setTimestamp();
}

/**
 * Crea un embed detallado para el estado actual de la radio (/sargento-rico nowplaying).
 * @param {Object} data - Información de la pista
 * @returns {EmbedBuilder}
 */
function createNowPlayingEmbed({ title, url, status, loop, volume, channelName, requestedBy }) {
  const statusEmoji = status === 'playing' ? '▶️ REPRODUCIENDO' : status === 'paused' ? '⏸️ EN PAUSA' : '⏹️ DETENIDO';

  return new EmbedBuilder()
    .setColor(config.COLORS.TACTICAL_GREEN)
    .setTitle('📻 [ESTACIÓN DE RADIO MILITAR - NOW PLAYING]')
    .setDescription(`**Transmisión Actual:**\n[${title}](${url})\n`)
    .addFields(
      { name: '📡 Estado de Frecuencia', value: `\`${statusEmoji}\``, inline: true },
      { name: '🔄 Bucle Militar', value: loop ? '`ACTIVADO (Repetición continua)`' : '`DESACTIVADO`', inline: true },
      { name: '🔊 Potencia de Audio', value: `\`${volume}%\``, inline: true },
      { name: '🔊 Canal de Voz Asignado', value: channelName ? `\`${channelName}\`` : '`Ninguno`', inline: true },
      { name: '🎖️ Operador de Radio', value: requestedBy ? `${requestedBy}` : '`Comando Central`', inline: true }
    )
    .setFooter({ text: 'Sargento Rico • Sistema Táctico de Audio USMC' })
    .setTimestamp();
}

module.exports = {
  createSuccessEmbed,
  createErrorEmbed,
  createWarningEmbed,
  createNowPlayingEmbed
};
