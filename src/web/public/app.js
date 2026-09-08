/**
 * CLIENTE INTERACTIVO DEL PANEL TÁCTICO - SARGENTO RICO
 * 
 * Gestiona la sincronización en tiempo real con el bot, la actualización de
 * configuraciones y el generador de comandos Slash de Discord.
 */

document.addEventListener('DOMContentLoaded', () => {
  // Elementos del DOM
  const botStatusIndicator = document.getElementById('botStatusIndicator');
  const botStatusText = document.getElementById('botStatusText');
  const botPing = document.getElementById('botPing');
  const voiceStatus = document.getElementById('voiceStatus');
  const adminKeyInput = document.getElementById('adminKeyInput');
  const btnSaveKey = document.getElementById('btnSaveKey');

  // Controles de formulario
  const minRoleSelect = document.getElementById('minRoleSelect');
  const hierarchyExplanation = document.getElementById('hierarchyExplanation');
  const ttsToggleCheckbox = document.getElementById('ttsToggleCheckbox');
  const ttsChannelSelect = document.getElementById('ttsChannelSelect');
  const ttsLangSelect = document.getElementById('ttsLangSelect');
  const defaultAudioUrlInput = document.getElementById('defaultAudioUrlInput');
  const currentTrackTitle = document.getElementById('currentTrackTitle');
  const currentTrackLoop = document.getElementById('currentTrackLoop');

  // Asistente de comandos
  const cmdChannel = document.getElementById('cmdChannel');
  const cmdToggle = document.getElementById('cmdToggle');
  const cmdLang = document.getElementById('cmdLang');

  // Guardado
  const btnSaveAll = document.getElementById('btnSaveAll');
  const saveFeedback = document.getElementById('saveFeedback');

  // Cargar clave guardada en localStorage
  const savedKey = localStorage.getItem('sargento_admin_key');
  if (savedKey) {
    adminKeyInput.value = savedKey;
  }

  btnSaveKey.addEventListener('click', () => {
    localStorage.setItem('sargento_admin_key', adminKeyInput.value.trim());
    showFeedback('🔑 Clave militar guardada localmente.', 'success');
  });

  // 1. OBTENER ESTADO DEL SISTEMA Y BOT
  async function fetchStatus() {
    try {
      const res = await fetch('/api/status');
      if (!res.ok) throw new Error('Sin respuesta');
      const data = await res.json();

      if (data.bot.online) {
        botStatusIndicator.style.borderColor = 'rgba(37, 162, 90, 0.6)';
        botStatusIndicator.style.color = '#25a25a';
        botStatusText.textContent = `EN LÍNEA (${data.bot.tag})`;
        botPing.textContent = `${data.bot.ping} ms`;
      } else {
        botStatusIndicator.style.borderColor = 'rgba(230, 60, 60, 0.6)';
        botStatusIndicator.style.color = '#e63c3c';
        botStatusText.textContent = 'BOT DESCONECTADO';
        botPing.textContent = '-- ms';
      }

      // Estado de Voz
      if (data.voice.isConnected) {
        voiceStatus.textContent = data.voice.status.toUpperCase();
        voiceStatus.style.color = '#25a25a';
      } else {
        voiceStatus.textContent = 'DESCONECTADO';
        voiceStatus.style.color = '#8b9c90';
      }

      // Pista actual
      if (data.voice.currentTrack) {
        currentTrackTitle.textContent = data.voice.currentTrack.title;
        currentTrackLoop.textContent = data.voice.isLooping ? 'ACTIVADO' : 'DESACTIVADO';
      } else {
        currentTrackTitle.textContent = 'Silencio de radio';
        currentTrackLoop.textContent = 'Inactivo';
      }

    } catch {
      botStatusText.textContent = 'ERROR DE CONEXIÓN CON EL SERVIDOR';
      botPing.textContent = '-- ms';
    }
  }

  // 2. OBTENER ROLES Y CANALES DE DISCORD
  async function loadRolesAndChannels() {
    try {
      // Roles
      const rolesRes = await fetch('/api/roles');
      const roles = await rolesRes.json();
      if (Array.isArray(roles) && roles.length > 0) {
        minRoleSelect.innerHTML = '';
        roles.forEach(role => {
          const opt = document.createElement('option');
          opt.value = role.name;
          opt.textContent = `[Posición: ${role.position}] ${role.name}`;
          minRoleSelect.appendChild(opt);
        });
      } else {
        minRoleSelect.innerHTML = '<option value="Sargento">Sargento (Por defecto)</option>';
      }

      // Canales
      const channelsRes = await fetch('/api/channels');
      const channels = await channelsRes.json();
      if (Array.isArray(channels) && channels.length > 0) {
        ttsChannelSelect.innerHTML = '<option value="">-- Selecciona un canal de texto --</option>';
        channels.forEach(ch => {
          const opt = document.createElement('option');
          opt.value = ch.id;
          opt.textContent = `#${ch.name}`;
          ttsChannelSelect.appendChild(opt);
        });
      } else {
        ttsChannelSelect.innerHTML = '<option value="">Sin canales disponibles</option>';
      }
    } catch (err) {
      console.warn('No se pudieron precargar roles o canales:', err);
    }
  }

  // 3. CARGAR CONFIGURACIÓN PERSISTENTE ACTUAL
  async function loadConfig() {
    try {
      const res = await fetch('/api/config');
      const cfg = await res.json();

      if (cfg.minRoleName) {
        minRoleSelect.value = cfg.minRoleName;
      }
      ttsToggleCheckbox.checked = Boolean(cfg.ttsEnabled);
      if (cfg.ttsChannelId) {
        ttsChannelSelect.value = cfg.ttsChannelId;
      }
      if (cfg.ttsLang) {
        ttsLangSelect.value = cfg.ttsLang;
      }
      if (cfg.defaultAudioUrl) {
        defaultAudioUrlInput.value = cfg.defaultAudioUrl;
      }

      updateCommandAssistant();
    } catch (err) {
      console.error('Error cargando configuración:', err);
    }
  }

  // 4. ACTUALIZAR VISOR DE COMANDOS SLASH EQUIVALENTES
  function updateCommandAssistant() {
    // Canal
    const selectedChannelOpt = ttsChannelSelect.options[ttsChannelSelect.selectedIndex];
    const channelName = selectedChannelOpt && selectedChannelOpt.value ? selectedChannelOpt.textContent : '#canal';
    cmdChannel.textContent = `/sargento-rico tts-canal canal:${channelName}`;

    // Toggle
    cmdToggle.textContent = `/sargento-rico tts-toggle`;

    // Idioma
    const lang = ttsLangSelect.value || 'es';
    cmdLang.textContent = `/sargento-rico tts-idioma codigo:${lang}`;

    // Explicación de jerarquía
    const selectedRole = minRoleSelect.value || 'Sargento';
    hierarchyExplanation.innerHTML = `Los miembros con rol <strong>${selectedRole}</strong> o superior tendrán pase militar para ejecutar <code>tts-canal</code>, <code>tts-toggle</code> y <code>tts-idioma</code>. La tropa podrá usar siempre <code>play</code>, <code>stop</code>, <code>decir</code> y <code>volumen</code>.`;
  }

  // Eventos de cambios en formularios para actualizar el asistente en vivo
  minRoleSelect.addEventListener('change', updateCommandAssistant);
  ttsChannelSelect.addEventListener('change', updateCommandAssistant);
  ttsLangSelect.addEventListener('change', updateCommandAssistant);
  ttsToggleCheckbox.addEventListener('change', updateCommandAssistant);

  // 5. GUARDAR Y APLICAR CAMBIOS
  btnSaveAll.addEventListener('click', async () => {
    const adminKey = adminKeyInput.value.trim();

    if (!adminKey) {
      showFeedback('⚠️ Debes ingresar la clave militar (WEB_ADMIN_KEY) para autorizar cambios.', 'error');
      return;
    }

    const payload = {
      minRoleName: minRoleSelect.value,
      ttsEnabled: ttsToggleCheckbox.checked,
      ttsChannelId: ttsChannelSelect.value || null,
      ttsLang: ttsLangSelect.value,
      defaultAudioUrl: defaultAudioUrlInput.value.trim()
    };

    btnSaveAll.disabled = true;
    btnSaveAll.style.opacity = '0.6';

    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-key': adminKey
        },
        body: JSON.stringify(payload)
      });

      const data = await res.json();

      if (res.ok && data.success) {
        showFeedback('🎖️ ¡ORDEN TRANSMITIDA! Cambios aplicados y sincronizados con el bot con éxito.', 'success');
        updateCommandAssistant();
      } else {
        showFeedback(`❌ FALLO: ${data.message || 'No se pudo guardar la configuración.'}`, 'error');
      }
    } catch (err) {
      showFeedback('❌ Error de comunicación con el servidor del bot.', 'error');
    } finally {
      btnSaveAll.disabled = false;
      btnSaveAll.style.opacity = '1';
    }
  });

  function showFeedback(text, type) {
    saveFeedback.textContent = text;
    saveFeedback.className = `save-feedback ${type === 'success' ? 'feedback-success' : 'feedback-error'}`;
    setTimeout(() => {
      saveFeedback.textContent = '';
    }, 6000);
  }

  // 6. BOTONES DE COPIAR COMANDO AL PORTAPAPELES
  document.querySelectorAll('.btn-copy').forEach(button => {
    button.addEventListener('click', () => {
      const targetId = button.getAttribute('data-target');
      const textToCopy = document.getElementById(targetId).textContent;

      navigator.clipboard.writeText(textToCopy).then(() => {
        const originalText = button.textContent;
        button.textContent = '¡Copiado!';
        button.style.background = '#25a25a';
        button.style.color = '#fff';

        setTimeout(() => {
          button.textContent = originalText;
          button.style.background = '';
          button.style.color = '';
        }, 1500);
      });
    });
  });

  // Inicialización
  (async () => {
    await fetchStatus();
    await loadRolesAndChannels();
    await loadConfig();

    // Actualizar estado cada 5 segundos
    setInterval(fetchStatus, 5000);
  })();
});
