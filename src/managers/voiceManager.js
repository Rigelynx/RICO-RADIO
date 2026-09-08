/**
 * GESTOR DE AUDIO Y VOZ MILITAR - SARGENTO RICO (v4 - FFmpeg Pipe)
 *
 * Estrategia de reproducción:
 *   1. yt-dlp --get-url → obtiene URL directa del audio (rápido, sin datos)
 *   2. FFmpeg spawn → decodifica la URL a PCM 48kHz y hace pipe a @discordjs/voice
 *   3. Si YouTube bloquea la IP, UN SOLO intento en SoundCloud (sin bucle)
 *
 * Esta es la misma estrategia de DisTube, discord-player y bots de producción.
 */

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

// Resolver ruta de ffmpeg-static e inyectarla en el PATH del proceso
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

const youtubedl = require('youtube-dl-exec');
const config = require('../../config');
const { createSuccessEmbed, createErrorEmbed, createWarningEmbed } = require('../utils/militaryEmbeds');

// ─────────────────────────────────────────────────────────────────────────────
// PERMISOS LINUX (HolyHosting / Pterodactyl)
// ─────────────────────────────────────────────────────────────────────────────
if (process.platform === 'linux') {
  try {
    const candidatePaths = [
      path.join(process.cwd(), 'node_modules', 'youtube-dl-exec', 'bin', 'yt-dlp'),
      path.join(process.cwd(), 'node_modules', 'youtube-dl-exec', 'bin', 'yt-dlp.linux'),
      path.join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg')
    ];
    for (const binP of candidatePaths) {
      if (fs.existsSync(binP)) {
        fs.chmodSync(binP, '755');
        console.log(`🛡️ [SISTEMA LINUX] Permisos 755 otorgados en: ${binP}`);
      }
    }
  } catch (e) {
    console.warn('⚠️ [LINUX CHMOD] No se pudieron aplicar permisos:', e.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS INTERNOS
// ─────────────────────────────────────────────────────────────────────────────

/** Retorna la ruta del archivo cookies.txt si existe */
function getYoutubeCookiesPath() {
  const customPath = process.env.YOUTUBE_COOKIES_PATH;
  if (customPath && fs.existsSync(customPath)) return customPath;
  const defaultPath = path.join(process.cwd(), 'cookies.txt');
  if (fs.existsSync(defaultPath)) return defaultPath;
  return null;
}

/**
 * Obtiene solo el título de una pista (sin descargar audio).
 * Para URLs de YouTube usa oEmbed. Para búsquedas de texto usa yt-dlp --dump-json.
 * @param {string} query
 * @returns {Promise<string>}
 */
async function fetchTitle(query) {
  const isUrl = query.startsWith('http');

  if (isUrl && (query.includes('youtube.com') || query.includes('youtu.be'))) {
    try {
      const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(query)}&format=json`);
      if (res.ok) {
        const data = await res.json();
        if (data.title) return data.title;
      }
    } catch {}
  }

  if (!isUrl) {
    try {
      const cookiesPath = getYoutubeCookiesPath();
      const result = await youtubedl(`ytsearch1:${query}`, {
        dumpSingleJson: true,
        noWarnings: true,
        noCallHome: true,
        noCheckCertificates: true,
        ...(cookiesPath ? { cookies: cookiesPath } : {})
      });
      if (result && result.title) return result.title;
    } catch {}
    return query;
  }

  return 'Transmisión Táctica Militar';
}

/**
 * Obtiene la URL directa del stream de audio via yt-dlp --get-url.
 * NO descarga ni hace pipe de datos de audio — solo devuelve la URL.
 * @param {string} target - URL o prefijo ytsearch1:/scsearch1:
 * @param {object} extraArgs - Argumentos extra para yt-dlp
 * @returns {Promise<string>} URL directa del audio
 */
async function getDirectAudioUrl(target, extraArgs = {}) {
  const cookiesPath = getYoutubeCookiesPath();
  if (cookiesPath) {
    console.log(`🍪 [YOUTUBE AUTH] Usando cookies: ${cookiesPath}`);
  }

  const args = {
    getUrl: true,
    format: 'ba/b',
    noWarnings: true,
    noCheckCertificates: true,
    noCallHome: true,
    ...(cookiesPath ? { cookies: cookiesPath } : {}),
    ...extraArgs
  };

  const raw = await youtubedl(target, args);
  const lines = String(raw).trim().split('\n');
  const found = lines.find(l => l.trim().startsWith('http'));
  if (!found) throw new Error('yt-dlp no devolvió una URL de audio válida');
  return found.trim();
}

/**
 * Crea un AudioResource usando FFmpeg para decodificar la URL directa.
 * FFmpeg lee desde la URL (HTTP), decodifica y escribe PCM s16le a su stdout.
 * @discordjs/voice lee el PCM y lo encoda a Opus para Discord.
 *
 * Esta es la misma técnica que usa DisTube y discord-player internamente.
 *
 * @param {string} audioUrl - URL directa del audio (obtenida de yt-dlp)
 * @returns {import('@discordjs/voice').AudioResource}
 */
function createFfmpegResource(audioUrl) {
  const ffmpegBin = process.env.FFMPEG_PATH || 'ffmpeg';

  const ffmpegArgs = [
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_delay_max', '5',
    '-i', audioUrl,
    '-analyzeduration', '0',
    '-loglevel', 'error',
    '-f', 's16le',    // PCM signed 16-bit little-endian
    '-ar', '48000',   // 48kHz (requerido por Discord)
    '-ac', '2',       // Estéreo
    'pipe:1'          // Output a stdout
  ];

  const ffmpegProcess = spawn(ffmpegBin, ffmpegArgs, {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  // Capturar stderr de FFmpeg para diagnóstico (solo en errores)
  let ffmpegStderr = '';
  ffmpegProcess.stderr.on('data', (chunk) => { ffmpegStderr += chunk.toString(); });
  ffmpegProcess.on('exit', (code) => {
    if (code !== 0 && ffmpegStderr) {
      console.warn(`⚠️ [FFMPEG EXIT ${code}]:`, ffmpegStderr.slice(0, 300));
    }
  });

  const resource = createAudioResource(ffmpegProcess.stdout, {
    inputType: StreamType.Raw,  // PCM s16le = StreamType.Raw
    inlineVolume: true
  });

  // Guardar referencia al proceso para poder matarlo al parar
  resource._ffmpegProcess = ffmpegProcess;

  return resource;
}

/**
 * Resuelve audio de YouTube (o SoundCloud como fallback) y crea un AudioResource.
 * - Paso 1: yt-dlp --get-url (rápido, sin datos de audio)
 * - Paso 2: FFmpeg spawn con la URL obtenida
 * - Si YouTube falla → UN SOLO intento en SoundCloud (sin bucle)
 *
 * @param {string} query - URL de YouTube o término de búsqueda
 * @returns {Promise<{resource: import('@discordjs/voice').AudioResource, title: string, source: string}>}
 */
async function resolveAudioStream(query) {
  const isUrl = query.startsWith('http');
  const ytTarget = isUrl ? query : `ytsearch1:${query}`;

  const title = await fetchTitle(query);

  // ── Intento 1: YouTube ──
  try {
    console.log(`🎵 [BUSCANDO] "${title}" en YouTube...`);
    const audioUrl = await getDirectAudioUrl(ytTarget);
    const resource = createFfmpegResource(audioUrl);
    console.log(`✅ [YOUTUBE] Stream listo: "${title}"`);
    return { resource, title, source: 'youtube' };
  } catch (ytErr) {
    console.warn(`⚠️ [YOUTUBE BLOQUEADO] ${ytErr.message}`);
  }

  // ── Intento 2: SoundCloud (UNA sola vez, sin reintentos) ──
  console.warn(`📡 [RELEVO TÁCTICO] Conectando a SoundCloud para: "${title}"...`);
  try {
    const audioUrl = await getDirectAudioUrl(`scsearch1:${title}`, { format: 'bestaudio/best' });
    const resource = createFfmpegResource(audioUrl);
    console.log(`✅ [SOUNDCLOUD] Stream listo: "${title}"`);
    return { resource, title: `${title} 📻`, source: 'soundcloud' };
  } catch (scErr) {
    console.error(`❌ [SOUNDCLOUD FALLIDO]: ${scErr.message}`);
  }

  throw new Error(
    `No se pudo reproducir "${title}". YouTube bloqueó la IP y SoundCloud tampoco respondió. ` +
    `Intenta con otro título o una URL directa de audio (mp3/stream de radio).`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CLASE PRINCIPAL: GESTOR DE ESTADO DE VOZ
// ─────────────────────────────────────────────────────────────────────────────
class VoiceStateManager {
  constructor() {
    this.connection = null;
    this.audioPlayer = createAudioPlayer();
    this.currentResource = null;
    this.subscription = null;

    this.currentTrack = null; // { title, url, requestedBy, channelName }
    this.isLooping = false;
    this.volume = config.DEFAULT_VOLUME;
    this.status = 'idle'; // 'idle' | 'playing' | 'paused' | 'interrupted_by_tts'

    this.emptyChannelTimeout = null;
    this.retryCount = 0;
    this.lastChannel = null;
    this.intentionalDisconnect = false;

    this.setupPlayerEvents();
  }

  /** Configura los eventos del AudioPlayer */
  setupPlayerEvents() {
    this.audioPlayer.on(AudioPlayerStatus.Playing, () => {
      this.status = 'playing';
      this.retryCount = 0;
    });

    this.audioPlayer.on(AudioPlayerStatus.Paused, () => {
      if (this.status !== 'interrupted_by_tts') {
        this.status = 'paused';
      }
    });

    this.audioPlayer.on(AudioPlayerStatus.Idle, async () => {
      if (this.isLooping && this.currentTrack && this.status !== 'interrupted_by_tts') {
        try {
          await this._play(this.currentTrack.url, true);
        } catch (err) {
          console.error('⚠️ [ERROR BUCLE]:', err.message);
          this.status = 'idle';
        }
      } else if (this.status !== 'interrupted_by_tts') {
        this.status = 'idle';
      }
    });

    this.audioPlayer.on('error', async (error) => {
      console.error('⚠️ [ERROR REPRODUCTOR]:', error.message);
      this._killCurrentProcess();

      if (this.retryCount < 1 && this.currentTrack) {
        this.retryCount++;
        console.log(`🔄 [REINTENTO] Intento ${this.retryCount}/1...`);
        try {
          await this._play(this.currentTrack.url, true);
          return;
        } catch (retryErr) {
          console.error('⚠️ [REINTENTO FALLIDO]:', retryErr.message);
        }
      }

      this.status = 'idle';
      this.currentTrack = null;
    });
  }

  /** Mata el proceso FFmpeg/yt-dlp activo si existe */
  _killCurrentProcess() {
    if (this.currentResource) {
      if (this.currentResource._ffmpegProcess) {
        try { this.currentResource._ffmpegProcess.kill(); } catch {}
      }
      if (this.currentResource._ytProcess) {
        try { this.currentResource._ytProcess.kill(); } catch {}
      }
    }
  }

  /**
   * Conecta el bot al canal de voz.
   * @param {import('discord.js').VoiceBasedChannel} channel
   */
  async connect(channel) {
    if (this.connection && this.connection.state.status !== VoiceConnectionStatus.Destroyed) {
      if (this.connection.joinConfig.channelId === channel.id) {
        this.subscription = this.connection.subscribe(this.audioPlayer);
        return this.connection;
      }
    }

    this.lastChannel = channel;
    this.intentionalDisconnect = false;

    this.connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: true
    });

    try {
      await entersState(this.connection, VoiceConnectionStatus.Ready, 15_000);
      console.log(`📡 [VOZ LISTA] Conexión UDP establecida en "${channel.name}".`);
    } catch (e) {
      console.warn('⚠️ [AVISO VOZ]:', e.message);
    }

    this.subscription = this.connection.subscribe(this.audioPlayer);

    this.connection.on(VoiceConnectionStatus.Disconnected, async () => {
      if (this.intentionalDisconnect) return;
      console.warn('⚠️ [ALERTA VOZ] Conexión interrumpida. Reconectando...');
      try {
        await Promise.race([
          entersState(this.connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(this.connection, VoiceConnectionStatus.Connecting, 5_000)
        ]);
      } catch {
        if (this.connection && this.connection.state.status !== VoiceConnectionStatus.Destroyed) {
          try {
            this.connection.rejoin();
            await entersState(this.connection, VoiceConnectionStatus.Ready, 5_000);
            console.log('✅ [RECONEXIÓN] Voz restablecida.');
            return;
          } catch (rejoinErr) {
            console.error('⚠️ [FALLO REJOIN]:', rejoinErr.message);
          }
        }
        if (this.lastChannel && (this.status === 'playing' || this.status === 'paused')) {
          try {
            this.destroy();
            await this.connect(this.lastChannel);
            if (this.currentTrack) await this._play(this.currentTrack.url, true);
          } catch (err) {
            console.error('⚠️ [ERROR RESTAURACIÓN]:', err.message);
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
   * Método interno de reproducción: resuelve la fuente y la reproduce.
   * @param {string} query - URL de YouTube, URL directa, o búsqueda de texto
   * @param {boolean} isRetry
   * @returns {Promise<string>} Título de la pista
   */
  async _play(query, isRetry = false) {
    this._killCurrentProcess();

    const isDirectStream =
      query.startsWith('http') &&
      !query.includes('youtube.com') &&
      !query.includes('youtu.be') &&
      !query.includes('soundcloud.com');

    let resource, title;

    if (isDirectStream) {
      // Radio / MP3 directo: FFmpeg puede leerlo directamente
      resource = createFfmpegResource(query);
      title = 'Transmisión de Radio Táctica';
    } else {
      const resolved = await resolveAudioStream(query);
      resource = resolved.resource;
      title = resolved.title;
    }

    if (resource.volume) {
      resource.volume.setVolume(this.volume);
    }

    resource.playStream.on('error', (err) => {
      console.error('⚠️ [ERROR STREAM]:', err.message);
    });

    this.currentResource = resource;
    if (!isRetry) this.retryCount = 0;

    if (this.connection) {
      this.subscription = this.connection.subscribe(this.audioPlayer);
    }

    this.audioPlayer.play(resource);
    return title;
  }

  // ── API pública ──────────────────────────────────────────────────────────

  /** Inicia la reproducción desde un comando de usuario */
  async playTrack(url) {
    return await this._play(url, false);
  }

  /** Alias para compatibilidad interna (bucle, reconexión) */
  async streamAudio(url, isRetry = false) {
    return await this._play(url, isRetry);
  }

  /** Obtiene el título de una pista sin reproducirla */
  async getTrackTitle(url) {
    try {
      return await fetchTitle(url);
    } catch {
      return 'Transmisión Táctica Militar';
    }
  }

  /** Pausa la música para ceder paso a un TTS */
  pauseForTTS() {
    if (this.status === 'playing') {
      this.audioPlayer.pause();
      this.status = 'interrupted_by_tts';
      return true;
    }
    return false;
  }

  /** Reanuda la música pausada por TTS */
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

  /** Ajusta el volumen (0–100) */
  setVolume(level) {
    const clamped = Math.max(0, Math.min(100, level));
    this.volume = clamped / 100;
    if (this.currentResource && this.currentResource.volume) {
      this.currentResource.volume.setVolume(this.volume);
    }
    return clamped;
  }

  /** Detiene reproducción y desconecta el bot */
  stopAndDisconnect() {
    this.intentionalDisconnect = true;
    this.isLooping = false;
    this._killCurrentProcess();
    this.currentTrack = null;
    this.status = 'idle';
    this.audioPlayer.stop(true);
    this.destroy();
  }

  /** Destruye la conexión de voz de forma segura */
  destroy() {
    if (this.emptyChannelTimeout) {
      clearTimeout(this.emptyChannelTimeout);
      this.emptyChannelTimeout = null;
    }
    if (this.connection) {
      try { this.connection.destroy(); } catch {}
      this.connection = null;
    }
    this.subscription = null;
    this.status = 'idle';
    this.currentTrack = null;
  }

  /** Inicia el temporizador de desconexión por canal vacío */
  startEmptyChannelTimer() {
    if (this.emptyChannelTimeout) return;
    const ms = config.EMPTY_CHANNEL_TIMEOUT_MS || 120000;
    console.log(`⏱️ [AHORRO] Canal vacío. Desconexión en ${ms / 1000}s...`);
    this.emptyChannelTimeout = setTimeout(() => {
      console.log('🔌 [AHORRO] Desconectando por inactividad.');
      this.stopAndDisconnect();
    }, ms);
  }

  /** Cancela el temporizador si alguien vuelve al canal */
  cancelEmptyChannelTimer() {
    if (this.emptyChannelTimeout) {
      console.log('🛡️ [AHORRO] Miembro detectado. Temporizador cancelado.');
      clearTimeout(this.emptyChannelTimeout);
      this.emptyChannelTimeout = null;
    }
  }

  /** Estado actual del reproductor */
  getState() {
    return {
      status: this.status,
      isLooping: this.isLooping,
      volumePercent: Math.round(this.volume * 100),
      currentTrack: this.currentTrack,
      isConnected: this.connection !== null &&
        this.connection.state.status !== VoiceConnectionStatus.Destroyed
    };
  }
}

// Singleton para el servidor
const voiceManager = new VoiceStateManager();

module.exports = voiceManager;
