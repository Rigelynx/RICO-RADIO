/**
 * GESTOR DE TEXTO A VOZ (TTS) - SARGENTO RICO
 * 
 * Utiliza la librería node-gtts (Google Translate TTS gratuito, sin API key).
 * Funcionalidades clave:
 * 1. Genera audios en temp/<id>.mp3.
 * 2. Pausa la música de fondo si está sonando.
 * 3. Reproduce el mensaje hablado en el canal de voz.
 * 4. Elimina el archivo .mp3 inmediatamente al terminar para no ocupar espacio en disco.
 * 5. Reanuda la música automáticamente en el punto exacto donde se quedó.
 * 6. Cola asíncrona FIFO para evitar que mensajes rápidos se pisen entre sí.
 */

const fs = require('fs');
const path = require('path');
const gtts = require('node-gtts');
const {
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  StreamType
} = require('@discordjs/voice');
const voiceManager = require('./voiceManager');
const storageManager = require('./storageManager');

class TTSManager {
  constructor() {
    this.ttsPlayer = createAudioPlayer();
    this.queue = [];
    this.isPlaying = false;
    this.tempDir = path.join(__dirname, '..', '..', 'temp');
    this.hasWarnedNotConnected = false; // Bandera para avisar solo una vez si el bot no está en voz

    // Asegurar existencia del directorio temporal
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }

    this.setupEvents();
  }

  setupEvents() {
    this.ttsPlayer.on(AudioPlayerStatus.Idle, async () => {
      // Si hay un archivo temporal en la tarea actual, eliminarlo inmediatamente
      if (this.currentTask && this.currentTask.filePath) {
        this.cleanupFile(this.currentTask.filePath);
      }

      this.currentTask = null;

      // Si quedan más mensajes en la cola, reproducir el siguiente
      if (this.queue.length > 0) {
        this.processNextInQueue();
      } else {
        // La cola terminó: reanudar la música si estaba pausada
        this.isPlaying = false;
        voiceManager.resumeAfterTTS();
      }
    });

    this.ttsPlayer.on('error', (error) => {
      console.error('⚠️ [ERROR TTS PLAYER]', error.message);
      if (this.currentTask && this.currentTask.filePath) {
        this.cleanupFile(this.currentTask.filePath);
      }
      this.currentTask = null;
      this.isPlaying = false;
      voiceManager.resumeAfterTTS();
    });
  }

  /**
   * Elimina un archivo temporal de forma segura.
   * @param {string} filePath 
   */
  cleanupFile(filePath) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (err) {
      console.error('⚠️ [ERROR CLEANUP] No se pudo borrar archivo temp:', err.message);
    }
  }

  /**
   * Genera el archivo mp3 usando node-gtts.
   * @param {string} text - Mensaje a sintetizar
   * @param {string} lang - Código de idioma (es, en, pt, fr, etc.)
   * @param {string} filePath - Ruta de destino
   * @returns {Promise<string>}
   */
  generateAudioFile(text, lang, filePath) {
    return new Promise((resolve, reject) => {
      const gttsInstance = gtts(lang);
      gttsInstance.save(filePath, text, (err) => {
        if (err) return reject(err);
        resolve(filePath);
      });
    });
  }

  /**
   * Agrega un mensaje TTS a la cola de reproducción.
   * @param {string} text - Texto a decir
   * @param {import('discord.js').VoiceBasedChannel} voiceChannel - Canal de voz
   * @param {string} [lang] - Idioma opcional (si no se pasa, usa el guardado en config)
   */
  async speak(text, voiceChannel, lang = null) {
    if (!voiceChannel) {
      throw new Error('Debes estar en un canal de voz para que el Sargento Rico pueda hablar.');
    }

    const currentConfig = storageManager.getConfig();
    const ttsLang = lang || currentConfig.ttsLang || 'es';

    // Generar nombre de archivo único para evitar colisiones
    const fileName = `tts_${Date.now()}_${Math.random().toString(36).substring(7)}.mp3`;
    const filePath = path.join(this.tempDir, fileName);

    // Esperar a que el socket de voz esté listo antes de suscribir el reproductor TTS.
    await voiceManager.connect(voiceChannel);

    // Añadir tarea a la cola
    this.queue.push({
      text,
      lang: ttsLang,
      filePath,
      voiceChannel
    });

    // Si no se está reproduciendo ningún TTS actualmente, iniciar
    if (!this.isPlaying) {
      this.processNextInQueue();
    }
  }

  /**
   * Procesa la siguiente tarea en la cola FIFO.
   */
  async processNextInQueue() {
    if (this.queue.length === 0) return;

    this.isPlaying = true;
    this.currentTask = this.queue.shift();

    try {
      // Pausar música si estaba sonando
      voiceManager.pauseForTTS();

      // Generar audio mp3
      await this.generateAudioFile(this.currentTask.text, this.currentTask.lang, this.currentTask.filePath);

      // Crear recurso de audio para Discord
      const resource = createAudioResource(this.currentTask.filePath, {
        inputType: StreamType.Arbitrary,
        inlineVolume: true
      });

      if (resource.volume) {
        resource.volume.setVolume(1.0); // Volumen nítido al 100% para la voz militar
      }

      // Suscribir la conexión de voz al reproductor de TTS
      if (voiceManager.connection) {
        voiceManager.connection.subscribe(this.ttsPlayer);
      }

      this.ttsPlayer.play(resource);
    } catch (error) {
      console.error('⚠️ [ERROR TTS PROCESO]', error.message);
      this.cleanupFile(this.currentTask.filePath);
      this.currentTask = null;

      if (this.queue.length > 0) {
        this.processNextInQueue();
      } else {
        this.isPlaying = false;
        voiceManager.resumeAfterTTS();
      }
    }
  }
}

const ttsManager = new TTSManager();

module.exports = ttsManager;
