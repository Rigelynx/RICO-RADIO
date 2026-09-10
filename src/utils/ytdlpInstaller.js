// INSTALADOR AUTOMATICO DE YT-DLP PARA LINUX
'use strict';

const path = require('path');
const fss = require('fs');
const https = require('https');

const YTDLP_DIR = path.join(__dirname, '..', '..', 'node_modules', 'youtube-dl-exec', 'bin');
const YTDLP_BIN = path.join(YTDLP_DIR, 'yt-dlp');
const YTDLP_BIN_WIN = path.join(YTDLP_DIR, 'yt-dlp.exe');
const YTDLP_LINUX_ASSET = process.arch === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux';
const YTDLP_LINUX_URL = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${YTDLP_LINUX_ASSET}`;

function isLinuxExecutable(binaryPath) {
  try {
    const header = Buffer.alloc(4);
    const descriptor = fss.openSync(binaryPath, 'r');
    fss.readSync(descriptor, header, 0, header.length, 0);
    fss.closeSync(descriptor);
    return header.toString('hex') === '7f454c46';
  } catch {
    return false;
  }
}

async function ensureYtDlpBinary() {
  if (process.platform !== 'linux') {
    if (fss.existsSync(YTDLP_BIN_WIN)) {
      console.log('[yt-dlp] Binario Windows: ' + YTDLP_BIN_WIN);
      return YTDLP_BIN_WIN;
    }
    return 'yt-dlp';
  }
  if (fss.existsSync(YTDLP_BIN)) {
    try {
      fss.chmodSync(YTDLP_BIN, '755');
      if (isLinuxExecutable(YTDLP_BIN)) {
        console.log('[yt-dlp] Binario Linux ELF listo: ' + YTDLP_BIN);
        return YTDLP_BIN;
      }
      console.warn('[yt-dlp] Binario incompatible. Descargando binario Linux...');
    } catch (e) {
      console.warn('[yt-dlp] Error verificacion: ' + e.message);
    }
  }
  try {
    if (!fss.existsSync(YTDLP_DIR)) fss.mkdirSync(YTDLP_DIR, { recursive: true });
    await downloadFile(YTDLP_LINUX_URL, YTDLP_BIN);
    if (!isLinuxExecutable(YTDLP_BIN)) {
      throw new Error('La descarga no contiene un ejecutable Linux valido.');
    }
    fss.chmodSync(YTDLP_BIN, '755');
    console.log('[yt-dlp] Binario Linux instalado: ' + YTDLP_BIN);
    return YTDLP_BIN;
  } catch (e) {
    console.error('[yt-dlp] No se pudo descargar: ' + e.message);
    return 'yt-dlp';
  }
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const tmpPath = destPath + '.tmp';
    const file = fss.createWriteStream(tmpPath);
    function doRequest(reqUrl) {
      https.get(reqUrl, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          if (!res.headers.location) {
            reject(new Error('Redireccion sin destino.'));
            return;
          }
          res.destroy();
          doRequest(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          file.destroy();
          try { fss.unlinkSync(tmpPath); } catch {}
          reject(new Error('HTTP ' + res.statusCode));
          return;
        }
        const total = parseInt(res.headers['content-length'] || '0', 10);
        let done = 0; let last = 0;
        res.on('data', c => {
          done += c.length;
          if (total > 0 && Date.now() - last > 3000) {
            console.log('[yt-dlp] Descargando... ' + Math.round(done / total * 100) + '%');
            last = Date.now();
          }
        });
        res.pipe(file);
        file.on('finish', () => file.close(() => {
          try { fss.renameSync(tmpPath, destPath); resolve(); } catch (e2) { reject(e2); }
        }));
        file.on('error', e => { try { fss.unlinkSync(tmpPath); } catch {} reject(e); });
      }).on('error', e => {
        file.destroy();
        try { fss.unlinkSync(tmpPath); } catch {}
        reject(e);
      });
    }
    doRequest(url);
  });
}

module.exports = { ensureYtDlpBinary };
