/**
 * COMANDO PRINCIPAL Y SUBCOMANDOS - SARGENTO RICO
 * 
 * Agrupa todas las funcionalidades bajo el comando raíz /sargento-rico:
 * - Música: play, stop, pause, resume, volumen, nowplaying.
 * - TTS: decir, tts-canal, tts-toggle, tts-idioma.
 */

const { SlashCommandBuilder, ChannelType } = require('discord.js');

const data = new SlashCommandBuilder()
  .setName('sargento-rico')
  .setDescription('Comandos de la estación táctica militar del Sargento Rico (USMC)')
  
  // 1. SUBCOMANDO: PLAY
  .addSubcommand(subcommand =>
    subcommand
      .setName('play')
      .setDescription('Se une al canal de voz y reproduce una transmisión o marcha militar')
      .addStringOption(option =>
        option
          .setName('url')
          .setDescription('Enlace de YouTube o URL directa de audio (opcional, si no se pasa usa el audio militar base)')
          .setRequired(false)
      )
      .addBooleanOption(option =>
        option
          .setName('loop')
          .setDescription('¿Repetir en bucle militar infinito? (true/false)')
          .setRequired(false)
      )
  )

  // 2. SUBCOMANDO: STOP
  .addSubcommand(subcommand =>
    subcommand
      .setName('stop')
      .setDescription('Detiene todas las transmisiones y desconecta al bot del canal de voz')
  )

  // 3. SUBCOMANDO: PAUSE
  .addSubcommand(subcommand =>
    subcommand
      .setName('pause')
      .setDescription('Pone en pausa táctica la transmisión de radio militar actual')
  )

  // 4. SUBCOMANDO: RESUME
  .addSubcommand(subcommand =>
    subcommand
      .setName('resume')
      .setDescription('Reanuda la transmisión de radio militar previamente pausada')
  )

  // 5. SUBCOMANDO: VOLUMEN
  .addSubcommand(subcommand =>
    subcommand
      .setName('volumen')
      .setDescription('Ajusta la potencia de salida de audio del altavoz táctico')
      .addIntegerOption(option =>
        option
          .setName('nivel')
          .setDescription('Nivel de volumen militar (0 a 100)')
          .setMinValue(0)
          .setMaxValue(100)
          .setRequired(true)
      )
  )

  // 6. SUBCOMANDO: NOWPLAYING
  .addSubcommand(subcommand =>
    subcommand
      .setName('nowplaying')
      .setDescription('Muestra el reporte de situación de la radio militar (estado, pista, volumen)')
  )

  // 7. SUBCOMANDO: DECIR (TTS MANUAL)
  .addSubcommand(subcommand =>
    subcommand
      .setName('decir')
      .setDescription('El Sargento Rico lee tu comunicado militar por voz (pausa la música y la reanuda)')
      .addStringOption(option =>
        option
          .setName('texto')
          .setDescription('Mensaje militar que el Sargento debe transmitir')
          .setRequired(true)
      )
  )

  // 8. SUBCOMANDO: TTS-CANAL (ADMINISTRATIVO)
  .addSubcommand(subcommand =>
    subcommand
      .setName('tts-canal')
      .setDescription('[RANGO REQUERIDO] Define el canal de texto para auto-lectura de radio')
      .addChannelOption(option =>
        option
          .setName('canal')
          .setDescription('Canal de texto que el Sargento escuchará (si se omite, usa el actual)')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(false)
      )
  )

  // 9. SUBCOMANDO: TTS-TOGGLE (ADMINISTRATIVO)
  .addSubcommand(subcommand =>
    subcommand
      .setName('tts-toggle')
      .setDescription('[RANGO REQUERIDO] Activa o desactiva la auto-lectura del chat')
  )

  // 10. SUBCOMANDO: TTS-IDIOMA (ADMINISTRATIVO)
  .addSubcommand(subcommand =>
    subcommand
      .setName('tts-idioma')
      .setDescription('[RANGO REQUERIDO] Cambia el idioma de la voz táctica del sintetizador TTS')
      .addStringOption(option =>
        option
          .setName('codigo')
          .setDescription('Código de idioma admitido por Google Translate')
          .setRequired(true)
          .addChoices(
            { name: 'Español (es)', value: 'es' },
            { name: 'Inglés (en)', value: 'en' },
            { name: 'Portugués (pt)', value: 'pt' },
            { name: 'Francés (fr)', value: 'fr' },
            { name: 'Alemán (de)', value: 'de' },
            { name: 'Italiano (it)', value: 'it' }
          )
      )
  );

module.exports = {
  data
};
