/* ═══════════════════════════════════════════════════════════════════════════
   Rx — arranque y shell

   El orden importa: NADA de dominio se pide antes de que la base esté abierta.
   Si el proceso principal responde "La app está bloqueada" es porque una vista
   se adelantó, no porque falte un permiso.
   ═══════════════════════════════════════════════════════════════════════════ */

import { Icons } from './icons.js';
import './iconos-rx.js';
import { Tooltip, Toast, Menu, Modal } from './overlays.js';
import Palette from './palette.js';
import Router from './router.js';
import { initClickFlash, initScrollFades } from './motion.js';
import { colorToken, attempt } from './ui.js';
import { pedirClave } from './desbloqueo.js';
import { S, refrescar, pintarChrome } from './tienda.js';
import { initActualizacion } from './actualizacion.js';

import { vistaTablero } from './vistas/tablero.js';
import { vistaPacientes, vistaFicha } from './vistas/pacientes.js';
import { vistaRecetas, vistaReceta } from './vistas/recetas.js';
import { vistaOrdenes, vistaOrden } from './vistas/ordenes.js';
import { vistaMedicamentos } from './vistas/medicamentos.js';
import { vistaEstudios } from './vistas/estudios.js';
import { vistaAjustes } from './vistas/ajustes.js';

const api = window.onyx;
const rx = window.rx;

/* ══ Shell ═══════════════════════════════════════════════════════════════════ */

function cablearShell() {
  document.getElementById('win-min').onclick = () => api.win.minimize();
  document.getElementById('win-max').onclick = () => api.win.toggleMaximize();
  document.getElementById('win-close').onclick = () => api.win.close();

  const btnMax = document.getElementById('win-max');
  api.win.onMaximized((max) => {
    btnMax.innerHTML = Icons.svg(max ? 'winRestore' : 'winMax');
  });

  document.getElementById('btn-palette').onclick = () => Palette.toggle();
  document.getElementById('btn-nueva-receta').onclick = () => Router.go('receta');
  document.getElementById('btn-bloquear').onclick = () => rx.sesion.bloquear();

  /* El rail no se ilumina desde acá: de eso ya se encarga el router, que sabe
     cuál es el `nav` de cada ruta (la ficha de un paciente ilumina Pacientes). */
  for (const b of document.querySelectorAll('.ox-navitem')) {
    b.onclick = () => Router.go(b.dataset.view);
  }
}

/* ══ Color de la ventana ═════════════════════════════════════════════════════
   --ox-bg está en oklch y Electron solo entiende hex. La traducción la hace
   colorToken() con un canvas, no un regex: parseando el texto, la app le
   mandaba VERDE a su propia ventana. */
function sincronizarColor() {
  const hex = colorToken('--ox-bg');
  if (hex) api.win.setBackground(hex);
}

/* ══ Actividad ═══════════════════════════════════════════════════════════════
   El auto-bloqueo lo cuenta el proceso principal, pero quien sabe si hay
   alguien ahí es el renderer. Se le avisa con throttle: sin él, mover el mouse
   manda cientos de mensajes por segundo por el puente. */
function cablearActividad() {
  let ultimo = 0;
  const avisar = () => {
    const t = Date.now();
    if (t - ultimo < 20_000) return;
    ultimo = t;
    rx.sesion.actividad();
  };
  for (const ev of ['pointerdown', 'keydown', 'wheel']) {
    window.addEventListener(ev, avisar, { passive: true });
  }
}

/* ══ Comandos ════════════════════════════════════════════════════════════════ */

function registrarComandos() {
  Palette.clear();
  Palette.register([
    { id: 'nueva-receta', label: 'Nueva receta', group: 'Recetas', icon: 'plus', run: () => Router.go('receta') },
    { id: 'recetas', label: 'Historial de recetas', group: 'Recetas', icon: 'file', run: () => Router.go('recetas') },
    { id: 'nueva-orden', label: 'Nueva orden de estudios', group: 'Órdenes', icon: 'plus', run: () => Router.go('orden') },
    { id: 'ordenes', label: 'Historial de órdenes', group: 'Órdenes', icon: 'orden', run: () => Router.go('ordenes') },
    { id: 'pacientes', label: 'Pacientes', group: 'Ir a', icon: 'users', run: () => Router.go('pacientes') },
    { id: 'medicamentos', label: 'Medicamentos', group: 'Ir a', icon: 'pill', run: () => Router.go('medicamentos') },
    { id: 'estudios', label: 'Estudios', group: 'Ir a', icon: 'estudio', run: () => Router.go('estudios') },
    { id: 'ajustes', label: 'Ajustes', group: 'Ir a', icon: 'settings', run: () => Router.go('ajustes') },
    { id: 'bloquear', label: 'Bloquear la app', group: 'Seguridad', icon: 'lock', run: () => rx.sesion.bloquear() },
    {
      id: 'respaldo', label: 'Guardar un respaldo cifrado', group: 'Seguridad', icon: 'save',
      run: () => attempt(async () => {
        const r = await rx.respaldo.exportar();
        if (!r.cancelado) Toast.show({ title: 'Respaldo guardado', text: r.ruta, icon: 'save' });
      }, { errorTitle: 'No se pudo guardar el respaldo' }),
    },
  ]);
}

