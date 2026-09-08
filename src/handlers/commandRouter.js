/**
 * ENRUTADOR DE COMANDOS Y CONTROL DE JERARQUÍA - SARGENTO RICO
 * 
 * Recibe las interacciones del comando /sargento-rico, valida la jerarquía militar
 * en los comandos administrativos y ejecuta la lógica llamando a los managers.
 */

const { checkMilitaryRank } = require('../managers/permissionManager');
const voiceManager = require('../managers/voiceManager');
const ttsManager = require('../managers/ttsManager');
const storageManager = require('../managers/storageManager');
const config = require('../../config');
const {
  createSuccessEmbed,
  createErrorEmbed,
  createWarningEmbed,
  createNowPlayingEmbed
} = require('../utils/militaryEmbeds');

// Lista de subcomandos restringidos que exigen rango militar mínimo
const RESTRICTED_SUBCOMMANDS = ['tts-canal', 'tts-toggle', 'tts-idioma'];

/**
 * Maneja la interacción de comando slash recibida.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction 
 */
async function handleSlashCommand(interaction) {
  if (interaction.commandName !== 'sargento-rico') return;

  const subcommand = interaction.options.getSubcommand();

  // 1. VALIDACIÓN DE JERARQUÍA MILITAR (Solo para comandos administrativos)
  if (RESTRICTED_SUBCOMMANDS.includes(subcommand)) {
    const rankCheck = checkMilitaryRank(interaction.member);
    if (!rankCheck.allowed) {
      return interaction.reply({
        embeds: [
          createErrorEmbed(
            'ORDEN NO AUTORIZADA',
            rankCheck.message || 'No posees el rango militar necesario para ejecutar esta orden.'
          )
        ],
        ephemeral: true // Solo visible para el usuario que intentó el comando
      });
    }
  }

  // 2. ENRUTAMIENTO DE SUBCOMANDOS
  try {
    switch (subcommand) {
      case 'play':
        await handlePlay(interaction);
        break;

      case 'stop':
        await handleStop(interaction);
        break;

      case 'pause':
        await handlePause(interaction);
        break;

      case 'resume':
        await handleResume(interaction);
        break;

      case 'volumen':
        await handleVolume(interaction);
        break;

      case 'nowplaying':
        await handleNowPlaying(interaction);
        break;

      case 'decir':
        await handleDecir(interaction);
        break;

      case 'tts-canal':
        await handleTTSCanal(interaction);
        break;

      case 'tts-toggle':
        await handleTTSToggle(interaction);
        break;

      case 'tts-idioma':
        await handleTTSIdioma(interaction);
        break;

      default:
        await interaction.reply({
          content: '⚠️ Orden no reconocida por el Sargento Rico.',
          ephemeral: true
        });
    }
  } catch (error) {
    console.error(`⚠️ [ERROR EN SUBCOMANDO ${subcommand}]:`, error);

    const errorMessage = 'Ocurrió un error táctico al procesar la orden militar.';
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({
        embeds: [createErrorEmbed('FALLO EN LA ORDEN', errorMessage)],
        ephemeral: true
      });
    } else {
      await interaction.reply({
        embeds: [createErrorEmbed('FALLO EN LA ORDEN', errorMessage)],
        ephemeral: true
      });
    }
  }
}

// ==========================================
// CONTROLADORES DE SUBCOMANDOS
// ==========================================

