/**
 * SCRIPT DE DESPLIEGUE DE COMANDOS SLASH - SARGENTO RICO
 * 
 * Registra el comando /sargento-rico y todos sus subcomandos en el servidor de Discord
 * utilizando la API REST de Discord v10.
 * 
 * Ejecución:
 * npm run deploy
 */

require('dotenv').config();
const { REST, Routes } = require('discord.js');
const { data } = require('./src/commands/sargentoRico');
const config = require('./config');

const token = config.TOKEN || process.env.DISCORD_TOKEN;
const clientId = config.CLIENT_ID || process.env.CLIENT_ID;
const guildId = config.GUILD_ID || process.env.GUILD_ID;

if (!token || !clientId || !guildId) {
  console.error('❌ [ERROR] Faltan variables obligatorias en el archivo .env:');
  if (!token) console.error('  - DISCORD_TOKEN no está definido.');
  if (!clientId) console.error('  - CLIENT_ID no está definido.');
  if (!guildId) console.error('  - GUILD_ID no está definido.');
  console.error('\nPor favor edita tu archivo .env y vuelve a ejecutar: npm run deploy\n');
  process.exit(1);
}

const commands = [data.toJSON()];
const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  try {
    console.log('📡 [DESPLIEGUE] Iniciando registro de comandos militares (/sargento-rico)...');

    // Despliegue en el servidor específico (Guild) para disponibilidad instantánea sin esperar caché global
    const response = await rest.put(
      Routes.applicationGuildCommands(clientId, guildId),
      { body: commands }
    );

    console.log(`🎖️ [ÉXITO] ¡Comandos registrados exitosamente en el servidor (${response.length} comando principal cargado con todos sus subcomandos)!`);
    console.log('Ya puedes usar /sargento-rico en tu Discord.');
  } catch (error) {
    console.error('❌ [ERROR] Falló el registro de comandos:', error);
  }
})();
