'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   Rx — puente IPC

   El renderer no tiene fs, ni require, ni la clave de cifrado. Todo lo que
   necesita pasa por acá, y acá se decide qué se puede pedir.

   La regla que ordena este archivo: TODO handler de dominio pasa por
   `conBase()`. Si la base está cerrada, tira. Así "bloqueado" no es un estado
   que la interfaz tenga que recordar respetar —lo cual sería cuestión de
   tiempo hasta que una vista se olvide— sino algo que el proceso principal
   hace cumplir, con la clave fuera del alcance del renderer.
   ═══════════════════════════════════════════════════════════════════════════ */

const { ipcMain, app, dialog, shell, BrowserWindow } = require('electron');
const fsp = require('fs/promises');
const path = require('path');
const store = require('./store.cjs');
const rutas = require('./rutas.cjs');
const llave = require('./llave.cjs');
const db = require('./db.cjs');
const impresion = require('./impresion.cjs');

/* La clave derivada, solo en el proceso principal y solo mientras la app está
   desbloqueada. No sale de este módulo ni se serializa a ningún lado. */
let claveActual = null;

/** Minutos de inactividad antes del bloqueo automático. 0 lo desactiva. */
let minutosInactividad = 0;
let relojInactividad = null;
let alBloquear = () => { };

function ventana() { return BrowserWindow.getAllWindows()[0] || null; }

function bloquear(motivo = 'manual') {
  db.cerrar();
  claveActual = null;
  clearTimeout(relojInactividad);
  relojInactividad = null;
  const w = ventana();
  if (w && !w.isDestroyed()) w.webContents.send('sesion:bloqueada', motivo);
  alBloquear(motivo);
}

function reiniciarInactividad() {
  clearTimeout(relojInactividad);
  relojInactividad = null;
  if (!db.abierta() || !minutosInactividad) return;
  relojInactividad = setTimeout(() => bloquear('inactividad'), minutosInactividad * 60_000);
}

async function tomarAjustes() {
  const s = await store.loadSettings();
  minutosInactividad = Math.max(0, Number(s?.bloqueoInactividad) || 0);
  reiniciarInactividad();
  return s;
}

function handle(canal, fn) {
  ipcMain.handle(canal, async (_e, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (err) {
      console.error(`[ipc] ${canal}:`, err);
      return { ok: false, error: err?.message || String(err) };
    }
  });
}

/** Envuelve un handler de dominio: exige base abierta y renueva la inactividad. */
function conBase(fn) {
  return (...args) => {
    if (!db.abierta()) throw new Error('La app está bloqueada.');
    reiniciarInactividad();
    return fn(...args);
  };
}

/* ── Sesión ──────────────────────────────────────────────────────────────── */

function registrarSesion() {
  handle('sesion:estado', async () => ({
    ...(await llave.estado()),
    abierta: db.abierta(),
    carpeta: rutas.raiz(),
  }));

  /** Primera vez: crea la contraseña y con ella la base. */
  handle('sesion:configurar', async (password, recordar) => {
    if (db.abierta()) throw new Error('La sesión ya está abierta.');
    if ((await llave.estado()).configurada) {
      throw new Error('Ya hay una contraseña configurada en esta instalación.');
    }
    const clave = await llave.configurar(password);
    db.abrir(clave);
    claveActual = clave;
    if (recordar) await llave.recordar(clave).catch(() => { /* no es fatal */ });
    await tomarAjustes();
    return true;
  });

  handle('sesion:abrir', async (password, recordar) => {
    if (db.abierta()) return true;
    const clave = await llave.derivarGuardada(password);
    db.abrir(clave);                 // tira "Contraseña incorrecta" si no va
    claveActual = clave;
    if (recordar) await llave.recordar(clave).catch(() => { /* no es fatal */ });
    else await llave.olvidar();
    await tomarAjustes();
    return true;
  });

  /** Desbloqueo sin contraseña usando la clave guardada con safeStorage. */
  handle('sesion:abrir-recordada', async () => {
    if (db.abierta()) return true;
    const clave = await llave.recuperarRecordada();
    if (!clave) return false;
    try {
      db.abrir(clave);
    } catch {
      /* La clave recordada ya no sirve (cambió la contraseña en otra máquina,
         o el blob es de otra cuenta). Se descarta y se pide contraseña. */
      await llave.olvidar();
      return false;
    }
    claveActual = clave;
    await tomarAjustes();
    return true;
  });

  handle('sesion:bloquear', () => { bloquear('manual'); return true; });

  handle('sesion:cambiar-clave', conBase(async (actual, nueva) => {
    const verifica = await llave.derivarGuardada(actual);
    if (!claveActual || !verifica.equals(claveActual)) {
      throw new Error('La contraseña actual no es correcta.');
    }
    if (String(nueva) === String(actual)) {
      throw new Error('La contraseña nueva tiene que ser distinta de la actual.');
    }
    const clave = await llave.reconfigurar(nueva);
    db.recifrar(clave);
    claveActual = clave;
    return true;
  }));

  handle('sesion:olvidar-pc', async () => { await llave.olvidar(); return true; });

  /** El renderer avisa que hubo actividad real (teclado o mouse). */
  ipcMain.on('sesion:actividad', () => reiniciarInactividad());
}

