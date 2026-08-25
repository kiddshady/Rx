/* Catálogo de estudios frecuentes. No es un nomenclador: es la lista corta de
   lo que esta doctora pide seguido, para no tipearlo cada vez. Se ordena por
   uso, así los de todos los días flotan arriba solos. Mismo criterio que el
   catálogo de medicamentos, que es el hermano de esta vista. */

import { Modal, Toast } from '../overlays.js';
import Router from '../router.js';
import { paint, head, esc, empty, attempt } from '../ui.js';
import { plural } from '../format.js';

const rx = window.rx;

function formulario(e = {}) {
  const caja = document.createElement('div');
  caja.className = 'ox-col';
  caja.style.gap = 'var(--ox-3)';
  caja.innerHTML = `
    <div class="ox-field">
      <label class="ox-field__label" for="e-nombre">Estudio o práctica</label>
      <input class="ox-input" id="e-nombre" spellcheck="false"
             placeholder="Hemograma completo" value="${esc(e.nombre || '')}">
    </div>
    <div class="ox-field">
      <label class="ox-field__label" for="e-aclaracion">Aclaración habitual</label>
      <input class="ox-input" id="e-aclaracion" spellcheck="false"
             placeholder="En ayunas de 8 horas" value="${esc(e.aclaracion || '')}">
      <span class="ox-field__hint">Se carga sola al pedirlo, y se puede cambiar en la orden.</span>
    </div>`;
  return caja;
}

async function editar(e) {
  const cuerpo = formulario(e);
  const val = await Modal.show({
    title: e?.id ? 'Editar estudio' : 'Nuevo estudio',
    body: cuerpo,
    width: 520,
    actions: [
      { label: 'Cancelar', value: null },
      { label: 'Guardar', value: 'ok', variant: 'primary' },
    ],
  });
  if (val !== 'ok') return false;

  const datos = {
    id: e?.id,
    nombre: cuerpo.querySelector('#e-nombre').value,
    aclaracion: cuerpo.querySelector('#e-aclaracion').value,
  };
  const ok = await attempt(() => rx.estudios.save(datos), { errorTitle: 'No se pudo guardar' });
  return ok !== undefined;
}

export async function vistaEstudios(busqueda = '') {
  const lista = await rx.estudios.list({ busqueda });

  paint(head({
    title: 'Estudios',
    /* `plural()` ya trae el número adelante: no se le antepone otro. */
    sub: lista.length
      ? `${plural(lista.length, 'estudio')} en el catálogo`
      : 'Los que pidas seguido, para no volver a tipearlos',
    actions: `<button class="ox-btn ox-btn--primary ox-flashable" id="e-nuevo">
                <i data-icon="plus"></i> Nuevo</button>`,
  }) + `
    <div class="ox-scroll ox-grow ox-scroll--line-bottom">
      <div class="ox-inputwrap rx-buscador" style="margin-bottom:var(--ox-4)">
        <i data-icon="search"></i>
        <input class="ox-input" id="e-buscar" placeholder="Buscar…" spellcheck="false"
               value="${esc(busqueda)}">
      </div>
      ${lista.length === 0
      ? empty({
        icon: 'estudio',
        title: busqueda ? 'Nada coincide con esa búsqueda' : 'El catálogo está vacío',
        text: busqueda ? '' : 'Cargá los que pidas seguido y aparecerán acá arriba.',
      })
      : `<div class="ox-list">${lista.map((e) => `
          <div class="ox-listitem">
            <div class="ox-iconcell"><i data-icon="estudio"></i></div>
            <div class="ox-listitem__main">
              <div class="ox-listitem__title">${esc(e.nombre)}</div>
              <div class="ox-listitem__sub ox-truncate">${esc(e.aclaracion || '—')}</div>
            </div>
            <div class="ox-listitem__aside">
              ${e.usos > 0 ? `<span class="ox-chip ox-chip--mono" data-tip="Veces que lo pediste">${e.usos}</span>` : ''}
            </div>
            <div class="ox-rowactions">
              <button class="ox-iconbtn ox-iconbtn--sm" data-editar="${esc(e.id)}"
                      data-tip="Editar"><i data-icon="edit"></i></button>
              <button class="ox-iconbtn ox-iconbtn--sm" data-borrar="${esc(e.id)}"
                      data-tip="Eliminar"><i data-icon="trash"></i></button>
            </div>
          </div>`).join('')}</div>`}
    </div>`);

  const buscar = document.getElementById('e-buscar');
  let reloj = null;
  buscar.addEventListener('input', () => {
    clearTimeout(reloj);
    // Se espera a que deje de tipear: repintar por tecla hace parpadear la lista.
    reloj = setTimeout(() => vistaEstudios(buscar.value), 160);
  });
  Router.onLeave(() => clearTimeout(reloj));

  document.getElementById('e-nuevo').onclick = async () => {
    if (await editar({})) vistaEstudios(busqueda);
  };

  for (const b of document.querySelectorAll('[data-editar]')) {
    b.onclick = async () => {
      const e = lista.find((x) => x.id === b.dataset.editar);
      if (e && await editar(e)) vistaEstudios(busqueda);
    };
  }

  for (const b of document.querySelectorAll('[data-borrar]')) {
    b.onclick = async () => {
      const e = lista.find((x) => x.id === b.dataset.borrar);
      const ok = await Modal.confirm({
        title: 'Eliminar del catálogo',
        sub: `"${e.nombre}" se saca de la lista. Las órdenes ya emitidas no se tocan.`,
        confirmLabel: 'Eliminar',
        danger: true,
      });
      if (!ok) return;
      await attempt(() => rx.estudios.remove(e.id), { errorTitle: 'No se pudo eliminar' });
      Toast.show({ title: 'Eliminado', text: e.nombre, icon: 'trash' });
      vistaEstudios(busqueda);
    };
  }
}
