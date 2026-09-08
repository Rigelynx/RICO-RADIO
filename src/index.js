/**
 * PUNTO DE ENTRADA PRINCIPAL - BOT SARGENTO RICO (USMC)
 * 
 * Inicializa el cliente de Discord con discord.js v14, escucha los eventos principales
 * (comandos slash, auto-lectura de chat y monitoreo de canal de voz vacío para ahorro de recursos)
 * y enciende el servidor web del panel táctico.
 */

require('dotenv').config();
const ffmpegPath = require('ffmpeg-static');
if (ffmpegPath) {
  process.env.FFMPEG_PATH = ffmpegPath;
}
const { Client, GatewayIntentBits, ActivityType, ChannelType } = require('discord.js');
const config = require('../config');
const { handleSlashCommand } = require('./handlers/commandRouter');
const voiceManager = require('./managers/voiceManager');
const ttsManager = require('./managers/ttsManager');
const storageManager = require('./managers/storageManager');
const { startWebServer } = require('./web/server');
const { data: sargentoCommandData } = require('./commands/sargentoRico');
const { createWarningEmbed } = require('./utils/militaryEmbeds');

// Bandera para avisar solo una vez en el canal si el bot no está en voz
let hasWarnedDisconnected = false;

// 1. CREACIÓN DEL CLIENTE DE DISCORD
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,             // Gestión básica del servidor
    GatewayIntentBits.GuildVoiceStates,   // Detección de canales de voz y usuarios conectados
    GatewayIntentBits.GuildMessages,      // Recepción de mensajes para auto-lectura
    GatewayIntentBits.MessageContent      // Privilegiado: Lectura del contenido de los mensajes
  ]
});

// 2. EVENTO READY (BOT CONECTADO)
client.once('ready', async () => {
  console.log('====================================================');
  console.log(`🫡 ¡SARGENTO RICO REPORTÁNDOSE AL SERVICIO MILITAR!`);
  console.log(`🎖️ Conectado como: ${client.user.tag}`);
  console.log(`📡 Servidores vigilados: ${client.guilds.cache.size}`);
  console.log('====================================================');

  // Auto-registro de comandos slash en los servidores conectados (disponibilidad instantánea)
  try {
    console.log('📡 [COMANDOS] Desplegando comandos slash (/sargento-rico)...');
    for (const guild of client.guilds.cache.values()) {
      await guild.commands.set([sargentoCommandData]);
      console.log(`🎖️ [COMANDOS] ¡Comandos activados exitosamente en: ${guild.name}!`);
    }
  } catch (err) {
    console.error('⚠️ [ERROR REGISTRO COMANDOS]:', err.message);
  }

  // Estado militar en Discord
  client.user.setActivity('Frecuencia USMC • /sargento-rico', {
    type: ActivityType.Listening
  });

  // Iniciar el servidor web táctico
  startWebServer(client);
});

// 3. EVENTO INTERACTION CREATE (COMANDOS SLASH)
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  await handleSlashCommand(interaction);
});

