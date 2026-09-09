/**
 * CONFIGURACIÓN GENERAL DEL BOT - SARGENTO RICO
 * 
 * En este archivo se definen los valores por defecto del sistema militar.
 * Puedes modificarlos fácilmente según los nombres de rangos y preferencias de tu servidor.
 */

require('dotenv').config();

module.exports = {
  // Credenciales cargadas desde el archivo .env
  TOKEN: process.env.DISCORD_TOKEN || '',
  CLIENT_ID: process.env.CLIENT_ID || '',
  GUILD_ID: process.env.GUILD_ID || '',

  // Puerto y clave de seguridad del panel web táctico
  WEB_PORT: parseInt(process.env.PORT, 10) || 3000,
  WEB_ADMIN_KEY: process.env.WEB_ADMIN_KEY || 'sargento123',

  // Audio militar por defecto si el usuario escribe /sargento-rico play sin link
  // Enlace directo en MP3 de alta disponibilidad (compatible con Holy Hosting sin bloqueos de YouTube)
  DEFAULT_AUDIO_URL: 'https://ia800301.us.archive.org/15/items/TheMarinesHymn_583/TheMarinesHymn.mp3',

  // Nombre del rol militar mínimo requerido para usar comandos de configuración (tts-canal, tts-toggle, tts-idioma)
  // El bot busca este rol en el servidor y compara la jerarquía numérica de roles.
  MINIMUM_ADMIN_ROLE_NAME: 'Sargento',

  // Idioma inicial por defecto para el sintetizador de voz (node-gtts)
  DEFAULT_TTS_LANG: 'es',

  // Tiempo en milisegundos antes de que el bot se desconecte si el canal de voz queda vacío (2 minutos = 120000 ms)
  // Esto ahorra memoria RAM y CPU en tu hosting barato.
  EMPTY_CHANNEL_TIMEOUT_MS: 2 * 60 * 1000,

  // Límite máximo de caracteres por mensaje para la auto-lectura del chat
  MAX_TTS_CHARS: 200,

  // Volumen inicial del reproductor de audio (0.0 a 1.0 -> 0.7 = 70%)
  DEFAULT_VOLUME: 0.7,

  // Colores temáticos USMC para los embeds de respuesta
  COLORS: {
    USMC_RED: 0x8B0000,      // Rojo escarlata militar (errores, alertas, acciones estrictas)
    TACTICAL_GREEN: 0x2E4A2E,// Verde militar táctico (éxito, transmisiones, confirmaciones)
    GOLD: 0xD4AF37,          // Dorado / Ámbar (advertencias, estado en pausa)
    DARK_CHARCOAL: 0x1A1D1A  // Carbón oscuro militar
  }
};
