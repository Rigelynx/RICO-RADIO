/**
 * GESTOR DE AUDIO Y VOZ MILITAR - SARGENTO RICO (v6 - Stream Verificado)
 *
 * Estrategia definitiva de reproducción:
 *   yt-dlp exec --output - → stdout pipe → createAudioResource(StreamType.Arbitrary)
 *   → @discordjs/voice usa su FFmpeg interno para decodificar a Opus
 *
 * CORRECCIONES v6:
 *   - verifyStreamHasData: espera bytes REALES del stdout antes de aceptar
 *   - Cooldown de loop: mínimo 8s entre reinicios para evitar ciclos infinitos
 *   - Contador de fallos consecutivos: pausa el loop 30s si falla 3 veces seguidas
 *   - noPlaylist: true en SoundCloud para evitar streams vacíos
 */

const path = require('path');
const fs = require('fs');

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
    const bins = [
      path.join(process.cwd(), 'node_modules', 'youtube-dl-exec', 'bin', 'yt-dlp'),
      path.join(process.cwd(), 'node_modules', 'youtube-dl-exec', 'bin', 'yt-dlp.linux'),
      path.join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg')
    ];
    for (const b of bins) {
      if (fs.existsSync(b)) {
        fs.chmodSync(b, '755');
        console.log(`🛡️ [SISTEMA LINUX] Permisos 755: ${b}`);
      }
    }
  } catch (e) {
    console.warn('⚠️ [LINUX CHMOD]:', e.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function getYoutubeCookiesPath() {
  const custom = process.env.YOUTUBE_COOKIES_PATH;
  if (custom && fs.existsSync(custom)) return custom;
  const def = path.join(process.cwd(), 'cookies.txt');
  if (fs.existsSync(def)) return def;
  return null;
}

/**
 * Obtiene el título de una pista sin descargar audio.
 * YouTube → oEmbed API. Búsqueda de texto → yt-dlp --dump-single-json.
 */
async function fetchTitle(query) {
  const isUrl = query.startsWith('http');

  if (isUrl && (query.includes('youtube.com') || query.includes('youtu.be'))) {
    try {
      const r = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(query)}&format=json`);
      if (r.ok) {
        const d = await r.json();
        if (d.title) return d.title;
      }
    } catch {}
  }

  if (!isUrl) {
    try {
      const cookies = getYoutubeCookiesPath();
      const res = await youtubedl(`ytsearch1:${query}`, {
        dumpSingleJson: true,
        noWarnings: true,
        noCheckCertificates: true,
        ...(cookies ? { cookies } : {})
      });
      if (res && res.title) return res.title;
    } catch {}
    return query;
  }

  return 'Transmisión Táctica';
}

/**
 * Lanza yt-dlp en modo pipe (--output -) y crea un AudioResource.
 *
 * yt-dlp descarga/transmite el audio a stdout, que se pasa directamente a
 * @discordjs/voice con StreamType.Arbitrary. Voice usa su FFmpeg interno
 * para decodificar el stream (webm/opus/mp4/etc.) a Opus para Discord.
 *
 * NO usa URLs pre-firmadas → no hay expiración de URLs.
 *
 * @param {string} target    - yt-dlp target: URL, ytsearch1:query, scsearch1:query
 * @param {object} extraArgs - Argumentos adicionales para yt-dlp
 * @returns {{ resource: AudioResource, process: ChildProcess }}
 */
function createYtdlpPipeResource(target, extraArgs = {}) {
  const cookies = getYoutubeCookiesPath();
  if (cookies) console.log(`🍪 [AUTH] Usando cookies: ${cookies}`);

  const ytProcess = youtubedl.exec(target, {
    output: '-',              // Pipe audio a stdout
    format: 'ba/b',           // Mejor audio disponible
    noWarnings: true,
    noCheckCertificates: true,
    ...(cookies ? { cookies } : {}),
    ...extraArgs
  });

  if (!ytProcess || !ytProcess.stdout) {
    throw new Error('yt-dlp no pudo iniciar el proceso de audio');
  }

  // Capturar stderr para diagnóstico (solo errores reales, sin spam)
  let stderrBuf = '';
  ytProcess.stderr.on('data', chunk => { stderrBuf += chunk.toString(); });
  ytProcess.on('exit', code => {
    if (code !== 0 && stderrBuf) {
      // Filtrar solo líneas de ERROR, ignorar warnings de deprecación
      const errLines = stderrBuf.split('\n')
        .filter(l => l.includes('ERROR:') || l.includes('error'))
        .slice(0, 3)
        .join(' | ');
      if (errLines) console.warn(`⚠️ [YT-DLP ${code}]: ${errLines}`);
    }
  });

  // StreamType.Arbitrary: @discordjs/voice usará su FFmpeg interno para decodificar
  const resource = createAudioResource(ytProcess.stdout, {
    inputType: StreamType.Arbitrary,
    inlineVolume: true
  });

  resource._ytProcess = ytProcess;
  return { resource, process: ytProcess };
}

/**
 * Resuelve la fuente de audio con fallback YouTube → SoundCloud.
 * Acepta preferredSource para loops (intenta la fuente que funcionó antes).
 *
 * @param {string} query           - URL de YouTube o término de búsqueda
 * @param {string} preferredSource - 'youtube' | 'soundcloud'
 * @returns {Promise<{ resource, title, source }>}
 */
async function resolveStream(query, preferredSource = 'youtube') {
  const isUrl = query.startsWith('http');
  const ytTarget = isUrl ? query : `ytsearch1:${query}`;

  const title = await fetchTitle(query);

  // ── Si la última fuente que funcionó fue SoundCloud, intentarla primero ──
  if (preferredSource === 'soundcloud') {
    try {
      const cleanTitle = title.replace(' 📻', '');
      console.log(`🎵 [LOOP] Renovando stream de SoundCloud para: "${cleanTitle}"...`);
      const { resource } = createYtdlpPipeResource(`scsearch1:${cleanTitle}`, {
        format: 'bestaudio/best',
        noPlaylist: true
      });
      await verifyStreamHasData(resource._ytProcess, 4096, 12000);
      console.log(`✅ [SOUNDCLOUD] Stream renovado: "${cleanTitle}"`);
      return { resource, title, source: 'soundcloud' };
    } catch (e) {
      console.warn(`⚠️ [SOUNDCLOUD] Sin datos reales: ${e.message}. Intentando YouTube...`);
    }
  }

  // ── Intento YouTube ──
  try {
    console.log(`🎵 [BUSCANDO] "${title}" en YouTube...`);
    const { resource } = createYtdlpPipeResource(ytTarget);
    await verifyStreamHasData(resource._ytProcess, 4096, 12000);
    console.log(`✅ [YOUTUBE] Stream verificado: "${title}"`);
    return { resource, title, source: 'youtube' };
  } catch (ytErr) {
    const errLine = ytErr.message.split('\n').find(l => l.includes('ERROR:')) || ytErr.message.split('\n')[0];
    console.warn(`⚠️ [YOUTUBE BLOQUEADO] ${errLine}`);
  }

  // ── Fallback SoundCloud ──
  if (preferredSource !== 'soundcloud') {
    console.warn(`📡 [RELEVO TÁCTICO] Conectando a SoundCloud para: "${title}"...`);
    try {
      const { resource } = createYtdlpPipeResource(`scsearch1:${title}`, {
        format: 'bestaudio/best',
        noPlaylist: true
      });
      await verifyStreamHasData(resource._ytProcess, 4096, 12000);
      console.log(`✅ [SOUNDCLOUD] Stream listo: "${title}"`);
      return { resource, title: `${title} 📻`, source: 'soundcloud' };
    } catch (scErr) {
      console.error(`❌ [SOUNDCLOUD]: ${scErr.message}`);
    }
  }

  throw new Error(
    `No se pudo reproducir "${title}". Ambas fuentes (YouTube y SoundCloud) fallaron.`
  );
}

/**
 * Verifica que el proceso yt-dlp produce DATOS REALES en stdout
 * antes de considerarlo un stream válido.
 *
 * Espera recibir al menos `minBytes` bytes del stdout dentro de `timeoutMs`.
 * Si el proceso muere antes sin datos → rechaza.
 * Si recibe datos suficientes → resuelve (stream es válido).
 *
 * @param {ChildProcess} proc
 * @param {number} minBytes   - Mínimo de bytes para considerar el stream válido (default: 4096)
 * @param {number} timeoutMs  - Tiempo máximo de espera en ms (default: 12000)
 */
function verifyStreamHasData(proc, minBytes = 4096, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    let bytesReceived = 0;
    let resolved = false;

    const cleanup = () => {
      clearTimeout(timer);
      if (proc.stdout) proc.stdout.removeListener('data', onData);
      proc.removeListener('exit', onExit);
    };

    const onData = (chunk) => {
      bytesReceived += chunk.length;
      if (bytesReceived >= minBytes && !resolved) {
        resolved = true;
        cleanup();
        resolve(); // ✅ Stream tiene datos reales
      }
    };

    const onExit = (code) => {
      cleanup();
      if (resolved) return;
      if (bytesReceived > 0) {
        // Proceso terminó pero envió algo → puede ser pista corta, aceptar
        resolve();
      } else {
        reject(new Error(`yt-dlp terminó sin datos (código ${code})`));
      }
    };

    const timer = setTimeout(() => {
      if (!resolved) {
        cleanup();
        if (bytesReceived > 0) {
          resolve(); // Recibió algo, aceptar aunque sea poco
        } else {
          proc.kill('SIGKILL');
          reject(new Error(`Timeout: no se recibieron datos de yt-dlp en ${timeoutMs}ms`));
        }
      }
    }, timeoutMs);

    if (proc.stdout) {
      proc.stdout.on('data', onData);
    } else {
      reject(new Error('yt-dlp no tiene stdout'));
      return;
    }

    proc.once('exit', onExit);
  });
}


// ─────────────────────────────────────────────────────────────────────────────
// CLASE PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────
class VoiceStateManager {
  constructor() {
    this.connection = null;
    this.audioPlayer = createAudioPlayer();
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
      this._loopConsecutiveFailures = 0; // Reset fallos al reproducir correctamente
    });

    this.audioPlayer.on(AudioPlayerStatus.Paused, () => {
      if (this.status !== 'interrupted_by_tts') {
        this.status = 'paused';
      }
    });

    this.audioPlayer.on(AudioPlayerStatus.Idle, async () => {
      if (this.isLooping && this.currentTrack && this.status !== 'interrupted_by_tts') {
        // ── Cooldown: evitar loops más rápidos que _loopCooldownMs ──
        const now = Date.now();
        const elapsed = now - this._lastLoopStartTime;
        if (elapsed < this._loopCooldownMs) {
          const wait = this._loopCooldownMs - elapsed;
          console.log(`⏱️ [LOOP] Esperando ${wait}ms antes de reiniciar (anti-bucle)...`);
          await new Promise(r => setTimeout(r, wait));
        }

        // ── Demasiados fallos consecutivos: pausa el loop ──
        if (this._loopConsecutiveFailures >= 3) {
          console.error(`🛑 [LOOP] ${this._loopConsecutiveFailures} fallos consecutivos. Pausando 30s...`);
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
      this._killCurrentProcess();

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

  _killCurrentProcess() {
    if (this.currentResource && this.currentResource._ytProcess) {
      try { this.currentResource._ytProcess.kill('SIGKILL'); } catch {}
    }
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
      console.log(`📡 [VOZ LISTA] Conectado a "${channel.name}".`);
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
   * @param {string} query           - URL de YouTube o búsqueda
   * @param {boolean} isRetry
   * @param {string} preferredSource - Fuente preferida: 'youtube' | 'soundcloud'
   */
  async _play(query, isRetry = false, preferredSource = 'youtube') {
    this._killCurrentProcess();

    const isDirectStream =
      query.startsWith('http') &&
      !query.includes('youtube.com') &&
      !query.includes('youtu.be') &&
      !query.includes('soundcloud.com');

    let resource, title, source;

    if (isDirectStream) {
      // Radio / MP3 directo: yt-dlp puede hacer pipe también
      const { resource: r } = createYtdlpPipeResource(query);
      resource = r;
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

    resource.playStream.on('error', err => {
      // Solo loggear si no es el error de "stream destruido" normal al parar
      if (!err.message.includes('destroyed')) {
        console.error('⚠️ [STREAM ERROR]:', err.message);
      }
    });

    this.currentResource = resource;
    if (!isRetry) this.retryCount = 0;

    // Actualizar currentTrack con fuente resuelta (para loops inteligentes)
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
    this._killCurrentProcess();
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
