/**
 * GESTOR DE ALMACENAMIENTO PERSISTENTE - SARGENTO RICO
 * 
 * Guarda y recupera la configuración del bot (canal TTS, activación, idioma, rol mínimo)
 * en un archivo JSON local (data/config.json).
 * Utiliza una copia en memoria (caché) para no desgastar el disco ni consumir CPU innecesaria
 * en hostings de bajos recursos.
 */

const fs = require('fs');
const path = require('path');
const config = require('../../config');

const CONFIG_FILE_PATH = path.join(__dirname, '..', '..', 'data', 'config.json');

// Configuración por defecto de respaldo
const DEFAULT_PERSISTENT_DATA = {
  ttsChannelId: null,
  ttsEnabled: true,
  ttsLang: config.DEFAULT_TTS_LANG || 'es',
  minRoleName: config.MINIMUM_ADMIN_ROLE_NAME || 'Sargento',
  defaultAudioUrl: config.DEFAULT_AUDIO_URL,
  emptyTimeoutMinutes: 2
};

// Caché en memoria para acceso ultra rápido
let cachedConfig = null;

/**
 * Carga la configuración desde el disco o inicializa con los valores por defecto si no existe.
 * @returns {Object} Configuración actual
 */
function loadConfig() {
  if (cachedConfig) return cachedConfig;

  try {
    const dir = path.dirname(CONFIG_FILE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (fs.existsSync(CONFIG_FILE_PATH)) {
      const rawData = fs.readFileSync(CONFIG_FILE_PATH, 'utf-8');
      cachedConfig = { ...DEFAULT_PERSISTENT_DATA, ...JSON.parse(rawData) };
    } else {
      cachedConfig = { ...DEFAULT_PERSISTENT_DATA };
      fs.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(cachedConfig, null, 2), 'utf-8');
    }
  } catch (error) {
    console.error('⚠️ [ERROR STORAGE] No se pudo leer config.json, usando valores por defecto:', error.message);
    cachedConfig = { ...DEFAULT_PERSISTENT_DATA };
  }

  return cachedConfig;
}

/**
 * Obtiene la configuración actual en memoria.
 * @returns {Object}
 */
function getConfig() {
  return loadConfig();
}

/**
 * Actualiza uno o más valores de configuración y los persiste en disco.
 * @param {Object} newValues - Objeto con las propiedades a actualizar
 * @returns {Object} Configuración actualizada
 */
function updateConfig(newValues) {
  loadConfig();
  cachedConfig = { ...cachedConfig, ...newValues };

  try {
    fs.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(cachedConfig, null, 2), 'utf-8');
  } catch (error) {
    console.error('⚠️ [ERROR STORAGE] Fallo al guardar en config.json:', error.message);
  }

  return cachedConfig;
}

module.exports = {
  getConfig,
  updateConfig
};
