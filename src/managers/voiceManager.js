/**
 * GESTOR DE AUDIO Y VOZ MILITAR - SARGENTO RICO (v8 - yt-dlp + FFmpeg Opus)
 *
 * Arquitectura de alto rendimiento:
 *   1. Detección inteligente de fuente:
 *      - URLs de YouTube, SoundCloud y cientos de plataformas soportadas vía yt-dlp (youtube-dl-exec)
 *      - Radios online en vivo y URLs de audio directas (.mp3, .aac, .ogg, Icecast, Shoutcast) vía FFmpeg directo
 *      - Búsquedas por palabras clave vía ytsearch (YouTube)
 *   2. Decodificación de audio a Opus 48kHz estéreo nativo mediante FFmpeg (formato Discord)
 *   3. AudioResource con control dinámico de volumen militar (inlineVolume)
 *   4. Control estricto de procesos para evitar procesos huérfanos de FFmpeg
 */

const path = require('path');
const fs   = require('fs');
const { spawn } = require('child_process');

// Inyectar ffmpeg-static en PATH para que @discordjs/voice y prism-media lo encuentren
const ffmpegPath = require('ffmpeg-static');
if (ffmpegPath) {
  process.env.FFMPEG_PATH = ffmpegPath;
  const ffmpegDir = path.dirname(ffmpegPath);
  const currentPath = process.env.PATH || '';
  if (!currentPath.includes(ffmpegDir)) {
    process.env.PATH = `${ffmpegDir}${path.delimiter}${currentPath}`;
  }
  console.log(`🛡️ [FFmpeg] Binario listo: ${ffmpegPath}`);
}

const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  NoSubscriberBehavior,
  entersState,
  StreamType
} = require('@discordjs/voice');

const youtubedl = require('youtube-dl-exec');
const config = require('../../config');