/* ══ Sesión ══════════════════════════════════════════════════════════════════ */

/** No resuelve hasta que la base quede abierta. */
async function desbloquear(motivo = 'inicio') {
  const estado = await rx.sesion.estado();
  if (estado.abierta) return;

  /* Si está recordada en esta PC se abre sola y la cerradura ni aparece. */
  if (estado.recordada && await rx.sesion.abrirRecordada()) return;

  await pedirClave(estado, motivo);
}

async function cargarTodo() {
  const [info, ajustes, medico] = await Promise.all([
    api.info(), api.settings.get(), rx.medico.get(),
  ]);
  S.info = info;
  S.ajustes = ajustes;
  S.medico = medico;
  document.getElementById('stat-version').textContent = `v${info.version}`;
  await refrescar();
}

/** Vuelve a la cerradura cuando el proceso principal cierra la base. */
function cablearBloqueo() {
  rx.sesion.onBloqueada(async (motivo) => {
    /* Se vacía la vista antes de mostrar la cerradura: si quedara pintada
       detrás, un dato de paciente seguiría en pantalla —y en el DOM— con la
       app supuestamente bloqueada. */
    document.getElementById('view').innerHTML = '';
    Menu.hide?.();
    await desbloquear(motivo);
    await cargarTodo();
    registrarComandos();
    Router.refresh();
  });
}

/* ══ Arranque ════════════════════════════════════════════════════════════════ */

/* El splash se saca una sola vez, desde donde sea que se llame. Es idempotente
   a propósito: lo llama el arranque normal apenas hay algo abajo, y también el
   `finally` por si el arranque explotó antes de llegar. */
let splashIdo = false;
function quitarSplash() {
  if (splashIdo) return;
  splashIdo = true;
  const splash = document.getElementById('boot-splash');
  if (!splash) return;
  splash.style.opacity = '0';
  splash.addEventListener('transitionend', () => splash.remove(), { once: true });
  setTimeout(() => splash.remove(), 600);
}

async function boot() {
  Icons.mount(document);
  Tooltip.init();
  Palette.init();
  initClickFlash();
  initScrollFades();
  cablearShell();
  cablearActividad();
  sincronizarColor();
  initActualizacion();

  Router.define({
    tablero:      { view: vistaTablero },
    pacientes:    { view: vistaPacientes },
    ficha:        { view: vistaFicha, nav: 'pacientes' },
    recetas:      { view: vistaRecetas },
    receta:       { view: vistaReceta, nav: 'recetas' },
    ordenes:      { view: vistaOrdenes },
    orden:        { view: vistaOrden, nav: 'ordenes' },
    medicamentos: { view: vistaMedicamentos },
    estudios:     { view: vistaEstudios },
    ajustes:      { view: vistaAjustes },
  }, document.getElementById('view'));

  /* El splash se va ANTES de pedir la contraseña. Si esperara a que la sesión
     abriera, taparía la cerradura entera: la app se vería colgada en el logo y
     el campo de contraseña estaría abajo, invisible. */
  quitarSplash();

  await desbloquear('inicio');
  await cargarTodo();
  registrarComandos();
  cablearBloqueo();

  Router.go(S.ajustes.ultimaVista || 'tablero');

  Router.onChange(({ name }) => {
    /* Los contadores del rail y la statusbar se rehacen en CADA navegación.
       Dejar que los actualice quien muta los datos parece más eficiente y es
       una fuente inagotable de cifras viejas: alcanza con que un camino nuevo
       se olvide de avisar. Son cuatro `count(*)` sobre una base local. */
    refrescar().catch(() => { /* si está bloqueada, no hay nada que contar */ });

    /* Se recuerda la sección, nunca el parámetro: guardar "ficha/a3f9…" haría
       que la app abriera sola en el paciente que se estaba mirando, que es
       exactamente lo que no querés que pase si la abrís delante de otro. */
    if (name === 'ficha' || name === 'receta' || name === 'orden') return;
    api.settings.save({ ultimaVista: name }).catch(() => { /* preferencia, no dato */ });
  });

  pintarChrome();
}

boot()
  .catch((err) => {
    console.error('[boot]', err);
    document.getElementById('view').innerHTML =
      `<div class="ox-empty"><div class="ox-empty__title">Rx no pudo arrancar</div>
       <div class="ox-empty__text">${String(err?.message || err)}</div></div>`;
  })
  /* El splash se va SIEMPRE, incluso si el arranque falló: dejarlo puesto sobre
     un error convierte una falla explicable en una app colgada. */
  .finally(quitarSplash);
