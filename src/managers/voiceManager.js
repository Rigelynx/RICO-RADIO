/**
 * GESTOR DE AUDIO Y VOZ MILITAR - SARGENTO RICO (v7 - play-dl)
 *
 * Arquitectura de producción estándar (como Groovy, Rythm, SinusBot):
 *   play.stream(url/query) → stream.stream + stream.type
 *   → createAudioResource(stream.stream, { inputType: stream.type })
 *   → audioPlayer.play(resource)
 *
 * play-dl maneja internamente:
 *   - YouTube (con cookies y rotación de IPs)
 *   - SoundCloud (búsqueda y streaming directo)
 *   - Autenticación, throttling, formatos y reconexiones
 *   - Devuelve el StreamType correcto (Opus/Arbitrary) sin que tengamos que adivinar
 *
 * SIN verificación de bytes, SIN PassThrough, SIN pipes manuales.
 */

const path = require('path');
const fs   = require('fs');

// Inyectar ffmpeg-static en PATH para que @discordjs/voice lo encuentre
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
  NoSubscriberBehavior,
  entersState,
  StreamType
} = require('@discordjs/voice');

const play = require('play-dl');
const config = require('../../config');
const { createSuccessEmbed, createErrorEmbed, createWarningEmbed } = require('../utils/militaryEmbeds');