// ─────────────────────────────────────────────────────────────────────────────
// PERMISOS LINUX (HolyHosting / Pterodactyl / VPS)
// ─────────────────────────────────────────────────────────────────────────────
if (process.platform === 'linux' && ffmpegPath) {
  try {
    if (fs.existsSync(ffmpegPath)) {
      fs.chmodSync(ffmpegPath, '755');
      console.log(`🛡️ [SISTEMA LINUX] Permisos 755 aplicados a FFmpeg: ${ffmpegPath}`);
    }
  } catch (e) {
    console.warn('⚠️ [LINUX CHMOD]:', e.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS DE DETECCIÓN Y RESOLUCIÓN MULTI-URL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Determina si la URL corresponde a una transmisión directa (radio online o archivo de audio)
 * @param {string} url
 * @returns {boolean}
 */
function isDirectAudioUrl(url) {
  if (!url || typeof url !== 'string' || !url.startsWith('http')) return false;

  // Si es YouTube o SoundCloud, delegar en yt-dlp
  if (
    url.includes('youtube.com') ||
    url.includes('youtu.be') ||
    url.includes('soundcloud.com')
  ) {
    return false;
  }

  const cleanUrl = url.toLowerCase().split('?')[0];

  // Extensiones directas de audio conocidas
  const directExtensions = ['.mp3', '.ogg', '.aac', '.wav', '.flac', '.opus', '.m4a', '.m3u8'];
  if (directExtensions.some(ext => cleanUrl.endsWith(ext))) {
    return true;
  }

  // Palabras clave comunes en radios online e Icecast/Shoutcast
  if (
    url.includes('stream') ||
    url.includes('icecast') ||
    url.includes('shoutcast') ||
    url.includes('listen') ||
    url.includes('radio') ||
    url.includes('zeno.fm') ||
    url.includes(':8000') ||
    url.includes(':8080')
  ) {
    return true;
  }

  return false;
}

/**
 * Resuelve cualquier enlace (YouTube, SoundCloud, radio, archivo) o término de búsqueda.
 * @param {string} query
 * @returns {Promise<{ streamUrl: string, title: string, isDirect: boolean, webpageUrl: string }>}
 */
async function resolveAudioSource(query) {
  const isUrl = query.startsWith('http://') || query.startsWith('https://');

  // 1. Caso: URL directa de radio o archivo de audio
  if (isUrl && isDirectAudioUrl(query)) {
    console.log(`📡 [TRANSMISIÓN DIRECTA] Detectado stream directo / radio: ${query}`);
    let title = 'Transmisión Táctica Militar';
    try {
      const parsed = new URL(query);
      const filename = path.basename(parsed.pathname);
      if (filename && filename.length > 2) {
        title = decodeURIComponent(filename);
      }
    } catch {}
    return {
      streamUrl: query,
      title,
      isDirect: true,
      webpageUrl: query
    };
  }

  // 2. Caso: URL de YouTube, SoundCloud o búsqueda por palabras clave vía yt-dlp
  const targetQuery = isUrl ? query : `ytsearch1:${query}`;
  console.log(`🔍 [RESOLVIENDO] Procesando audio con yt-dlp para: "${query}"...`);

  try {
    const rawResult = await youtubedl(targetQuery, {
      dumpSingleJson: true,
      format: 'bestaudio/best',
      noWarnings: true,
      preferFreeFormats: true,
      noCheckCertificates: true
    });

    const entry = (rawResult.entries && rawResult.entries.length > 0)
      ? rawResult.entries[0]
      : rawResult;

    if (!entry) {
      throw new Error('No se encontraron resultados para la consulta militar.');
    }

    const title = entry.title || 'Transmisión Táctica';
    const webpageUrl = entry.webpage_url || query;
    let streamUrl = entry.url;

    // Si por alguna razón entry.url no viene en el dump, extraer la URL directa
    if (!streamUrl) {
      console.log('🔄 [EXTRACCIÓN SECUNDARIA] Obteniendo enlace directo...');
      streamUrl = (await youtubedl(webpageUrl, {
        getUrl: true,
        format: 'bestaudio/best',
        noWarnings: true
      })).trim();
    }

    console.log(`✅ [SEÑAL IDENTIFICADA] Título: "${title}"`);
    return {
      streamUrl,
      title,
      isDirect: false,
      webpageUrl
    };
  } catch (ytError) {
    // Si la consulta era una URL pero yt-dlp falló, intentar reproducirla directamente con FFmpeg
    if (isUrl) {
      console.warn(`⚠️ [FALLO YT-DLP, RELEVO DIRECTO]: ${ytError.message}. Intentando FFmpeg directo...`);
      return {
        streamUrl: query,
        title: 'Frecuencia de Radio Externa',
        isDirect: true,
        webpageUrl: query
      };
    }
    throw new Error(`Fallo táctico al decodificar la transmisión: ${ytError.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CLASE PRINCIPAL: VoiceStateManager
// ─────────────────────────────────────────────────────────────────────────────

class VoiceStateManager {
  constructor() {
    this.connection = null;
    this.audioPlayer = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Play }
    });
    this.currentResource = null;
    this.subscription = null;
    this.currentFFmpegProcess = null;

    this.currentTrack = null; // { title, url, requestedBy, channelName }
    this.isLooping = false;
    this.volume = config.DEFAULT_VOLUME || 0.7;
    this.status = 'idle'; // 'idle' | 'playing' | 'paused' | 'interrupted_by_tts'

    this.emptyChannelTimeout = null;
    this.retryCount = 0;
    this.lastChannel = null;
    this.intentionalDisconnect = false;

    this._setupPlayerEvents();
  }

  /**
   * Mata de forma segura el proceso FFmpeg en ejecución si existe.
   */
  _cleanupFFmpeg() {
    if (this.currentFFmpegProcess) {
      try {
        this.currentFFmpegProcess.kill('SIGKILL');
      } catch {}
      this.currentFFmpegProcess = null;
    }
  }

  _setupPlayerEvents() {
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
      this._cleanupFFmpeg();

      if (this.isLooping && this.currentTrack && this.status !== 'interrupted_by_tts') {
        try {
          const trackUrl = this.currentTrack.url;
          console.log(`🔁 [BUCLE MILITAR] Reemitiendo: "${this.currentTrack.title}"...`);
          await this._play(trackUrl, true);
        } catch (err) {
          console.error('⚠️ [ERROR BUCLE]:', err.message);
          this.status = 'idle';
        }
      } else if (this.status !== 'interrupted_by_tts') {
        this.status = 'idle';
      }
    });

    this.audioPlayer.on('error', async (error) => {
      console.error('⚠️ [ERROR REPRODUCTOR AUDIO]:', error.message);
      this._cleanupFFmpeg();

      if (this.retryCount < 1 && this.currentTrack) {
        this.retryCount++;
        console.log(`🔄 [REINTENTO TÁCTICO ${this.retryCount}/1]...`);
        try {
          await this._play(this.currentTrack.url, true);
          return;
        } catch (e) {
          console.error('⚠️ [REINTENTO FALLIDO]:', e.message);
        }
      }

      this.status = 'idle';
      this.currentTrack = null;
    });
  }

  /**
   * Conecta al canal de voz de Discord especificado.
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
      selfDeaf: true,
      selfMute: false
    });

    try {
      await entersState(this.connection, VoiceConnectionStatus.Ready, 15_000);
      console.log(`📡 [VOZ CONECTADA] Frecuencia militar lista en: "${channel.name}".`);
    } catch (e) {
      console.warn('⚠️ [AVISO CONEXIÓN VOZ]:', e.message);
    }

    this.subscription = this.connection.subscribe(this.audioPlayer);

    this.connection.on(VoiceConnectionStatus.Disconnected, async () => {
      if (this.intentionalDisconnect) return;
      console.warn('⚠️ [VOZ] Conexión interrumpida. Intentando reconexión...');
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
            console.log('✅ [VOZ] Reconexión exitosa.');
            return;
          } catch (e) {
            console.error('⚠️ [REJOIN FALLÓ]:', e.message);
          }
        }

        if (this.lastChannel && (this.status === 'playing' || this.status === 'paused')) {
          try {
            this.destroy();
            await this.connect(this.lastChannel);
            if (this.currentTrack) {
              await this._play(this.currentTrack.url, true);
            }
          } catch (e) {
            console.error('⚠️ [RESTAURACIÓN FALLÓ]:', e.message);
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
   * Método central de decodificación y reproducción de audio.
   * @param {string} query - Enlace de YouTube, SoundCloud, radio directa o búsqueda de texto
   * @param {boolean} isRetry - Indica si es un reintento automático
   * @returns {Promise<string>} Título de la pista reproducida
   */
  async _play(query, isRetry = false) {
    // 1. Limpiar FFmpeg y recurso anterior si existían
    this._cleanupFFmpeg();

    // 2. Resolver la fuente de audio (URL directa de stream y título)
    const { streamUrl, title, webpageUrl } = await resolveAudioSource(query);

    // 3. Crear proceso FFmpeg optimizado para stream Opus hacia Discord
    const ffmpegArgs = [
      '-user_agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      '-reconnect', '1',
      '-reconnect_streamed', '1',
      '-reconnect_delay_max', '5',
      '-i', streamUrl,
      '-f', 'ogg',
      '-c:a', 'libopus',
      '-ar', '48000',
      '-ac', '2',
      '-b:a', '128k',
      '-hide_banner',
      '-loglevel', 'error',
      'pipe:1'
    ];

    let ffmpegExecutable = ffmpegPath || 'ffmpeg';
    let ffmpegProcess;
    try {
      ffmpegProcess = spawn(ffmpegExecutable, ffmpegArgs, {
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (spawnErr) {
      console.warn(`⚠️ [FFmpeg inicial falló]: ${spawnErr.message}. Probando fallback 'ffmpeg'...`);
      ffmpegProcess = spawn('ffmpeg', ffmpegArgs, {
        stdio: ['ignore', 'pipe', 'pipe']
      });
    }

    this.currentFFmpegProcess = ffmpegProcess;

    ffmpegProcess.stderr.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) console.warn(`⚠️ [FFmpeg]: ${msg}`);
    });

    ffmpegProcess.on('error', (err) => {
      console.error('❌ [FFmpeg PROCESO ERROR]:', err.message);
    });

    // 4. Crear el AudioResource con stream Opus nativo en contenedor Ogg
    const resource = createAudioResource(ffmpegProcess.stdout, {
      inputType: StreamType.OggOpus,
      inlineVolume: true
    });

    if (resource.volume) {
      resource.volume.setVolume(this.volume);
    }

    this.currentResource = resource;

    if (!isRetry) {
      this.retryCount = 0;
    }

    if (this.currentTrack) {
      this.currentTrack.title = title;
      if (webpageUrl) this.currentTrack.url = webpageUrl;
    }

    // 5. Suscribir y reproducir
    if (this.connection) {
      this.subscription = this.connection.subscribe(this.audioPlayer);
    }

    this.audioPlayer.play(resource);
    console.log(`▶️ [TRANSMITIENDO] Audio activo: "${title}"`);
    return title;
  }

  // ── MÉTODOS PÚBLICOS ─────────────────────────────────────────────────────

  async playTrack(url) {
    return await this._play(url, false);
  }

  async streamAudio(url, isRetry = false) {
    return await this._play(url, isRetry);
  }

  async getTrackTitle(url) {
    try {
      const res = await resolveAudioSource(url);
      return res.title;
    } catch {
      return 'Transmisión Táctica';
    }
  }

  pauseForTTS() {
    if (this.status === 'playing') {
      this.audioPlayer.pause();
      this.status = 'interrupted_by_tts';
      return true;
    }
    return false;
  }

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

  setVolume(level) {
    const clamped = Math.max(0, Math.min(100, level));
    this.volume = clamped / 100;
    if (this.currentResource && this.currentResource.volume) {
      this.currentResource.volume.setVolume(this.volume);
    }
    return clamped;
  }

  stopAndDisconnect() {
    this.intentionalDisconnect = true;
    this.isLooping = false;
    this.currentTrack = null;
    this.status = 'idle';
    this._cleanupFFmpeg();
    this.audioPlayer.stop(true);
    this.destroy();
  }

  destroy() {
    this._cleanupFFmpeg();
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

  startEmptyChannelTimer() {
    if (this.emptyChannelTimeout) return;
    const ms = config.EMPTY_CHANNEL_TIMEOUT_MS || 120000;
    console.log(`⏱️ [AHORRO] Frecuencia solitaria. Desconectando en ${ms / 1000}s...`);
    this.emptyChannelTimeout = setTimeout(() => {
      console.log('🔌 [AHORRO] Desconectando por inactividad táctica.');
      this.stopAndDisconnect();
    }, ms);
  }

  cancelEmptyChannelTimer() {
    if (this.emptyChannelTimeout) {
      console.log('🛡️ [AHORRO] Temporizador de desconexión cancelado.');
      clearTimeout(this.emptyChannelTimeout);
      this.emptyChannelTimeout = null;
    }
  }

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

const voiceManager = new VoiceStateManager();
module.exports = voiceManager;