// 4. EVENTO MESSAGE CREATE (AUTO-LECTURA DEL CHAT VÍA TTS)
client.on('messageCreate', async (message) => {
  // Regla 1: Ignorar mensajes de bots (incluyendo a sí mismo para evitar bucles infinitos)
  if (message.author.bot) return;

  // Regla 2: Ignorar mensajes que sean comandos (empiezan con / o !)
  if (message.content.startsWith('/') || message.content.startsWith('!')) return;

  const currentConfig = storageManager.getConfig();

  // Regla 3: Comprobar si la auto-lectura está activada
  if (!currentConfig.ttsEnabled) return;

  // Regla 5: Comprobar si el bot está conectado a algún canal de voz en este servidor
  const botVoiceChannel = message.guild.members.me?.voice?.channel;

  // ---- MODO 1: CHAT INTEGRADO DEL CANAL DE VOZ ----
  // Si el mensaje viene del chat de texto integrado en un canal de voz (GuildVoice),
  // y el bot está conectado exactamente a ese mismo canal, leerlo automáticamente
  // sin necesidad de configurar ttsChannelId.
  const isVoiceChannelChat = message.channel.type === ChannelType.GuildVoice ||
                             message.channel.type === ChannelType.GuildStageVoice;

  if (isVoiceChannelChat) {
    // Solo leer si el bot está conectado a ese canal de voz específico
    if (!botVoiceChannel || botVoiceChannel.id !== message.channel.id) return;
    // El bot está en ese canal de voz: proceder a leer (saltar al bloque de lectura)
  } else {
    // ---- MODO 2: CANAL DE TEXTO VIGILADO (configuración ttsChannelId) ----
    // Regla 4: Comprobar si el mensaje proviene del canal de texto vigilado configurado
    if (!currentConfig.ttsChannelId || message.channel.id !== currentConfig.ttsChannelId) return;

    if (!botVoiceChannel) {
      // Si no está conectado a voz, avisar solo una única vez para no saturar el canal de texto
      if (!hasWarnedDisconnected) {
        hasWarnedDisconnected = true;
        await message.channel.send({
          embeds: [
            createWarningEmbed(
              'SILENCIO DE RADIO',
              '⚠️ El Sargento Rico no puede transmitir este comunicado por voz porque **no está conectado a ningún canal de voz**.\n' +
              'Usa `/sargento-rico play` o `/sargento-rico decir` para que el Sargento ingrese a tu frecuencia de voz.'
            )
          ]
        }).catch(() => {});
      }
      return;
    }
  }

  // Si está conectado a voz, resetear la bandera de aviso
  hasWarnedDisconnected = false;

  // Regla 6: Control de longitud de mensaje (máximo 200 caracteres para no saturar la radio)
  let textToRead = message.cleanContent.trim();
  if (!textToRead) return;

  const userNickname = message.member?.displayName || message.author.username;

  if (textToRead.length > config.MAX_TTS_CHARS) {
    textToRead = textToRead.substring(0, config.MAX_TTS_CHARS) + '... comunicado recortado por orden del Sargento.';
  }

  const fullBroadcastText = `${userNickname} dice: ${textToRead}`;

  try {
    // Pasar a la cola del gestor de TTS (pausará la música, hablará y la reanudará)
    await ttsManager.speak(fullBroadcastText, botVoiceChannel);
  } catch (error) {
    console.error('⚠️ [ERROR AUTO-TTS]:', error.message);
  }
});

// 5. EVENTO VOICE STATE UPDATE (AHORRO DE RECURSOS - CANAL VACÍO)
client.on('voiceStateUpdate', (oldState, newState) => {
  const guild = oldState.guild || newState.guild;
  const botVoiceChannel = guild.members.me?.voice?.channel;

  if (!botVoiceChannel) return;

  // Contar cuántos miembros que NO sean bots quedan en el canal
  const humanMembers = botVoiceChannel.members.filter(m => !m.user.bot);

  if (humanMembers.size === 0) {
    // Canal vacío: iniciar cuenta atrás de 2 minutos para desconectar
    voiceManager.startEmptyChannelTimer();
  } else {
    // Hay soldados en el canal: cancelar temporizador
    voiceManager.cancelEmptyChannelTimer();
  }
});

// 6. APAGADO SEGURO
process.on('SIGINT', () => {
  console.log('\n🛑 [APAGADO] Desconectando al Sargento Rico...');
  voiceManager.stopAndDisconnect();
  client.destroy();
  process.exit(0);
});

// Iniciar sesión con el token de Discord
const token = config.TOKEN;
if (!token) {
  console.error('❌ [ERROR FATAL] DISCORD_TOKEN no está definido en el archivo .env.');
  console.log('Por favor completa el archivo .env con tus credenciales.');
} else {
  client.login(token).catch(err => {
    console.error('❌ [ERROR LOGIN DISCORD]', err.message);
  });
}
