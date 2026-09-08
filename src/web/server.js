/**
 * SERVIDOR WEB DEL PANEL TÁCTICO - SARGENTO RICO
 * 
 * Servidor Express ligero integrado en el mismo proceso del bot.
 * Permite monitorear el estado, cambiar el rol militar mínimo, el canal de TTS,
 * el idioma y ver los comandos equivalentes de Discord.
 */

const express = require('express');
const path = require('path');
const config = require('../../config');
const storageManager = require('../managers/storageManager');
const voiceManager = require('../managers/voiceManager');

/**
 * Inicializa el servidor web táctico.
 * @param {import('discord.js').Client} client - Cliente de Discord activo
 */
function startWebServer(client) {
  const app = express();
  const port = config.WEB_PORT || 3000;

  // Middleware para parsear JSON
  app.use(express.json());

  // Servir archivos estáticos del panel web
  app.use(express.static(path.join(__dirname, 'public')));

  // ==========================================
  // RUTAS DE LA API REST
  // ==========================================

  // 1. Estado del bot y del reproductor de voz
  app.get('/api/status', (req, res) => {
    const voiceState = voiceManager.getState();
    const isBotReady = client && client.isReady();

    res.json({
      bot: {
        online: isBotReady,
        tag: isBotReady ? client.user.tag : 'Desconectado',
        ping: isBotReady ? client.ws.ping : 0,
        guildCount: isBotReady ? client.guilds.cache.size : 0
      },
      voice: voiceState
    });
  });

  // 2. Obtener configuración persistente actual
  app.get('/api/config', (req, res) => {
    const currentConfig = storageManager.getConfig();
    res.json(currentConfig);
  });

  // 3. Guardar cambios en la configuración (con verificación de clave de seguridad)
  app.post('/api/config', (req, res) => {
    const providedKey = req.headers['x-admin-key'];
    const requiredKey = config.WEB_ADMIN_KEY;

    if (requiredKey && providedKey !== requiredKey) {
      return res.status(401).json({
        success: false,
        message: 'Clave de acceso militar no autorizada. Acceso denegado.'
      });
    }

    const { ttsChannelId, ttsEnabled, ttsLang, minRoleName, defaultAudioUrl } = req.body;
    const updates = {};

    if (ttsChannelId !== undefined) updates.ttsChannelId = ttsChannelId;
    if (ttsEnabled !== undefined) updates.ttsEnabled = Boolean(ttsEnabled);
    if (ttsLang !== undefined) updates.ttsLang = String(ttsLang);
    if (minRoleName !== undefined) updates.minRoleName = String(minRoleName);
    if (defaultAudioUrl !== undefined) updates.defaultAudioUrl = String(defaultAudioUrl);

    const newConfig = storageManager.updateConfig(updates);

    res.json({
      success: true,
      message: 'Configuración militar actualizada y sincronizada en tiempo real.',
      config: newConfig
    });
  });

  // 4. Obtener roles del servidor de Discord (para el selector de jerarquía)
  app.get('/api/roles', async (req, res) => {
    try {
      if (!client.isReady()) {
        return res.json([]);
      }

      const guildId = config.GUILD_ID;
      const guild = client.guilds.cache.get(guildId) || client.guilds.cache.first();

      if (!guild) {
        return res.json([]);
      }

      await guild.roles.fetch();
      const roles = guild.roles.cache
        .filter(role => role.name !== '@everyone')
        .sort((a, b) => b.position - a.position)
        .map(role => ({
          id: role.id,
          name: role.name,
          position: role.position,
          color: role.hexColor
        }));

      res.json(roles);
    } catch (error) {
      console.error('⚠️ [ERROR API ROLES]:', error.message);
      res.status(500).json({ error: 'Fallo al obtener roles del servidor' });
    }
  });

  // 5. Obtener canales de texto del servidor (para el selector de TTS)
  app.get('/api/channels', async (req, res) => {
    try {
      if (!client.isReady()) {
        return res.json([]);
      }

      const guildId = config.GUILD_ID;
      const guild = client.guilds.cache.get(guildId) || client.guilds.cache.first();

      if (!guild) {
        return res.json([]);
      }

      await guild.channels.fetch();
      const channels = guild.channels.cache
        .filter(ch => ch.isTextBased() && !ch.isVoiceBased() && !ch.isThread())
        .map(ch => ({
          id: ch.id,
          name: ch.name
        }));

      res.json(channels);
    } catch (error) {
      console.error('⚠️ [ERROR API CANALES]:', error.message);
      res.status(500).json({ error: 'Fallo al obtener canales de texto' });
    }
  });

  // Iniciar escucha del servidor HTTP vinculando a 0.0.0.0 para acceso externo
  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`🌐 [PANEL TÁCTICO WEB] Servidor en línea en el puerto ${port}`);
    console.log(`🔗 Acceso local: http://localhost:${port}`);
    console.log(`🔗 Acceso desde tu navegador (Hosting): Usa la IP/dominio de tu host con el puerto :${port}`);
  });

  return server;
}

module.exports = {
  startWebServer
};