/* ── Dominio ─────────────────────────────────────────────────────────────── */

function registrarDominio() {
  handle('resumen', conBase(() => db.resumen()));

  handle('medico:get', conBase(() => db.medico.get()));
  handle('medico:save', conBase((d) => db.medico.save(d)));

  handle('pacientes:list', conBase((opts) => db.pacientes.list(opts || {})));
  handle('pacientes:get', conBase((id) => db.pacientes.get(id)));
  handle('pacientes:save', conBase((d) => db.pacientes.save(d)));
  handle('pacientes:archivar', conBase((id, v) => db.pacientes.archivar(id, v)));
  handle('pacientes:remove', conBase((id) => db.pacientes.remove(id)));

  handle('evoluciones:list', conBase((pid) => db.evoluciones.list(pid)));
  handle('evoluciones:save', conBase((d) => db.evoluciones.save(d)));
  handle('evoluciones:remove', conBase((id) => db.evoluciones.remove(id)));

  handle('medicamentos:list', conBase((opts) => db.medicamentos.list(opts || {})));
  handle('medicamentos:save', conBase((d) => db.medicamentos.save(d)));
  handle('medicamentos:remove', conBase((id) => db.medicamentos.remove(id)));

  handle('estudios:list', conBase((opts) => db.estudios.list(opts || {})));
  handle('estudios:save', conBase((d) => db.estudios.save(d)));
  handle('estudios:remove', conBase((id) => db.estudios.remove(id)));

  handle('recetas:emitir', conBase((d) => db.recetas.emitir(d)));
  handle('recetas:get', conBase((id) => db.recetas.get(id)));
  handle('recetas:list', conBase((opts) => db.recetas.list(opts || {})));
  handle('recetas:remove', conBase((id) => db.recetas.remove(id)));
  handle('recetas:vaciar', conBase(() => db.recetas.vaciar()));

  /* La vista previa NO pasa por acá: el renderer arma la hoja con el mismo
     módulo de plantilla que usa la ventana de impresión. Un viaje de IPC por
     tecla apretada sería lento y, peor, abriría la puerta a que la previa y el
     papel se pintaran con código distinto. */
  handle('recetas:pdf', conBase((id) => impresion.aPdf(ventana(), id)));
  handle('recetas:imprimir', conBase((id) => impresion.aImpresora(id)));

  handle('ordenes:emitir', conBase((d) => db.ordenes.emitir(d)));
  handle('ordenes:get', conBase((id) => db.ordenes.get(id)));
  handle('ordenes:list', conBase((opts) => db.ordenes.list(opts || {})));
  handle('ordenes:remove', conBase((id) => db.ordenes.remove(id)));
  handle('ordenes:vaciar', conBase(() => db.ordenes.vaciar()));
  handle('ordenes:pdf', conBase((id) => impresion.aPdfOrden(ventana(), id)));
  handle('ordenes:imprimir', conBase((id) => impresion.aImpresoraOrden(id)));
}

