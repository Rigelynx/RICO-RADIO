# 🎖️ Sargento Rico • Bot de Discord USMC & Radio Táctica

Bot de Discord desarrollado en **Node.js (discord.js v14)** para servidores de roleplay militar (facción USMC). Incluye estación de radio y música de marcha, sintetizador de voz (TTS) manual y automático con auto-lectura del chat, control de permisos por jerarquía de roles militares y un panel web táctico para su configuración.

---

## ⚡ Características Principales

- 📻 **Radio & Reproductor Militar**: Reproducción de audios y transmisiones de YouTube o enlaces directos mp3 con comandos `/sargento-rico play`, `stop`, `pause`, `resume`, `volumen` y `nowplaying`.
- 📢 **Sintetizador TTS Inteligente**: Lector por voz (`/sargento-rico decir`) que **pausa la música, lee el comunicado y reanuda la música automáticamente**.
- 💬 **Auto-lectura del Chat**: Escucha un canal de texto designado y lee en voz alta los comunicados de los soldados.
- 🛡️ **Jerarquía Militar de Permisos**: Valida la posición numérica del rol más alto (`highest.position`) contra un rango mínimo requerido (ej: *"Sargento"*).
- 🌐 **Mini Panel Web Táctico**: Interfaz web integrada (`http://localhost:3000`) para cambiar ajustes en tiempo real y ver los comandos Slash equivalentes.
- 💡 **Ahorro de Recursos**: Desconexión automática a los 2 minutos si el canal de voz queda vacío y eliminación inmediata de archivos temporales.

---

## 🚀 Instalación y Puesta en Marcha

### 1. Clonar e Instalar Dependencias
```bash
git clone https://github.com/Rigelynx/RICO-RADIO.git
cd RICO-RADIO
npm install
```

### 2. Configurar Variables de Entorno
Copia el archivo `.env.example` como `.env`:
```bash
cp .env.example .env
```
Completa los datos en `.env`:
```env
DISCORD_TOKEN=tu_token_aqui
CLIENT_ID=tu_client_id_aqui
GUILD_ID=tu_guild_id_aqui
PORT=3000
WEB_ADMIN_KEY=sargento123
```

### 3. Registrar los Comandos Slash
```bash
npm run deploy
```

### 4. Iniciar el Bot y el Panel Web
```bash
npm start
```
Abre tu navegador en `http://localhost:3000` para acceder al Centro de Mando Táctico.

---

## 🎖️ Comandos de Discord (/sargento-rico)

| Subcomando | Descripción | Nivel de Acceso |
| :--- | :--- | :--- |
| `play [url] [loop]` | Conecta al canal y reproduce audio o la marcha base | Tropa |
| `stop` | Detiene la radio y desconecta al bot | Tropa |
| `pause` | Pausa táctica de la transmisión | Tropa |
| `resume` | Reanuda la transmisión militar | Tropa |
| `volumen nivel:[0-100]` | Calibra la potencia de salida | Tropa |
| `nowplaying` | Muestra reporte de situación de la radio | Tropa |
| `decir texto:[mensaje]` | El Sargento lee el comunicado por voz (pausa/reanuda música) | Tropa |
| `tts-canal canal:[canal]` | Define el canal de texto vigilado para auto-lectura | **Sargento+** |
| `tts-toggle` | Activa o desactiva la auto-lectura del chat | **Sargento+** |
| `tts-idioma codigo:[es/en/...]` | Cambia el dialecto de la voz del TTS | **Sargento+** |
