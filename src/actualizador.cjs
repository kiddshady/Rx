'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   Rx — actualizaciones automáticas

   electron-updater consulta los releases de GitHub declarados en
   `build.publish`, descarga una versión nueva en segundo plano y la instala
   cuando la persona decide reiniciar. Acá no hay diálogos del sistema: sólo
   estado, que el renderer presenta con la estética de la app.

   En desarrollo no se busca nada porque no existe `app-update.yml`.

   Fases: inactivo · buscando · al-dia · disponible · descargando · listo · error
   ═══════════════════════════════════════════════════════════════════════════ */

const { app, ipcMain } = require('electron');

const CANAL = 'actualizacion:estado';
const ESPERA_INICIAL = 6000;

let autoUpdater = null;
let ventana = () => null;
let estado = {
  fase: 'inactivo',
  version: app.getVersion(),
  manual: false,
  motivo: app.isPackaged ? 'sin-iniciar' : 'dev',
};

function emitir(patch) {
  estado = { ...estado, ...patch, version: app.getVersion() };
  const w = ventana();
  if (w && !w.isDestroyed()) w.webContents.send(CANAL, estado);
  return estado;
}

/** Mantiene la misma envoltura {ok,data|error} que el resto del IPC. */
function handle(canal, fn) {
  ipcMain.handle(canal, async (_e, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });
}

/** Se registra también en desarrollo y tests para que el puente siempre exista. */
function registrarIPC() {
  handle('actualizacion:estado', () => estado);
  handle('actualizacion:buscar', () => buscar(true));
  ipcMain.on('actualizacion:instalar', () => {
    if (!autoUpdater || estado.fase !== 'listo') return;
    /* Silencioso y con reapertura: NSIS reemplaza la app y vuelve a mostrarla
       ya actualizada. `before-quit` cierra antes la base y drena su WAL. */
    setImmediate(() => autoUpdater.quitAndInstall(true, true));
  });
}

/** Arranca el chequeo real sólo dentro de la aplicación empaquetada. */
function iniciar(getWin, { auto = true } = {}) {
  ventana = getWin;
  if (!app.isPackaged) {
    emitir({ fase: 'inactivo', motivo: 'dev' });
    return;
  }

  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (err) {
    emitir({ fase: 'error', error: `No cargó electron-updater: ${err.message}` });
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;

  autoUpdater.on('checking-for-update', () => emitir({ fase: 'buscando' }));
  autoUpdater.on('update-available', (info) => emitir({
    fase: 'disponible',
    nueva: info.version,
    notas: typeof info.releaseNotes === 'string' ? info.releaseNotes : '',
  }));
  autoUpdater.on('update-not-available', () => emitir({ fase: 'al-dia', revisado: Date.now() }));
  autoUpdater.on('download-progress', (p) => emitir({
    fase: 'descargando', progreso: p.percent, velocidad: p.bytesPerSecond, total: p.total,
  }));
  autoUpdater.on('update-downloaded', (info) =>
    emitir({ fase: 'listo', nueva: info.version, progreso: 100 }));
  autoUpdater.on('error', (err) =>
    emitir({ fase: 'error', error: err?.message || String(err) }));

  /* Buscar en el primer frame compite con el splash, la cerradura y la base.
     Se deja respirar la app y recién después se consulta GitHub. */
  if (auto) setTimeout(() => buscar(false), ESPERA_INICIAL);
}

async function buscar(manual = false) {
  if (!autoUpdater) {
    return emitir({
      fase: 'inactivo',
      motivo: app.isPackaged ? 'sin-actualizador' : 'dev',
      manual,
    });
  }
  if (estado.fase === 'descargando' || estado.fase === 'listo') return emitir({ manual });

  emitir({ fase: 'buscando', manual });
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    emitir({ fase: 'error', error: err?.message || String(err) });
  }
  return estado;
}

module.exports = { registrarIPC, iniciar, buscar, get estado() { return estado; } };