// ─────────────────────────────────────────────────────────────────────────────
// PERMISOS LINUX (HolyHosting / Pterodactyl)
// ─────────────────────────────────────────────────────────────────────────────
if (process.platform === 'linux') {
  try {
    const ffmpegBin = path.join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg');
    if (fs.existsSync(ffmpegBin)) {
      fs.chmodSync(ffmpegBin, '755');
      console.log(`🛡️ [SISTEMA LINUX] Permisos 755: ${ffmpegBin}`);
    }
  } catch (e) {
    console.warn('⚠️ [LINUX CHMOD]:', e.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Obtiene el título de una pista.
 * YouTube URL → play.video_info. Búsqueda → play.search.
 */
async function fetchTitle(query) {
  const isUrl = query.startsWith('http');

  try {
    if (isUrl) {
      const type = play.yt_validate(query);
      if (type === 'video') {
        const info = await play.video_info(query);
        return info?.video_details?.title || 'Transmisión Táctica';
      }
    } else {
      // Buscar en YouTube primero
      const results = await play.search(query, { source: { youtube: 'video' }, limit: 1 });
      if (results.length > 0) return results[0].title || query;
    }
  } catch {}

  return query;
}

/**
 * Crea un AudioResource usando play-dl.
 * Intenta YouTube primero, luego SoundCloud como fallback.
 *
 * @param {string} query           - URL de YouTube o término de búsqueda de texto
 * @param {string} preferredSource - 'youtube' | 'soundcloud'
 * @returns {Promise<{ resource: AudioResource, title: string, source: string }>}
 */
async function resolveStream(query, preferredSource = 'youtube') {
  const isUrl = query.startsWith('http');
  let title = await fetchTitle(query);

  // ── Si la última fuente que funcionó fue SoundCloud, intentarla primero ──
  if (preferredSource === 'soundcloud') {
    try {
      const cleanTitle = title.replace(' 📻', '');
      console.log(`🎵 [LOOP] Renovando stream de SoundCloud para: "${cleanTitle}"...`);
      const scResults = await play.search(cleanTitle, {
        source: { soundcloud: 'tracks' },
        limit: 1
      });
      if (scResults.length === 0) throw new Error('Sin resultados en SoundCloud');
      const scStream = await play.stream(scResults[0].url);
      const resource = createAudioResource(scStream.stream, {
        inputType: scStream.type,
        inlineVolume: true
      });
      console.log(`✅ [SOUNDCLOUD] Stream listo: "${cleanTitle}"`);
      return { resource, title, source: 'soundcloud' };
    } catch (e) {
      console.warn(`⚠️ [SOUNDCLOUD] Falló: ${e.message}. Intentando YouTube...`);
    }
  }

  // ── Intento YouTube ──
  try {
    console.log(`🎵 [BUSCANDO] "${title}" en YouTube...`);
    let ytUrl;
    if (isUrl && (query.includes('youtube.com') || query.includes('youtu.be'))) {
      ytUrl = query;
    } else {
      const ytResults = await play.search(query, { source: { youtube: 'video' }, limit: 1 });
      if (ytResults.length === 0) throw new Error('Sin resultados en YouTube');
      ytUrl = ytResults[0].url;
      title = ytResults[0].title || title;
    }
    const ytStream = await play.stream(ytUrl);
    const resource = createAudioResource(ytStream.stream, {
      inputType: ytStream.type,
      inlineVolume: true
    });
    console.log(`✅ [YOUTUBE] Stream listo: "${title}"`);
    return { resource, title, source: 'youtube' };
  } catch (ytErr) {
    console.warn(`⚠️ [YOUTUBE] Falló: ${ytErr.message}`);
  }

  // ── Fallback SoundCloud ──
  if (preferredSource !== 'soundcloud') {
    console.warn(`📡 [RELEVO TÁCTICO] Conectando a SoundCloud para: "${title}"...`);
    try {
      const scResults = await play.search(title, {
        source: { soundcloud: 'tracks' },
        limit: 1
      });
      if (scResults.length === 0) throw new Error('Sin resultados en SoundCloud');
      const scStream = await play.stream(scResults[0].url);
      const resource = createAudioResource(scStream.stream, {
        inputType: scStream.type,
        inlineVolume: true
      });
      console.log(`✅ [SOUNDCLOUD] Stream listo: "${title}"`);
      return { resource, title: `${title} 📻`, source: 'soundcloud' };
    } catch (scErr) {
      console.error(`❌ [SOUNDCLOUD]: ${scErr.message}`);
    }
  }

  throw new Error(`No se pudo reproducir "${title}". YouTube y SoundCloud fallaron.`);
}

// ─────────────────────────────────────────────────────────────────────────────
// CLASE PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────
class VoiceStateManager {
  constructor() {
    this.connection = null;
    this.audioPlayer = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Play }
    });
    this.currentResource = null;
    this.subscription = null;

    this.currentTrack = null; // { title, url, source, requestedBy, channelName }
    this.isLooping = false;
    this.volume = config.DEFAULT_VOLUME;
    this.status = 'idle'; // 'idle' | 'playing' | 'paused' | 'interrupted_by_tts'

    this.emptyChannelTimeout = null;
    this.retryCount = 0;
    this.lastChannel = null;
    this.intentionalDisconnect = false;

    // Anti-loop-infinito
    this._loopConsecutiveFailures = 0;
    this._lastLoopStartTime = 0;
    this._loopCooldownMs = 8000; // Mínimo 8s entre reinicios de loop

    this._setupPlayerEvents();
  }

  _setupPlayerEvents() {
    this.audioPlayer.on(AudioPlayerStatus.Playing, () => {
      this.status = 'playing';
      this.retryCount = 0;
      this._loopConsecutiveFailures = 0; // Reset al reproducir correctamente
    });

    this.audioPlayer.on(AudioPlayerStatus.Paused, () => {
      if (this.status !== 'interrupted_by_tts') {
        this.status = 'paused';
      }
    });

    this.audioPlayer.on(AudioPlayerStatus.Idle, async () => {
      if (this.isLooping && this.currentTrack && this.status !== 'interrupted_by_tts') {
        // Cooldown: mínimo 8s entre reinicios
        const now = Date.now();
        const elapsed = now - this._lastLoopStartTime;
        if (elapsed < this._loopCooldownMs) {
          const wait = this._loopCooldownMs - elapsed;
          console.log(`⏱️ [LOOP] Cooldown ${wait}ms...`);
          await new Promise(r => setTimeout(r, wait));
        }

        // Demasiados fallos: pausa 30s
        if (this._loopConsecutiveFailures >= 3) {
          console.error(`🛑 [LOOP] ${this._loopConsecutiveFailures} fallos. Pausando 30s...`);
          this.status = 'idle';
          await new Promise(r => setTimeout(r, 30000));
          this._loopConsecutiveFailures = 0;
          if (!this.isLooping || !this.currentTrack) return;
        }

        try {
          this._lastLoopStartTime = Date.now();
          const { url, source } = this.currentTrack;
          console.log(`🔁 [LOOP] Reiniciando reproducción... (fuente preferida: ${source || 'youtube'})`);
          await this._play(url, true, source || 'youtube');
        } catch (err) {
          this._loopConsecutiveFailures++;
          console.error(`⚠️ [ERROR LOOP] (fallo ${this._loopConsecutiveFailures}/3):`, err.message);
          this.status = 'idle';
        }
      } else if (this.status !== 'interrupted_by_tts') {
        this.status = 'idle';
      }
    });

    this.audioPlayer.on('error', async error => {
      console.error('⚠️ [ERROR PLAYER]:', error.message);

      if (this.retryCount < 1 && this.currentTrack) {
        this.retryCount++;
        console.log(`🔄 [REINTENTO ${this.retryCount}/1]...`);
        try {
          const { url, source } = this.currentTrack;
          await this._play(url, true, source || 'youtube');
          return;
        } catch (e) {
          console.error('⚠️ [REINTENTO FALLIDO]:', e.message);
        }
      }

      this.status = 'idle';
      this.currentTrack = null;
    });
  }

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
      console.warn('⚠️ [VOZ]:', e.message);
    }

    this.subscription = this.connection.subscribe(this.audioPlayer);

    this.connection.on(VoiceConnectionStatus.Disconnected, async () => {
      if (this.intentionalDisconnect) return;
      console.warn('⚠️ [VOZ] Desconectado. Reconectando...');
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
            console.log('✅ [VOZ] Reconectado.');
            return;
          } catch (e) {
            console.error('⚠️ [REJOIN]:', e.message);
          }
        }
        if (this.lastChannel && (this.status === 'playing' || this.status === 'paused')) {
          try {
            this.destroy();
            await this.connect(this.lastChannel);
            if (this.currentTrack) {
              await this._play(this.currentTrack.url, true, this.currentTrack.source);
            }
          } catch (e) {
            console.error('⚠️ [RESTAURACIÓN]:', e.message);
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
   * Método interno de reproducción.
   * @param {string} query           - URL de YouTube o término de búsqueda
   * @param {boolean} isRetry
   * @param {string} preferredSource - 'youtube' | 'soundcloud' | 'direct'
   */
  async _play(query, isRetry = false, preferredSource = 'youtube') {
    let resource, title, source;

    const isDirectStream =
      query.startsWith('http') &&
      !query.includes('youtube.com') &&
      !query.includes('youtu.be') &&
      !query.includes('soundcloud.com');

    if (isDirectStream) {
      // Radio / MP3 directo: play.stream puede manejar URLs directas
      try {
        const directStream = await play.stream(query);
        resource = createAudioResource(directStream.stream, {
          inputType: directStream.type,
          inlineVolume: true
        });
      } catch {
        // Si play-dl no puede, usar fetch como ReadableStream
        const { PassThrough } = require('stream');
        const response = await fetch(query);
        const pt = new PassThrough();
        response.body.pipe(pt);
        resource = createAudioResource(pt, {
          inputType: StreamType.Arbitrary,
          inlineVolume: true
        });
      }
      title = 'Transmisión de Radio Táctica';
      source = 'direct';
    } else {
      const resolved = await resolveStream(query, preferredSource);
      resource = resolved.resource;
      title = resolved.title;
      source = resolved.source;
    }

    if (resource.volume) {
      resource.volume.setVolume(this.volume);
    }

    this.currentResource = resource;
    if (!isRetry) this.retryCount = 0;

    if (this.currentTrack) {
      this.currentTrack.title = title;
      this.currentTrack.source = source;
    }

    if (this.connection) {
      this.subscription = this.connection.subscribe(this.audioPlayer);
    }

    this.audioPlayer.play(resource);
    return title;
  }

  // ── API pública ──────────────────────────────────────────────────────────

  async playTrack(url) {
    return await this._play(url, false, 'youtube');
  }

  async streamAudio(url, isRetry = false) {
    return await this._play(url, isRetry, 'youtube');
  }

  async getTrackTitle(url) {
    try { return await fetchTitle(url); } catch { return 'Transmisión Táctica'; }
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
    this.audioPlayer.stop(true);
    this.destroy();
  }

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

  startEmptyChannelTimer() {
    if (this.emptyChannelTimeout) return;
    const ms = config.EMPTY_CHANNEL_TIMEOUT_MS || 120000;
    console.log(`⏱️ [AHORRO] Canal vacío. Desconectando en ${ms / 1000}s...`);
    this.emptyChannelTimeout = setTimeout(() => {
      console.log('🔌 [AHORRO] Desconectando por inactividad.');
      this.stopAndDisconnect();
    }, ms);
  }

  cancelEmptyChannelTimer() {
    if (this.emptyChannelTimeout) {
      console.log('🛡️ [AHORRO] Temporizador cancelado.');
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