async function handlePlay(interaction) {
  const memberVoiceChannel = interaction.member.voice.channel;

  if (!memberVoiceChannel) {
    return interaction.reply({
      embeds: [
        createErrorEmbed(
          'POSICIÓN NO LOCALIZADA',
          '¡Soldado, debes estar conectado a un canal de voz para solicitar una transmisión militar!'
        )
      ],
      ephemeral: true
    });
  }

  // Si ya hay audio reproduciéndose activamente, evitar duplicar la conexión
  if (voiceManager.status === 'playing') {
    return interaction.reply({
      embeds: [
        createWarningEmbed(
          'CANAL OCUPADO',
          'La radio del Sargento Rico ya está transmitiendo activamente. Usa `/sargento-rico stop` para finalizarla antes de iniciar una nueva transmisión.'
        )
      ],
      ephemeral: true
    });
  }

  await interaction.deferReply();

  const currentConfig = storageManager.getConfig();
  const inputUrl = interaction.options.getString('url');
  const targetUrl = inputUrl || currentConfig.defaultAudioUrl || config.DEFAULT_AUDIO_URL;
  const isLoop = interaction.options.getBoolean('loop') || false;

  try {
    // Conectar al canal del usuario y esperar a que el socket de voz esté listo
    await voiceManager.connect(memberVoiceChannel);
    voiceManager.cancelEmptyChannelTimer();
    voiceManager.isLooping = isLoop;

    // Asignar currentTrack ANTES de playTrack para que _play() pueda actualizar resolvedUrl
    voiceManager.currentTrack = {
      title: 'Cargando...',
      url: targetUrl,
      resolvedUrl: null,   // _play() lo actualizará con la URL directa resuelta
      requestedBy: interaction.user.tag,
      channelName: memberVoiceChannel.name
    };

    // playTrack resuelve el audio Y retorna el título en una sola llamada a yt-dlp
    const trackTitle = await voiceManager.playTrack(targetUrl);

    // Actualizar el título después de la resolución exitosa
    voiceManager.currentTrack.title = trackTitle;


    const loopText = isLoop ? '🔁 Bucle militar activado (repetición continua)' : '⏹️ Reproducción única';

    await interaction.editReply({
      embeds: [
        createSuccessEmbed(
          'CONTROL DE VOZ ASUMIDO',
          `🫡 **El Sargento Rico ha tomado el control del canal de voz:** \`${memberVoiceChannel.name}\`\n\n` +
          `📻 **Pista:** [${trackTitle}](${targetUrl})\n` +
          `🔄 **Modo:** ${loopText}\n` +
          `🔊 **Volumen:** ${Math.round(voiceManager.volume * 100)}%`
        )
      ]
    });
  } catch (error) {
    console.error('⚠️ [ERROR PLAY]:', error.message);
    await interaction.editReply({
      embeds: [
        createErrorEmbed(
          'ERROR DE TRANSMISIÓN',
          `No se pudo decodificar la señal de audio de la URL proporcionada.\n**Detalle:** ${error.message}`
        )
      ]
    });
  }
}

async function handleStop(interaction) {
  if (!voiceManager.connection && voiceManager.status === 'idle') {
    return interaction.reply({
      embeds: [createWarningEmbed('ESTACIÓN INACTIVA', 'No hay ninguna transmisión en curso que detener.')],
      ephemeral: true
    });
  }

  voiceManager.stopAndDisconnect();

  await interaction.reply({
    embeds: [
      createSuccessEmbed(
        'TRANSMISIÓN DETENIDA',
        '🫡 El Sargento Rico ha cortado la señal de radio y se ha retirado del canal de voz. ¡Descansen!'
      )
    ]
  });
}

async function handlePause(interaction) {
  if (voiceManager.status !== 'playing') {
    return interaction.reply({
      embeds: [createWarningEmbed('ESTACIÓN NO ACTIVA', 'No hay ninguna transmisión activa para pausar.')],
      ephemeral: true
    });
  }

  voiceManager.audioPlayer.pause();
  voiceManager.status = 'paused';

  await interaction.reply({
    embeds: [
      createWarningEmbed(
        'FRECUENCIA EN PAUSA',
        '⏸️ Transmisión de radio militar puesta en pausa temporal por orden superior.'
      )
    ]
  });
}

async function handleResume(interaction) {
  if (voiceManager.status !== 'paused') {
    return interaction.reply({
      embeds: [createWarningEmbed('ESTACIÓN NO PAUSADA', 'La transmisión militar no está en pausa.')],
      ephemeral: true
    });
  }

  voiceManager.audioPlayer.unpause();
  voiceManager.status = 'playing';

  await interaction.reply({
    embeds: [
      createSuccessEmbed(
        'FRECUENCIA REANUDADA',
        '▶️ La transmisión de radio militar ha reanudado su emisión táctica.'
      )
    ]
  });
}

