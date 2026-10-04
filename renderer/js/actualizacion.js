/* ═══════════════════════════════════════════════════════════════════════════
   Rx — actualizaciones (renderer)

   El proceso principal descarga; acá se presenta el estado en tres lugares:
   statusbar, toast al quedar lista y controles dentro de Ajustes. El chequeo
   automático es silencioso cuando la app ya está al día.
   ═══════════════════════════════════════════════════════════════════════════ */

import { Icons } from './icons.js';
import { Toast } from './overlays.js';
import Router from './router.js';
import { esc } from './ui.js';
import { swap, deslizarAncho } from './motion.js';
import { fmtBytes, relTime } from './format.js';

const rx = window.rx;

let estado = { fase: 'inactivo', manual: false };
let avisada = null;
const oyentes = new Set();

export function estadoActualizacion() { return estado; }

export function onActualizacion(fn) {
  oyentes.add(fn);
  return () => oyentes.delete(fn);
}

export function describirEstado(e = estado) {
  switch (e.fase) {
    case 'buscando': return 'Buscando…';
    case 'al-dia': return `Al día${e.revisado ? ` · revisado ${relTime(e.revisado)}` : ''}.`;
    case 'disponible': return `Hay una versión nueva, la ${e.nueva}. Se está descargando.`;
    case 'descargando': return `Descargando la ${e.nueva}: ${Math.round(e.progreso || 0)} %${e.velocidad ? ` · ${fmtBytes(e.velocidad)}/s` : ''}.`;
    case 'listo': return `La ${e.nueva} ya está descargada. Se instala al reiniciar.`;
    case 'error': return `No se pudo buscar: ${e.error || 'error desconocido'}.`;
    default:
      return e.motivo === 'dev'
        ? 'Las actualizaciones automáticas corren sólo en la app instalada.'
        : 'Todavía no se buscó.';
  }
}

function pintarStatusbar() {
  const el = document.getElementById('stat-update');
  if (!el) return;
  const f = estado.fase;
  const visible = f === 'disponible' || f === 'descargando' || f === 'listo'
    || (f === 'buscando' && estado.manual);
  el.hidden = !visible;
  if (!visible) return;

  const texto = {
    buscando: 'buscando actualización…',
    disponible: `Rx ${estado.nueva} disponible`,
    descargando: `descargando ${estado.nueva}`,
    listo: `Reiniciar y actualizar a ${estado.nueva}`,
  }[f];
  el.classList.toggle('is-lista', f === 'listo');
  /* El rótulo cambia por relevo y el ancho del ítem viaja, en vez de saltar y
     empujar lo de al lado. El avance de la descarga NO va en el HTML: con él
     adentro, cada evento de progreso relevaría el aviso entero. Se escribe en
     la barra que ya está. */
  const html = `${Icons.svg(f === 'listo' ? 'retry' : 'download')}`
    + `<span class="ox-statusbar__value">${esc(texto)}</span>`
    + (f === 'descargando' ? '<span class="ox-meter"><span class="ox-meter__fill"></span></span>' : '');
  deslizarAncho(el, () => swap(el, html, { relevo: true }));
  // `:scope >`: durante el relevo, la barra de antes sigue en el calco que se va.
  el.querySelector(':scope > .ox-meter')?.style.setProperty('--ox-pct', `${Math.round(estado.progreso || 0)}%`);
  el.dataset.tip = f === 'listo'
    ? 'Cierra Rx, instala la versión nueva y la vuelve a abrir'
    : f === 'descargando'
      ? `${Math.round(estado.progreso || 0)} %${estado.velocidad ? ` · ${fmtBytes(estado.velocidad)}/s` : ''}`
      : 'Ver en Ajustes';
}

function aplicar(e) {
  estado = e || { fase: 'inactivo', manual: false };
  pintarStatusbar();

  if (estado.fase === 'listo' && avisada !== estado.nueva) {
    avisada = estado.nueva;
    Toast.show({
      title: `Rx ${estado.nueva} está lista`,
      text: 'Se instala al reiniciar. Tocá el aviso de la barra cuando quieras.',
      icon: 'download',
      duration: 9000,
    });
  } else if (estado.manual && estado.fase === 'al-dia') {
    Toast.show({ title: 'Estás al día', text: `La ${estado.version} es la última versión.`, icon: 'check' });
  } else if (estado.manual && estado.fase === 'error') {
    Toast.error('No se pudo buscar la actualización', estado.error);
  }
  for (const fn of oyentes) fn(estado);
}

export async function buscarActualizacion() {
  if (!rx?.actualizacion) return estado;
  try {
    await rx.actualizacion.buscar();
  } catch (err) {
    aplicar({ ...estado, fase: 'error', error: err.message, manual: true });
  }
  return estado;
}

export function instalarActualizacion() {
  rx?.actualizacion?.instalar();
}

export async function initActualizacion() {
  if (!rx?.actualizacion) return;
  document.getElementById('stat-update')?.addEventListener('click', () => {
    if (estado.fase === 'listo') instalarActualizacion();
    else Router.go('ajustes');
  });
  rx.actualizacion.onEstado(aplicar);
  try {
    aplicar(await rx.actualizacion.estado());
  } catch {
    aplicar({ fase: 'inactivo', manual: false });
  }
}
