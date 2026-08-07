/* Tablero — lo primero que se ve al entrar. Tres cifras y las últimas recetas. */

import Router from '../router.js';
import { paint, head, esc, empty } from '../ui.js';
import { countTo } from '../motion.js';
import { S, refrescar, fecha } from '../tienda.js';

function cifra(valor, rotulo, id) {
  return `<div class="ox-card"><div class="ox-card__body">
    <div class="ox-stat">
      <div class="ox-stat__value ox-num" id="${id}">0</div>
      <div class="ox-stat__label">${esc(rotulo)}</div>
    </div>
  </div></div>`;
}

export async function vistaTablero() {
  const r = await refrescar();
  const medico = S.medico || {};
  const sinConfigurar = !medico.apellido_nombre;

  paint(head({
    title: 'Tablero',
    sub: sinConfigurar
      ? 'Antes de emitir la primera receta, cargá tus datos profesionales en Ajustes.'
      : medico.apellido_nombre + (medico.matricula ? ` · Mat. ${medico.matricula}` : ''),
    actions: `<button class="ox-btn ox-btn--primary ox-flashable" id="t-nueva">
                <i data-icon="plus"></i> Nueva receta</button>`,
  }) + `
    <div class="ox-scroll ox-grow ox-scroll--line-bottom">
      ${sinConfigurar ? `
        <div class="rx-aviso" style="margin-bottom:var(--ox-4)">
          <i data-icon="info"></i>
          <div><strong>Faltan tus datos.</strong> El pie de la receta sale de lo que cargues
          en Ajustes: apellido, matrícula y especialidad.
          <button class="ox-btn ox-btn--ghost ox-btn--sm" id="t-ajustes"
                  style="margin-left:var(--ox-2)">Ir a Ajustes</button></div>
        </div>` : ''}

      <div class="rx-fila" style="margin-bottom:var(--ox-5)">
        ${cifra(r.pacientes, 'Pacientes', 'c-pac')}
        ${cifra(r.recetas, 'Recetas emitidas', 'c-rec')}
        ${cifra(r.recetasHoy, 'Recetas hoy', 'c-hoy')}
        ${cifra(r.evoluciones, 'Evoluciones', 'c-evo')}
      </div>

      <div class="ox-section">
        <div class="ox-section__head">
          <div class="ox-section__title">Últimas recetas</div>
          <button class="ox-btn ox-btn--ghost ox-btn--sm" id="t-todas">Ver todas</button>
        </div>
        ${r.ultimasRecetas.length === 0
      ? empty({ icon: 'file', title: 'Todavía no emitiste ninguna receta', text: 'La primera sale del botón de arriba.' })
      : `<div class="ox-list">${r.ultimasRecetas.map((x) => `
            <div class="ox-listitem" data-receta="${esc(x.id)}" role="button" tabindex="0">
              <div class="ox-iconcell"><i data-icon="file"></i></div>
              <div class="ox-listitem__main">
                <div class="ox-listitem__title">${esc(x.paciente || '— paciente eliminado —')}</div>
                <div class="ox-listitem__sub ox-truncate">${esc(x.detalle || '')}</div>
              </div>
              <div class="ox-listitem__aside ox-num">${esc(fecha(x.fecha))}</div>
            </div>`).join('')}</div>`}
      </div>
    </div>`);

  /* Los contadores corren en vez de saltar. Es la diferencia entre una cifra
     que se lee y una que aparece ya puesta y nadie mira. */
  countTo(document.getElementById('c-pac'), r.pacientes);
  countTo(document.getElementById('c-rec'), r.recetas);
  countTo(document.getElementById('c-hoy'), r.recetasHoy);
  countTo(document.getElementById('c-evo'), r.evoluciones);

  /* Los listeners van sobre nodos que mueren con el próximo pintado, nunca
     delegados en #view: ese elemento sobrevive y los acumularía. */
  document.getElementById('t-nueva').onclick = () => Router.go('receta');
  document.getElementById('t-todas').onclick = () => Router.go('recetas');
  document.getElementById('t-ajustes')?.addEventListener('click', () => Router.go('ajustes'));

  for (const el of document.querySelectorAll('[data-receta]')) {
    const ir = () => Router.go('recetas', el.dataset.receta);
    el.addEventListener('click', ir);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ir(); }
    });
  }
}
