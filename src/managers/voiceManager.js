/**
 * GESTOR DE AUDIO Y VOZ MILITAR - SARGENTO RICO
 * 
 * Administra la conexión a canales de voz mediante @discordjs/voice y youtube-dl-exec.
 * Diseñado para hostings de bajos recursos:
 * - Evita duplicación de conexiones.
 * - Desconexión automática tras 2 minutos con el canal vacío.
 * - Reintento automático de 1 intento ante fallos de conexión o streaming.
 * - Soporte para bucle (loop) infinito y control de volumen.
 * - Soporte para pausar la música cuando entra una transmisión TTS y reanudarla después.
 */

const path = require('path');
const fs = require('fs');
const ffmpegPath = require('ffmpeg-static');
if (ffmpegPath) {
  process.env.FFMPEG_PATH = ffmpegPath;
  const ffmpegDir = path.dirname(ffmpegPath);
  process.env.PATH = `${ffmpegDir}${path.delimiter}${process.env.PATH}`;
}

const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  StreamType
} = require('@discordjs/voice');
// youtube-dl-exec: wrapper robusto de yt-dlp para obtener URLs de audio de YouTube
const youtubedl = require('youtube-dl-exec');
const config = require('../../config');
const storageManager = require('./storageManager');
const { createSuccessEmbed, createErrorEmbed, createWarningEmbed } = require('../utils/militaryEmbeds');

// Asegurar permisos de ejecución de yt-dlp en contenedores Linux (HolyHosting/Pterodactyl)
if (process.platform === 'linux') {
  try {
    const candidatePaths = [
      path.join(process.cwd(), 'node_modules', 'youtube-dl-exec', 'bin', 'yt-dlp'),
      path.join(process.cwd(), 'node_modules', 'youtube-dl-exec', 'bin', 'yt-dlp.linux')
    ];
    for (const binP of candidatePaths) {
      if (fs.existsSync(binP)) {
        fs.chmodSync(binP, '755');
        console.log(`🛡️ [SISTEMA LINUX] Permisos 755 otorgados a yt-dlp en: ${binP}`);
      }
    }
  } catch (e) {
    console.warn('⚠️ [LINUX CHMOD] No se pudieron aplicar permisos a yt-dlp:', e.message);
  }
}

/**
 * Busca si existe un archivo de cookies de YouTube en la raíz o en .env
 * @returns {string|null}
 */
function getYoutubeCookiesPath() {
  const customPath = process.env.YOUTUBE_COOKIES_PATH;
  if (customPath && fs.existsSync(customPath)) {
    return customPath;
  }
  const defaultPath = path.join(process.cwd(), 'cookies.txt');
  if (fs.existsSync(defaultPath)) {
    return defaultPath;
  }
  return null;
}

/**
 * Obtiene la URL de audio directa de un video de YouTube via yt-dlp usando getUrl.
 * Si YouTube bloquea la IP del hosting con "Sign in to confirm you are not a bot",
 * el Sargento Rico conmuta automáticamente al canal de relevo táctico (SoundCloud)
 * para garantizar reproducción continua sin interrupciones ni caídas.
 * @param {string} inputQuery 
 * @returns {Promise<{url: string, title: string}>}
 */
