/**
 * GESTOR DE AUDIO Y VOZ MILITAR - SARGENTO RICO (v10 - yt-dlp auto-install + FFmpeg Opus)
 *
 * Arquitectura robusta multi-entorno:
 *   1. youtube-dl-exec (yt-dlp) → YouTube, SoundCloud, búsquedas por texto
 *      → En Linux (HolyHosting): binario descargado automáticamente de GitHub
 *      → En Windows: usa el yt-dlp.exe incluido en node_modules
 *   2. FFmpeg  → Convierte el stream a Opus 48kHz para Discord
 *   3. URLs directas → Radios online, Icecast, Shoutcast, archivos mp3/ogg etc.
 */

const path   = require('path');
const fs     = require('fs');
const { spawn } = require('child_process');

// ─── FFMPEG ────────────────────────────────────────────────────────────────────
const ffmpegStatic = require('ffmpeg-static');

function isCompatibleFfmpegBinary(binaryPath) {
  try {
    const header = Buffer.alloc(4);
    const descriptor = fs.openSync(binaryPath, 'r');
    fs.readSync(descriptor, header, 0, header.length, 0);
    fs.closeSync(descriptor);

    if (process.platform === 'linux') return header.toString('hex') === '7f454c46';
    if (process.platform === 'win32') return header.subarray(0, 2).toString() === 'MZ';
    return true;
  } catch {
    return false;
  }
}

function resolveFfmpegPath() {
  if (ffmpegStatic && fs.existsSync(ffmpegStatic)) {
    if (!isCompatibleFfmpegBinary(ffmpegStatic)) {
      console.warn('[FFmpeg] El binario de ffmpeg-static no coincide con este sistema. Usando ffmpeg del sistema.');
      return 'ffmpeg';
    }
    if (process.platform === 'linux') {
      try { fs.chmodSync(ffmpegStatic, '755'); } catch {}
    }
    return ffmpegStatic;
  }
  return 'ffmpeg';
}

const ffmpegPath = resolveFfmpegPath();

if (ffmpegPath !== 'ffmpeg') {
  process.env.FFMPEG_PATH = ffmpegPath;
  const ffmpegDir = path.dirname(ffmpegPath);
  if (!(process.env.PATH || '').includes(ffmpegDir)) {
    process.env.PATH = `${ffmpegDir}${path.delimiter}${process.env.PATH || ''}`;
  }
}
console.log(`🛡️ [FFmpeg] Ejecutable: ${ffmpegPath}`);

// ─── DISCORD VOICE ────────────────────────────────────────────────────────────
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

// ─── FUENTES DE AUDIO ────────────────────────────────────────────────────────
const youtubedl = require('youtube-dl-exec');
const { ensureYtDlpBinary } = require('../utils/ytdlpInstaller');

// La primera reproducción espera a que el binario esté listo. Así no se intenta
// usar el ejecutable incluido para otro sistema operativo durante el arranque.
let ytdlpExecutor = youtubedl;
const ytdlpReady = ensureYtDlpBinary()
  .then(binPath => {
    const { create } = require('youtube-dl-exec');
    ytdlpExecutor = create(binPath);
    console.log(`🎯 [yt-dlp] Binario activo: ${binPath}`);
  })
  .catch(error => {
    console.warn('⚠️ [yt-dlp] Advertencia al resolver binario:', error.message);
  });

const config = require('../../config');

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS DE DETECCIÓN
// ─────────────────────────────────────────────────────────────────────────────

function isYouTubeUrl(url) {
  return url.includes('youtube.com') || url.includes('youtu.be');
}

function isSoundCloudUrl(url) {
  return url.includes('soundcloud.com');
}

/**
 * Determina si la URL es una radio online o archivo de audio directo.
 * @param {string} url
 * @returns {boolean}
 */
function isDirectAudioUrl(url) {
  if (!url || typeof url !== 'string' || !url.startsWith('http')) return false;
  if (isYouTubeUrl(url) || isSoundCloudUrl(url)) return false;

  const cleanUrl = url.toLowerCase().split('?')[0];
  const directExtensions = ['.mp3', '.ogg', '.aac', '.wav', '.flac', '.opus', '.m4a', '.m3u8'];
  if (directExtensions.some(ext => cleanUrl.endsWith(ext))) return true;

  if (
    url.includes('stream') ||
    url.includes('icecast') ||
    url.includes('shoutcast') ||
    url.includes('listen') ||
    url.includes('radio') ||
    url.includes('zeno.fm') ||
    url.includes(':8000') ||
    url.includes(':8080')
  ) return true;

  return false;
}