async function handleVolume(interaction) {
  const level = interaction.options.getInteger('nivel');
  const appliedLevel = voiceManager.setVolume(level);

  await interaction.reply({
    embeds: [
      createSuccessEmbed(
        'POTENCIA MODIFICADA',
        `🔊 Potencia de los altavoces militares calibrada al **${appliedLevel}%**.`
      )
    ]
  });
}

async function handleNowPlaying(interaction) {
  const state = voiceManager.getState();

  if (!state.isConnected || !state.currentTrack) {
    return interaction.reply({
      embeds: [
        createWarningEmbed(
          'SILENCIO DE RADIO',
          'Actualmente no hay ninguna marcha ni audio reproduciéndose en el canal militar.'
        )
      ],
      ephemeral: true
    });
  }

  await interaction.reply({
    embeds: [
      createNowPlayingEmbed({
        title: state.currentTrack.title,
        url: state.currentTrack.url,
        status: state.status,
        loop: state.isLooping,
        volume: state.volumePercent,
        channelName: state.currentTrack.channelName,
        requestedBy: state.currentTrack.requestedBy
      })
    ]
  });
}

async function handleDecir(interaction) {
  const memberVoiceChannel = interaction.member.voice.channel;

  if (!memberVoiceChannel) {
    return interaction.reply({
      embeds: [
        createErrorEmbed(
          'CANAL DE VOZ REQUERIDO',
          '¡Soldado, conéctate a un canal de voz para que el Sargento Rico pueda transmitirte el comunicado!'
        )
      ],
      ephemeral: true
    });
  }

  const text = interaction.options.getString('texto');

  if (text.length > config.MAX_TTS_CHARS) {
    return interaction.reply({
      embeds: [
        createErrorEmbed(
          'COMUNICADO DEMASIADO LARGO',
          `Las transmisiones tácticas no pueden superar los ${config.MAX_TTS_CHARS} caracteres. Tu mensaje tiene ${text.length}.`
        )
      ],
      ephemeral: true
    });
  }

  await interaction.deferReply();

  try {
    await ttsManager.speak(text, memberVoiceChannel);

    await interaction.editReply({
      embeds: [
        createSuccessEmbed(
          'COMUNICADO EMITIDO',
          `📢 El Sargento Rico ha tomado el micrófono táctico para transmitir tu mensaje:\n\n*"${text}"*`
        )
      ]
    });
  } catch (error) {
    console.error('⚠️ [ERROR DECIR]:', error);
    await interaction.editReply({
      embeds: [createErrorEmbed('FALLO DE SÍNTESIS DE VOZ', error.message)]
    });
  }
}

async function handleTTSCanal(interaction) {
  const selectedChannel = interaction.options.getChannel('canal') || interaction.channel;

  storageManager.updateConfig({ ttsChannelId: selectedChannel.id });

  await interaction.reply({
    embeds: [
      createSuccessEmbed(
        'FRECUENCIA VIGILADA ESTABLECIDA',
        `📡 El Sargento Rico ahora escucha y leerá automáticamente los comunicados de <#${selectedChannel.id}>.`
      )
    ]
  });
}

async function handleTTSToggle(interaction) {
  const current = storageManager.getConfig();
  const newState = !current.ttsEnabled;

  storageManager.updateConfig({ ttsEnabled: newState });

  const statusMsg = newState
    ? '✅ **ACTIVADA**. Todo mensaje en el canal asignado será leído por el Sargento.'
    : '🛑 **DESACTIVADA**. Los mensajes de texto ya no serán leídos en voz alta.';

  await interaction.reply({
    embeds: [
      createSuccessEmbed(
        'ESTADO DE AUTO-LECTURA',
        `La auto-lectura de radio táctica ha sido ${statusMsg}`
      )
    ]
  });
}

async function handleTTSIdioma(interaction) {
  const langCode = interaction.options.getString('codigo');

  storageManager.updateConfig({ ttsLang: langCode });

  await interaction.reply({
    embeds: [
      createSuccessEmbed(
        'DIALECTO TÁCTICO CONFIGURADO',
        `🌐 El idioma del sintetizador de voz se ha configurado en: **${langCode.toUpperCase()}**.`
      )
    ]
  });
}

module.exports = {
  handleSlashCommand
};
