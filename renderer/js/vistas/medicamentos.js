/* Catálogo de medicamentos frecuentes. No es un vademécum: es la lista corta
   de lo que esta doctora receta seguido, para no tipearlo cada vez. Se ordena
   por uso, así los de todos los días flotan arriba solos. */

import { Modal, Toast } from '../overlays.js';
import Router from '../router.js';
import { paint, head, esc, empty, attempt } from '../ui.js';
import { plural } from '../format.js';

const rx = window.rx;

function formulario(m = {}) {
  const caja = document.createElement('div');
  caja.className = 'ox-col';
  caja.style.gap = 'var(--ox-3)';
  caja.innerHTML = `
    <div class="ox-field">
      <label class="ox-field__label" for="m-nombre">Nombre y presentación</label>
      <input class="ox-input" id="m-nombre" spellcheck="false"
             placeholder="Sertralina 50 mg" value="${esc(m.nombre || '')}">
    </div>
    <div class="rx-fila--dos" style="display:grid;gap:var(--ox-3)">
      <div class="ox-field">
        <label class="ox-field__label" for="m-marca">Marca sugerida</label>
        <input class="ox-input" id="m-marca" spellcheck="false" value="${esc(m.marca || '')}">
      </div>
      <div class="ox-field">
        <label class="ox-field__label" for="m-dosis">Dosis</label>
        <input class="ox-input" id="m-dosis" spellcheck="false"
               placeholder="1 comp. cada 12 h" value="${esc(m.dosis || '')}">
      </div>
    </div>
    <div class="ox-field">
      <label class="ox-field__label" for="m-diag">Diagnóstico habitual</label>
      <input class="ox-input" id="m-diag" spellcheck="false"
             placeholder="F31 — Trastorno bipolar" value="${esc(m.diagnostico || '')}">
    </div>
    <div class="ox-field">
      <label class="ox-field__label" for="m-ind">Indicaciones</label>
      <input class="ox-input" id="m-ind" spellcheck="false"
             placeholder="2 comprimidos por día" value="${esc(m.indicaciones || '')}">
    </div>
    <div class="ox-field">
      <label class="ox-field__label" for="m-env">Envases por defecto</label>
      <input class="ox-input ox-input--mono" id="m-env" type="number" min="1"
             style="max-width:110px" value="${esc(m.envases ?? 1)}">
    </div>`;
  return caja;
}

async function editar(m) {
  const cuerpo = formulario(m);
  const val = await Modal.show({
    title: m?.id ? 'Editar medicamento' : 'Nuevo medicamento',
    body: cuerpo,
    width: 520,
    actions: [
      { label: 'Cancelar', value: null },
      { label: 'Guardar', value: 'ok', variant: 'primary' },
    ],
  });
  if (val !== 'ok') return false;

  const datos = {
    id: m?.id,
    nombre: cuerpo.querySelector('#m-nombre').value,
    marca: cuerpo.querySelector('#m-marca').value,
    dosis: cuerpo.querySelector('#m-dosis').value,
    diagnostico: cuerpo.querySelector('#m-diag').value,
    indicaciones: cuerpo.querySelector('#m-ind').value,
    envases: cuerpo.querySelector('#m-env').value,
  };
  const ok = await attempt(() => rx.medicamentos.save(datos), { errorTitle: 'No se pudo guardar' });
  return ok !== undefined;
}

export async function vistaMedicamentos(busqueda = '') {
  const lista = await rx.medicamentos.list({ busqueda });

  paint(head({
    title: 'Medicamentos',
    /* `plural()` ya trae el número adelante: no se le antepone otro. */
    sub: lista.length
      ? `${plural(lista.length, 'medicamento')} en el catálogo`
      : 'Los que uses seguido, para no volver a tipearlos',
    actions: `<button class="ox-btn ox-btn--primary ox-flashable" id="m-nuevo">
                <i data-icon="plus"></i> Nuevo</button>`,
  }) + `
    <div class="ox-scroll ox-grow ox-scroll--line-bottom">
      <div class="ox-inputwrap rx-buscador" style="margin-bottom:var(--ox-4)">
        <i data-icon="search"></i>
        <input class="ox-input" id="m-buscar" placeholder="Buscar…" spellcheck="false"
               value="${esc(busqueda)}">
      </div>
      ${lista.length === 0
      ? empty({
        icon: 'pill',
        title: busqueda ? 'Nada coincide con esa búsqueda' : 'El catálogo está vacío',
        text: busqueda ? '' : 'Cargá los que recetes seguido y aparecerán acá arriba.',
      })
      : `<div class="ox-list">${lista.map((m) => `
          <div class="ox-listitem">
            <div class="ox-iconcell"><i data-icon="pill"></i></div>
            <div class="ox-listitem__main">
              <div class="ox-listitem__title">${esc(m.nombre)}</div>
              <div class="ox-listitem__sub ox-truncate">${[
        m.marca && `Marca: ${m.marca}`,
        m.dosis,
        m.indicaciones,
      ].filter(Boolean).map(esc).join(' · ') || '—'}</div>
            </div>
            <div class="ox-listitem__aside">
              ${m.usos > 0 ? `<span class="ox-chip ox-chip--mono" data-tip="Veces que lo recetaste">${m.usos}</span>` : ''}
            </div>
            <div class="ox-rowactions">
              <button class="ox-iconbtn ox-iconbtn--sm" data-editar="${esc(m.id)}"
                      data-tip="Editar"><i data-icon="edit"></i></button>
              <button class="ox-iconbtn ox-iconbtn--sm" data-borrar="${esc(m.id)}"
                      data-tip="Eliminar"><i data-icon="trash"></i></button>
            </div>
          </div>`).join('')}</div>`}
    </div>`);

  const buscar = document.getElementById('m-buscar');
  let reloj = null;
  buscar.addEventListener('input', () => {
    clearTimeout(reloj);
    // Se espera a que deje de tipear: repintar por tecla hace parpadear la lista.
    reloj = setTimeout(() => vistaMedicamentos(buscar.value), 160);
  });
  Router.onLeave(() => clearTimeout(reloj));

  document.getElementById('m-nuevo').onclick = async () => {
    if (await editar({})) vistaMedicamentos(busqueda);
  };

  for (const b of document.querySelectorAll('[data-editar]')) {
    b.onclick = async () => {
      const m = lista.find((x) => x.id === b.dataset.editar);
      if (m && await editar(m)) vistaMedicamentos(busqueda);
    };
  }

  for (const b of document.querySelectorAll('[data-borrar]')) {
    b.onclick = async () => {
      const m = lista.find((x) => x.id === b.dataset.borrar);
      const ok = await Modal.confirm({
        title: 'Eliminar del catálogo',
        sub: `"${m.nombre}" se saca de la lista. Las recetas ya emitidas no se tocan.`,
        confirmLabel: 'Eliminar',
        danger: true,
      });
      if (!ok) return;
      await attempt(() => rx.medicamentos.remove(m.id), { errorTitle: 'No se pudo eliminar' });
      Toast.show({ title: 'Eliminado', text: m.nombre, icon: 'trash' });
      vistaMedicamentos(busqueda);
    };
  }
}
