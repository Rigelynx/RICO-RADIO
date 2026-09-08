/**
 * GESTOR DE PERMISOS POR JERARQUÍA DE RANGOS MILITARES - SARGENTO RICO
 * 
 * En lugar de validar rol por rol de forma manual, este módulo compara la
 * posición numérica de jerarquía en Discord (member.roles.highest.position).
 * En Discord, un número de posición más alto significa un rango mayor.
 * 
 * Si el rol más alto del usuario tiene una posición mayor o igual a la posición
 * del rol militar mínimo configurado (ej: "Sargento"), se autoriza la orden.
 */

const { PermissionsBitField } = require('discord.js');
const storageManager = require('./storageManager');

/**
 * Verifica si un miembro del servidor cumple con el rango militar mínimo requerido.
 * @param {import('discord.js').GuildMember} member - Miembro que ejecutó la orden
 * @returns {{ allowed: boolean, userRoleName: string, minRoleName: string, message?: string }}
 */
function checkMilitaryRank(member) {
  // Si el usuario es el dueño del servidor o tiene permiso de Administrador global, tiene pase militar absoluto
  if (member.id === member.guild.ownerId || member.permissions.has(PermissionsBitField.Flags.Administrator)) {
    return {
      allowed: true,
      userRoleName: member.roles.highest.name,
      minRoleName: storageManager.getConfig().minRoleName
    };
  }

  const currentConfig = storageManager.getConfig();
  const minRoleName = currentConfig.minRoleName || 'Sargento';

  // Buscar el rol militar requerido en el servidor (por nombre insensible a mayúsculas o por ID)
  const targetRole = member.guild.roles.cache.find(
    role => role.name.toLowerCase() === minRoleName.toLowerCase() || role.id === minRoleName
  );

  // Si por alguna razón el rol militar no existe en el servidor, permitimos a los oficiales con Gestionar Servidor
  if (!targetRole) {
    const hasManageGuild = member.permissions.has(PermissionsBitField.Flags.ManageGuild);
    return {
      allowed: hasManageGuild,
      userRoleName: member.roles.highest.name,
      minRoleName,
      message: hasManageGuild
        ? null
        : `⚠️ [AVISO TÁCTICO] El rol militar de rango mínimo "${minRoleName}" no fue encontrado en este servidor. Se requiere permiso de "Gestionar Servidor" temporalmente.`
    };
  }

  // Comparación matemática de jerarquía en Discord
  const userHighestPosition = member.roles.highest.position;
  const requiredPosition = targetRole.position;

  if (userHighestPosition >= requiredPosition) {
    return {
      allowed: true,
      userRoleName: member.roles.highest.name,
      minRoleName: targetRole.name
    };
  }

  return {
    allowed: false,
    userRoleName: member.roles.highest.name,
    minRoleName: targetRole.name,
    message: `⚠️ **ACCESO DENEGADO POR JERARQUÍA MILITAR**\n\nTu rango militar más alto (**${member.roles.highest.name}**) está por debajo del rango mínimo requerido para esta orden táctica (**${targetRole.name}**).\n\n*¡Preséntate ante un superior si consideras que mereces un ascenso de rango!*`
  };
}

module.exports = {
  checkMilitaryRank
};