/**
 * Resuelve la fuente de audio y retorna una URL de stream lista para FFmpeg.
 * - URLs de YouTube/SoundCloud → yt-dlp extrae la URL directa del stream
 * - Búsquedas de texto → yt-dlp busca en YouTube y extrae la URL
 * - URLs directas (radios, .mp3) → se pasan directamente a FFmpeg
 *
 * @param {string} query
 * @returns {Promise<{ streamUrl: string, title: string, webpageUrl: string }>}
 */
async function resolveAudioSource(query) {
  const isUrl = query.startsWith('http://') || query.startsWith('https://');

  // ── CASO 1: URL directa de radio o archivo de audio ────────────────────────
  if (isUrl && isDirectAudioUrl(query)) {
    console.log(`📡 [TRANSMISIÓN DIRECTA] Stream/radio: ${query}`);
    let title = 'Transmisión Táctica Militar';
    try {
      const filename = path.basename(new URL(query).pathname);
      if (filename && filename.length > 2) title = decodeURIComponent(filename);
    } catch {}
    return { streamUrl: query, title, webpageUrl: query };
  }

  // ── CASO 2: YouTube, SoundCloud o búsqueda vía yt-dlp ─────────────────────
  const targetQuery = isUrl ? query : `ytsearch1:${query}`;
  console.log(`🔍 [RESOLVIENDO] yt-dlp procesando: "${query}"...`);

  // Opciones base para youtube-dl-exec
  const ytdlpOptions = {
    dumpSingleJson: true,
    format: 'bestaudio/best',
    noWarnings: true,
    preferFreeFormats: true,
    noCheckCertificates: true
  };

  try {
    await ytdlpReady;
    const rawResult = await ytdlpExecutor(targetQuery, ytdlpOptions);

    const entry = (rawResult.entries && rawResult.entries.length > 0)
      ? rawResult.entries[0]
      : rawResult;

    if (!entry) throw new Error('Sin resultados.');

    const title      = entry.title || 'Transmisión Táctica';
    const webpageUrl = entry.webpage_url || query;
    let streamUrl    = entry.url;

    if (!streamUrl) {
      console.log('🔄 [EXTRACCIÓN URL] Obteniendo enlace directo...');
      const rawUrl = await ytdlpExecutor(webpageUrl, {
        getUrl: true,
        format: 'bestaudio/best',
        noWarnings: true
      });
      streamUrl = (typeof rawUrl === 'string' ? rawUrl : rawUrl.toString()).trim();
    }

    console.log(`✅ [SEÑAL] Título: "${title}"`);
    return { streamUrl, title, webpageUrl };

  } catch (ytError) {
    if (isUrl) {
      console.warn(`⚠️ [FALLO YT-DLP → DIRECTO]: ${ytError.message}. Intentando FFmpeg directo...`);
      return { streamUrl: query, title: 'Frecuencia de Radio Externa', webpageUrl: query };
    }
    throw new Error(`Error al resolver audio: ${ytError.message}`);
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
      console.log('🔊 [AUDIO ENVIÁNDOSE] El reproductor está en estado PLAYING y transmitiendo paquetes.');
    });

    this.audioPlayer.on(AudioPlayerStatus.Buffering, () => {
      console.log('⏳ [BUFFERING] Preparando búfer de audio...');
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
      selfDeaf: false,
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

    // 2. Resolver la fuente de audio
    const { streamUrl, title, webpageUrl } = await resolveAudioSource(query);

    // 3. Crear proceso FFmpeg: convierte el stream a Opus 48kHz para Discord
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

    // 4. Lanzar FFmpeg
    let ffmpegProcess;
    try {
      ffmpegProcess = spawn(ffmpegPath, ffmpegArgs, {
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (spawnErr) {
      console.warn(`⚠️ [FFmpeg falló con ${ffmpegPath}]: ${spawnErr.message}. Probando 'ffmpeg' del sistema...`);
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

    ffmpegProcess.on('close', (code) => {
      if (code !== 0 && code !== null) {
        console.warn(`⚠️ [FFmpeg] Proceso cerrado con código: ${code}`);
      }
    });

    // 5. Crear AudioResource con stream Opus nativo en contenedor Ogg
    const resource = createAudioResource(ffmpegProcess.stdout, {
      inputType: StreamType.OggOpus,
      inlineVolume: true
    });

    if (resource.volume) {
      resource.volume.setVolume(this.volume);
    }

    this.currentResource = resource;

    if (!isRetry) this.retryCount = 0;

    if (this.currentTrack) {
      this.currentTrack.title = title;
      if (webpageUrl) this.currentTrack.url = webpageUrl;
    }

    // 6. Suscribir y reproducir
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