async function getYoutubeAudioUrl(inputQuery) {
  const cookiesPath = getYoutubeCookiesPath();
  const isDirectUrl = inputQuery.startsWith('http');
  const target = isDirectUrl ? inputQuery : `ytsearch1:${inputQuery}`;

  if (cookiesPath) {
    console.log(`🍪 [YOUTUBE AUTH] Empleando archivo de cookies táctico: ${cookiesPath}`);
  }

  // 1. Obtener título oficial de YouTube via API pública oEmbed (nunca es bloqueada por datacenters)
  let title = 'Transmisión Táctica Militar';
  if (inputQuery.includes('youtube.com') || inputQuery.includes('youtu.be')) {
    try {
      const oembedRes = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(inputQuery)}&format=json`);
      if (oembedRes.ok) {
        const oembed = await oembedRes.json();
        if (oembed.title) title = oembed.title;
      }
    } catch {}
  } else if (!isDirectUrl) {
    title = inputQuery;
  }

  // 2. Estrategias de extracción de YouTube
  const strategies = [
    { format: 'ba/b', noCheckCertificates: true, ...(cookiesPath ? { cookies: cookiesPath } : {}) },
    { format: 'ba/b', noCheckCertificates: true },
    { format: 'bestaudio/best', noCheckCertificates: true },
    { extractorArgs: 'youtube:player-client=android,web', noCheckCertificates: true },
    { noCheckCertificates: true }
  ];

  let audioUrl = null;

  for (const strat of strategies) {
    try {
      const raw = await youtubedl(target, { getUrl: true, ...strat });
      const lines = String(raw).trim().split('\n');
      const foundUrl = lines.find(l => l.trim().startsWith('http'));
      if (foundUrl) {
        audioUrl = foundUrl.trim();
        break;
      }
    } catch {}
  }

  if (audioUrl) {
    return { url: audioUrl, title };
  }

  // 3. RELEVO TÁCTICO AUTOMÁTICO (SoundCloud)
  // Si YouTube bloqueó la IP del datacenter de HolyHosting, buscar y transmitir el mismo tema desde SoundCloud
  console.warn(`📡 [RELEVO TÁCTICO MILITAR] YouTube bloqueó la IP del hosting. Conectando a la frecuencia alternativa (SoundCloud) para: "${title}"...`);

  try {
    const scQuery = `scsearch1:${title}`;
    const rawSc = await youtubedl(scQuery, { getUrl: true, noCheckCertificates: true });
    const lines = String(rawSc).trim().split('\n');
    const scFoundUrl = lines.find(l => l.trim().startsWith('http'));

    if (scFoundUrl) {
      console.log(`✅ [RELEVO EXITOSO] Frecuencia alternativa sincronizada para: "${title}"`);
      return {
        url: scFoundUrl.trim(),
        title: `${title} 📻 [Frecuencia de Respaldo]`
      };
    }
  } catch (scErr) {
    console.error('⚠️ [ERROR RELEVO SOUNDCLOUD]:', scErr.message);
  }

  throw new Error(
    'YouTube ha bloqueado la IP del hosting y la frecuencia de respaldo no pudo sintonizar la pista. ' +
    'Intenta buscar la canción escribiendo su nombre directamente en el comando: /sargento-rico play url: "nombre de la canción"'
  );
}

// Estructura en memoria del estado de voz por servidor (Single Guild)
class VoiceStateManager {
  constructor() {
    this.connection = null;
    this.audioPlayer = createAudioPlayer();
    this.currentResource = null;
    this.subscription = null;

    // Metadatos de la reproducción actual
    this.currentTrack = null; // { title, url, requestedBy, channelName }
    this.isLooping = false;
    this.volume = config.DEFAULT_VOLUME; // 0.0 a 1.0 (70% por defecto)
    this.status = 'idle'; // 'idle', 'playing', 'paused', 'interrupted_by_tts'

    // Temporizadores de ahorro de recursos
    this.emptyChannelTimeout = null;
    this.retryCount = 0;

    // Inicializar listeners del reproductor
    this.setupPlayerEvents();
  }

  setupPlayerEvents() {
    this.audioPlayer.on(AudioPlayerStatus.Playing, () => {
      this.status = 'playing';
      this.retryCount = 0; // Resetear reintentos tras iniciar reproducción exitosa
    });

    this.audioPlayer.on(AudioPlayerStatus.Paused, () => {
      if (this.status !== 'interrupted_by_tts') {
        this.status = 'paused';
      }
    });

    this.audioPlayer.on(AudioPlayerStatus.Idle, async () => {
      // Si la música terminó de forma natural y está en bucle
      if (this.isLooping && this.currentTrack && this.status !== 'interrupted_by_tts') {
        try {
          await this.streamAudio(this.currentTrack.url, true);
        } catch (error) {
          console.error('⚠️ [ERROR BUCLE] No se pudo repetir la pista:', error.message);
          this.status = 'idle';
        }
      } else if (this.status !== 'interrupted_by_tts') {
        this.status = 'idle';
      }
    });

    this.audioPlayer.on('error', async (error) => {
      console.error('⚠️ [ERROR REPRODUCTOR]', error.message);

      // Reintento automático de 1 intento antes de fallar
      if (this.retryCount < 1 && this.currentTrack) {
        this.retryCount++;
        console.log(`🔄 [REINTENTO MILITAR] Reintentando transmisión (Intento ${this.retryCount}/1)...`);
        try {
          await this.streamAudio(this.currentTrack.url, true);
          return;
        } catch (retryError) {
          console.error('⚠️ [ERROR REINTENTO]', retryError.message);
        }
      }

      this.status = 'idle';
      this.currentTrack = null;
    });
  }

  /**
   * Conecta al bot al canal de voz especificado.
   * @param {import('discord.js').VoiceBasedChannel} channel 
   */
  connect(channel) {
    // Si ya estamos conectados al mismo canal, reutilizar
    if (this.connection && this.connection.state.status !== VoiceConnectionStatus.Destroyed) {
      if (this.connection.joinConfig.channelId === channel.id) {
        return this.connection;
      }
    }

    // Guardar referencia del canal para posibles reconexiones automáticas
    this.lastChannel = channel;
    this.intentionalDisconnect = false;

    this.connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: true // Ensordecerse para ahorrar ancho de banda
    });

    this.subscription = this.connection.subscribe(this.audioPlayer);

    // SISTEMA DE AUTO-RECONEXIÓN ANTE CAÍDAS O CAMBIOS DE SERVIDOR DE DISCORD
    this.connection.on(VoiceConnectionStatus.Disconnected, async (oldState, newState) => {
      // Si fue una desconexión intencional (ej: /sargento-rico stop), no reconectar
      if (this.intentionalDisconnect) return;

      console.warn('⚠️ [ALERTA DE VOZ] Conexión interrumpida con Discord. Intentando reconexión táctica...');

      try {
        // Discord suele reconectar solo si cambia de región el canal de voz
        await Promise.race([
          entersState(this.connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(this.connection, VoiceConnectionStatus.Connecting, 5_000)
        ]);
        console.log('✅ [RECONEXIÓN] Reconectado a la señal de Discord con éxito.');
      } catch {
        // Si no se reconectó en 5s, verificar si fue expulsión o micro-corte de red
        if (this.connection && this.connection.state.status !== VoiceConnectionStatus.Destroyed) {
          try {
            console.log('🔄 [REINTENTO CONEXIÓN] Reintentando unirse al canal de voz táctico...');
            this.connection.rejoin();
            await entersState(this.connection, VoiceConnectionStatus.Ready, 5_000);
            console.log('✅ [RECONEXIÓN] ¡Voz restablecida exitosamente!');
            return;
          } catch (rejoinErr) {
            console.error('⚠️ [FALLO REJOIN]', rejoinErr.message);
          }
        }

        // Si falló el socket actual, crear una conexión limpia si todavía tenemos la pista activa
        if (this.lastChannel && (this.status === 'playing' || this.status === 'paused')) {
          console.log('🛠️ [RESTAURACIÓN] Creando nueva sesión de voz limpia para continuar la transmisión...');
          try {
            this.destroy();
            this.connect(this.lastChannel);
            if (this.currentTrack && this.status === 'playing') {
              await this.streamAudio(this.currentTrack.url, true);
            }
          } catch (cleanErr) {
            console.error('⚠️ [ERROR RESTAURACIÓN]', cleanErr.message);
            this.destroy();
          }
        } else {
          this.destroy();
        }
      }
    });

    return this.connection;
  }

  /**
   * Reproduce una URL (YouTube o stream directo mp3/aac) o el audio por defecto.
   * @param {string} url - URL del audio (puede ser YouTube o URL directa)
   * @param {boolean} isRetry - Indica si es una llamada de reintento
   */
  async streamAudio(url, isRetry = false) {
    let resource;

    const isYouTube = url.includes('youtube.com') || url.includes('youtu.be');

    if (isYouTube) {
      // Obtener URL directa del audio vía youtube-dl-exec (yt-dlp)
      const { url: audioUrl } = await getYoutubeAudioUrl(url);
      resource = createAudioResource(audioUrl, {
        inputType: StreamType.Arbitrary,
        inlineVolume: true
      });
    } else {
      // URL directa de audio (mp3, aac, stream de radio, etc.)
      resource = createAudioResource(url, {
        inputType: StreamType.Arbitrary,
        inlineVolume: true
      });
    }

    // Configurar nivel de volumen inicial
    if (resource.volume) {
      resource.volume.setVolume(this.volume);
    }

    this.currentResource = resource;
    this.audioPlayer.play(resource);

    if (!isRetry) {
      this.retryCount = 0;
    }
  }

  /**
   * Método principal para iniciar reproducción desde un comando de usuario.
   * Para YouTube: resuelve URL de audio Y título en una sola llamada a yt-dlp.
   * Para URLs directas: inicia stream directamente y usa la URL como título.
   * @param {string} url - URL de YouTube o URL directa de audio
   * @returns {Promise<string>} - Título de la pista
   */
  async playTrack(url) {
    const isYouTube = url.includes('youtube.com') || url.includes('youtu.be');

    if (isYouTube) {
      // Una sola llamada a yt-dlp para obtener URL de audio y título
      const { url: audioUrl, title } = await getYoutubeAudioUrl(url);
      const resource = createAudioResource(audioUrl, {
        inputType: StreamType.Arbitrary,
        inlineVolume: true
      });
      if (resource.volume) {
        resource.volume.setVolume(this.volume);
      }
      this.currentResource = resource;
      this.retryCount = 0;
      this.audioPlayer.play(resource);
      return title;
    } else {
      // URL directa: reproducir sin consulta externa
      const resource = createAudioResource(url, {
        inputType: StreamType.Arbitrary,
        inlineVolume: true
      });
      if (resource.volume) {
        resource.volume.setVolume(this.volume);
      }
      this.currentResource = resource;
      this.retryCount = 0;
      this.audioPlayer.play(resource);
      return 'Transmisión Táctica Militar (Audio)';
    }
  }

  /**
   * Obtiene metadatos legibles del título de la pista via youtube-dl-exec.
   * @param {string} url 
   * @returns {Promise<string>}
   */
  async getTrackTitle(url) {
    try {
      if (url.includes('youtube.com') || url.includes('youtu.be')) {
        const { title } = await getYoutubeAudioUrl(url);
        return title || 'Transmisión Táctica Militar (Audio)';
      }
    } catch {
      // Si falla obtener metadatos, usar nombre genérico
    }
    return 'Transmisión Táctica Militar (Audio)';
  }

  /**
   * Pausa la música actual para permitir que suene una transmisión TTS.
   */
  pauseForTTS() {
    if (this.status === 'playing') {
      this.audioPlayer.pause();
      this.status = 'interrupted_by_tts';
      return true;
    }
    return false;
  }

  /**
   * Reanuda la música que fue pausada por un TTS.
   */
  resumeAfterTTS() {
    if (this.status === 'interrupted_by_tts') {
      if (this.connection && this.audioPlayer) {
        this.subscription = this.connection.subscribe(this.audioPlayer);
      }
      this.audioPlayer.unpause();
      this.status = 'playing';
      return true;
    }
    return false;
  }

  /**
   * Ajusta el volumen (0 a 100).
   * @param {number} level 
   */
  setVolume(level) {
    const clampedLevel = Math.max(0, Math.min(100, level));
    this.volume = clampedLevel / 100;
    if (this.currentResource && this.currentResource.volume) {
      this.currentResource.volume.setVolume(this.volume);
    }
    return clampedLevel;
  }

  /**
   * Detiene el audio, limpia recursos y desconecta al bot.
   */
  stopAndDisconnect() {
    this.intentionalDisconnect = true;
    this.isLooping = false;
    this.currentTrack = null;
    this.status = 'idle';
    this.audioPlayer.stop(true);
    this.destroy();
  }

  /**
   * Destruye la conexión de voz de forma segura.
   */
  destroy() {
    if (this.emptyChannelTimeout) {
      clearTimeout(this.emptyChannelTimeout);
      this.emptyChannelTimeout = null;
    }
    if (this.connection) {
      try {
        this.connection.destroy();
      } catch {}
      this.connection = null;
    }
    this.subscription = null;
    this.status = 'idle';
    this.currentTrack = null;
  }

  /**
   * Inicia el temporizador de 2 minutos para desconectar si no hay miembros en el canal de voz.
   */
  startEmptyChannelTimer() {
    if (this.emptyChannelTimeout) return;

    const timeoutMs = config.EMPTY_CHANNEL_TIMEOUT_MS || 120000;
    console.log(`⏱️ [AHORRO RECURSOS] Canal de voz vacío. Desconexión en ${timeoutMs / 1000}s...`);

    this.emptyChannelTimeout = setTimeout(() => {
      console.log('🔌 [AHORRO RECURSOS] Desconectando bot por inactividad en canal de voz.');
      this.stopAndDisconnect();
    }, timeoutMs);
  }

  /**
   * Cancela el temporizador si alguien entra al canal.
   */
  cancelEmptyChannelTimer() {
    if (this.emptyChannelTimeout) {
      console.log('🛡️ [AHORRO RECURSOS] Miembro detectado en canal de voz. Temporizador cancelado.');
      clearTimeout(this.emptyChannelTimeout);
      this.emptyChannelTimeout = null;
    }
  }

  /**
   * Retorna información del estado actual para el comando nowplaying y la web.
   */
  getState() {
    return {
      status: this.status,
      isLooping: this.isLooping,
      volumePercent: Math.round(this.volume * 100),
      currentTrack: this.currentTrack,
      isConnected: this.connection !== null && this.connection.state.status !== VoiceConnectionStatus.Destroyed
    };
  }
}

// Instancia única (Singleton) para el servidor
const voiceManager = new VoiceStateManager();

module.exports = voiceManager;