/* ── Respaldo ────────────────────────────────────────────────────────────── */

function registrarRespaldo() {
  handle('respaldo:exportar', conBase(async () => {
    const sello = new Date().toISOString().slice(0, 10);
    const res = await dialog.showSaveDialog(ventana(), {
      title: 'Guardar respaldo cifrado',
      defaultPath: `rx-respaldo-${sello}.db`,
      filters: [{ name: 'Base cifrada de Rx', extensions: ['db'] }],
    });
    if (res.canceled || !res.filePath) return { cancelado: true };
    db.respaldar(res.filePath);
    return { cancelado: false, ruta: res.filePath };
  }));

  handle('respaldo:carpeta', conBase(() => {
    shell.openPath(rutas.raiz());
    return rutas.raiz();
  }));

  /* Importar el store.json del prototipo viejo. Es de un solo sentido y no
     pisa nada: todo lo que trae se AGREGA a lo que ya haya. */
  handle('migracion:prototipo', conBase(async (rutaArchivo) => {
    let ruta = rutaArchivo;
    if (!ruta) {
      const res = await dialog.showOpenDialog(ventana(), {
        title: 'Elegí el store.json del prototipo',
        filters: [{ name: 'Datos del prototipo', extensions: ['json'] }],
        properties: ['openFile'],
      });
      if (res.canceled || !res.filePaths?.[0]) return { cancelado: true };
      ruta = res.filePaths[0];
    }
    const crudo = JSON.parse(await fsp.readFile(ruta, 'utf8'));
    return importarPrototipo(crudo);
  }));
}

/** Traduce el store.json del prototipo al esquema nuevo. */
function importarPrototipo(crudo) {
  const cuenta = { pacientes: 0, medicamentos: 0, medico: false };

  if (crudo?.medico && Object.keys(crudo.medico).length) {
    const m = crudo.medico;
    db.medico.save({
      apellido_nombre: m.apellidoNombre || '', matricula: m.matricula || '',
      especialidad: m.especialidad || '', colegio: m.colegio || '',
      licencia_sanitaria: m.licenciaSanitaria || '', fecha_vigencia: m.fechaVigencia || '',
      domicilio: '', telefono: '',
    });
    cuenta.medico = true;
  }

  for (const p of crudo?.pacientes || []) {
    if (!p?.apellidoNombre) continue;
    db.pacientes.save({
      apellido_nombre: p.apellidoNombre, dni: p.dni || '', cuil: p.cuil || '',
      sexo: p.sexo || '', nacimiento: p.nacimiento || '', domicilio: p.domicilio || '',
      cobertura: p.cobertura || '',
    });
    cuenta.pacientes += 1;
  }

  for (const m of crudo?.medicamentos || []) {
    if (!m?.nombre) continue;
    db.medicamentos.save({
      nombre: m.nombre, marca: m.marca || '', dosis: m.dosis || '',
      envases: m.envases || 1, diagnostico: m.diagnostico || '',
      indicaciones: m.indicaciones || '',
    });
    cuenta.medicamentos += 1;
  }

  return { cancelado: false, ...cuenta };
}

/* ── Registro ────────────────────────────────────────────────────────────── */

function register(opciones = {}) {
  alBloquear = opciones.alBloquear || (() => { });

  handle('app:info', () => ({
    name: app.getName(),
    version: app.getVersion(),
    dataDir: rutas.raiz(),
    electron: process.versions.electron,
    esquema: db.ESQUEMA,
    /* El tope legal viaja al renderer en vez de estar escrito de nuevo en la
       vista: el numero es uno solo y sale de donde se hace cumplir. */
    maxMedicamentos: db.MAX_MEDICAMENTOS,
  }));

  handle('settings:get', () => store.loadSettings());
  handle('settings:save', async (patch) => {
    const s = await store.saveSettings(patch);
    minutosInactividad = Math.max(0, Number(s?.bloqueoInactividad) || 0);
    reiniciarInactividad();
    return s;
  });

  registrarSesion();
  registrarDominio();
  registrarRespaldo();
}

module.exports = { register, bloquear, importarPrototipo };
