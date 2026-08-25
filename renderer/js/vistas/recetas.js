/* Recetas: emitir una nueva (con la hoja en vivo al lado) y el historial. */

import { Modal, Toast, Menu } from '../overlays.js';
import { Icons } from '../icons.js';
import Router from '../router.js';
import { paint, head, esc, empty, attempt } from '../ui.js';
import { exit, bindSwitcher } from '../motion.js';
import { campoFecha, cablearFechas } from '../campo-fecha.js';
import { S, fecha, hoyISO, edad } from '../tienda.js';
import { plural } from '../format.js';
import { hoja } from '../hoja.js';

const rx = window.rx;

/* ══ Nueva receta ════════════════════════════════════════════════════════════ */

function itemVacio() {
  return { nombre: '', marca: '', dosis: '', envases: 1, diagnostico: '', indicaciones: '', desde: null };
}

function filaItem(it, i) {
  return `<div class="rx-item" data-item="${i}">
    <div class="rx-item__campos">
      <input class="ox-input" data-campo="nombre" data-i="${i}" spellcheck="false"
             placeholder="Medicamento y presentación" value="${esc(it.nombre)}">
      <div class="rx-item__grid">
        <input class="ox-input" data-campo="marca" data-i="${i}" spellcheck="false"
               placeholder="Marca sugerida" value="${esc(it.marca)}">
        <input class="ox-input" data-campo="dosis" data-i="${i}" spellcheck="false"
               placeholder="Dosis" value="${esc(it.dosis)}">
        <input class="ox-input" data-campo="diagnostico" data-i="${i}" spellcheck="false"
               placeholder="Diagnóstico" value="${esc(it.diagnostico)}">
      </div>
      <!-- Indicaciones va sola y a lo ancho: es la línea más larga de una
           receta ("1 comprimido por la mañana, con el desayuno") y metida en
           una columna de la grilla se lee cortada justo cuando importa. -->
      <input class="ox-input" data-campo="indicaciones" data-i="${i}" spellcheck="false"
             placeholder="Indicaciones" value="${esc(it.indicaciones)}">
    </div>
    <div class="rx-item__acciones">
      <div class="ox-field" style="width:78px">
        <label class="ox-field__label">Envases</label>
        <input class="ox-input ox-input--mono" data-campo="envases" data-i="${i}"
               type="number" min="1" value="${esc(it.envases)}">
      </div>
      <button class="ox-iconbtn ox-iconbtn--sm" data-catalogo="${i}"
              data-tip="Cargar del catálogo"><i data-icon="pill"></i></button>
      <button class="ox-iconbtn ox-iconbtn--sm" data-quitar="${i}"
              data-tip="Quitar"><i data-icon="trash"></i></button>
    </div>
  </div>`;
}

export async function vistaReceta(pacienteId = null) {
  const [pacientes, catalogo] = await Promise.all([
    rx.pacientes.list(), rx.medicamentos.list(),
  ]);

  const E = {
    paciente: null,
    fecha: hoyISO(),
    plantilla: S.ajustes?.plantillaPorDefecto === 'rpe' ? 'rpe' : 'clasica',
    numero: '',
    items: [itemVacio()],
  };
  if (pacienteId) E.paciente = await rx.pacientes.get(pacienteId);

  paint(head({
    title: 'Nueva receta',
    sub: 'La hoja de la derecha es exactamente lo que va a salir impreso',
    crumbs: [{ label: 'Recetas', view: 'recetas' }],
    actions: `<button class="ox-btn ox-btn--primary ox-flashable" id="r-emitir">
                <i data-icon="check"></i> Emitir</button>`,
  }) + `
    <div class="rx-receta">
      <div class="ox-scroll rx-receta__form ox-scroll--line-bottom">

        <div class="ox-field">
          <label class="ox-field__label">Paciente</label>
          <button class="ox-select" id="r-paciente" type="button">
            <span id="r-paciente-txt">${E.paciente
      ? esc(E.paciente.apellido_nombre) : 'Elegir paciente…'}</span>
            <i data-icon="chevronDown"></i>
          </button>
          <span class="ox-field__hint" id="r-paciente-hint"></span>
        </div>

        <div id="r-alergias"></div>

        <div class="rx-fila">
          ${campoFecha({ id: 'r-fecha', label: 'Fecha', valor: E.fecha })}
          <div class="ox-field">
            <label class="ox-field__label">Plantilla</label>
            <div class="ox-segmented" id="r-plantilla">
              <button class="ox-segmented__opt${E.plantilla === 'clasica' ? ' is-active' : ''}"
                      data-value="clasica">Clásica</button>
              <button class="ox-segmented__opt${E.plantilla === 'rpe' ? ' is-active' : ''}"
                      data-value="rpe">RPE</button>
            </div>
          </div>
          <div class="ox-field" id="r-numero-campo" ${E.plantilla === 'rpe' ? '' : 'hidden'}>
            <label class="ox-field__label" for="r-numero">Nº de receta</label>
            <input class="ox-input ox-input--mono" id="r-numero" spellcheck="false" value="">
          </div>
        </div>

        <div class="ox-section">
          <div class="ox-section__head">
            <div class="ox-section__title">Medicamentos</div>
            <button class="ox-btn ox-btn--secondary ox-btn--sm ox-flashable" id="r-agregar">
              <i data-icon="plus"></i> Agregar</button>
          </div>
          <div class="ox-col" id="r-items" style="gap:var(--ox-3)"></div>
        </div>
      </div>

      <div class="rx-receta__previa">
        <div class="rx-previa ox-grow">
          <div class="rx-previa__head">
            <i data-icon="printer"></i> Vista previa
            <span class="ox-spacer"></span>
            <span class="ox-meta">original + duplicado</span>
          </div>
          <div class="rx-previa__scroll" id="r-previa"></div>
        </div>
      </div>
    </div>`);

  const elItems = document.getElementById('r-items');
  const elPrevia = document.getElementById('r-previa');
  const elAlergias = document.getElementById('r-alergias');
  const elHint = document.getElementById('r-paciente-hint');

  /* ── Pintar ─────────────────────────────────────────────────────────────── */

  function datosHoja() {
    return {
      paciente: E.paciente,
      medico: S.medico,
      items: E.items.filter((i) => i.nombre.trim()),
      fecha: E.fecha,
      plantilla: E.plantilla,
      numero: E.numero,
    };
  }

  function pintarPrevia() {
    const d = datosHoja();
    elPrevia.innerHTML =
      `<div class="rx-previa__papel">${hoja(d, { duplicado: false })}</div>` +
      `<div class="rx-previa__papel">${hoja(d, { duplicado: true })}</div>`;
  }

  function pintarAlergias() {
    const a = E.paciente?.alergias;
    if (!a) { elAlergias.innerHTML = ''; return; }
    /* Antes de recetar, esto tiene que estar a la vista. Es el único lugar de
       la app donde el rojo no significa "falló algo". */
    elAlergias.innerHTML = `<div class="rx-alergias">
      <i data-icon="cruz"></i>
      <div><div class="rx-alergias__rotulo">Alergias</div>
      <div>${esc(a)}</div></div></div>`;
    /* `paint()` monta los íconos una sola vez, al pintar la vista. Todo lo que
       se inyecte después tiene que montar los suyos o queda un hueco. */
    Icons.mount(elAlergias);
  }

  function pintarItems() {
    elItems.innerHTML = E.items.map(filaItem).join('');
    Icons.mount(elItems);
    cablearItems();
    pintarPrevia();
  }

  /* ── Cableado ───────────────────────────────────────────────────────────── */

  function cablearItems() {
    for (const inp of elItems.querySelectorAll('[data-campo]')) {
      inp.addEventListener('input', () => {
        const i = Number(inp.dataset.i);
        const campo = inp.dataset.campo;
        E.items[i][campo] = campo === 'envases'
          ? Math.max(1, Number(inp.value) || 1)
          : inp.value;
        pintarPrevia();
      });
    }

    for (const b of elItems.querySelectorAll('[data-quitar]')) {
      b.onclick = () => {
        const i = Number(b.dataset.quitar);
        if (E.items.length === 1) {
          E.items = [itemVacio()];
          pintarItems();
          return;
        }
        /* Sale animado y recién después se repinta: si se quitara del array y
           se repintara de una, la fila desaparecería de golpe. */
        exit(b.closest('.rx-item'), {
          onDone: () => { E.items.splice(i, 1); pintarItems(); },
        });
      };
    }

    for (const b of elItems.querySelectorAll('[data-catalogo]')) {
      b.onclick = (ev) => {
        if (catalogo.length === 0) {
          Toast.show({ title: 'El catálogo está vacío', text: 'Cargalo desde Medicamentos.', icon: 'pill' });
          return;
        }
        const i = Number(b.dataset.catalogo);
        Menu.show(ev.currentTarget, catalogo.slice(0, 40).map((m) => ({
          label: m.nombre,
          icon: 'pill',
          onSelect: () => {
            E.items[i] = {
              nombre: m.nombre, marca: m.marca, dosis: m.dosis,
              envases: m.envases || 1, diagnostico: m.diagnostico,
              indicaciones: m.indicaciones, desde: m.id,
            };
            pintarItems();
          },
        })), { align: 'end' });
      };
    }
  }

  document.getElementById('r-paciente').onclick = (ev) => {
    if (pacientes.length === 0) {
      Toast.show({ title: 'No hay pacientes', text: 'Cargá uno desde Pacientes.', icon: 'users' });
      return;
    }
    Menu.show(ev.currentTarget, pacientes.slice(0, 60).map((p) => ({
      label: p.apellido_nombre,
      icon: 'user',
      selected: E.paciente?.id === p.id,
      onSelect: async () => {
        E.paciente = await rx.pacientes.get(p.id);
        document.getElementById('r-paciente-txt').textContent = E.paciente.apellido_nombre;
        const a = edad(E.paciente.nacimiento);
        elHint.textContent = [
          E.paciente.dni && `DNI ${E.paciente.dni}`,
          a != null && `${a} años`,
          E.paciente.cobertura,
        ].filter(Boolean).join(' · ');
        pintarAlergias();
        pintarPrevia();
      },
    })), { align: 'start' });
  };

  cablearFechas(document.getElementById('view'), (iso) => {
    // Vacía o a medio escribir se conserva la última válida: la hoja no puede
    // quedar sin fecha mientras se corrige un dígito.
    if (iso) { E.fecha = iso; pintarPrevia(); }
  });

  const campoNumero = document.getElementById('r-numero-campo');
  bindSwitcher(document.getElementById('r-plantilla'), (valor) => {
    E.plantilla = valor;
    campoNumero.hidden = valor !== 'rpe';
    pintarPrevia();
  });
  document.getElementById('r-numero').addEventListener('input', (e) => {
    E.numero = e.target.value;
  });

  document.getElementById('r-agregar').onclick = () => {
    E.items.push(itemVacio());
    pintarItems();
    elItems.lastElementChild?.querySelector('input')?.focus();
  };

  document.getElementById('r-emitir').onclick = async () => {
    if (!E.paciente) return Toast.error('Falta el paciente', 'Elegí a quién va dirigida la receta.');
    const items = E.items.filter((i) => i.nombre.trim());
    if (items.length === 0) return Toast.error('Falta el medicamento', 'La receta necesita al menos uno.');

    const receta = await attempt(() => rx.recetas.emitir({
      paciente_id: E.paciente.id,
      fecha: E.fecha,
      plantilla: E.plantilla,
      numero: E.numero,
      items,
      desdeCatalogo: items.map((i) => i.desde).filter(Boolean),
    }), { errorTitle: 'No se pudo emitir la receta' });
    if (!receta) return;

    await ofrecerSalida(receta.id, 'Receta emitida');
    Router.go('recetas');
  };

  pintarItems();
  pintarAlergias();
  if (E.paciente) {
    const a = edad(E.paciente.nacimiento);
    elHint.textContent = [
      E.paciente.dni && `DNI ${E.paciente.dni}`,
      a != null && `${a} años`,
      E.paciente.cobertura,
    ].filter(Boolean).join(' · ');
  }
}

/* ══ Imprimir / PDF ══════════════════════════════════════════════════════════ */

async function ofrecerSalida(recetaId, titulo) {
  const val = await Modal.show({
    title: titulo,
    sub: 'Se imprimen dos hojas: el original y el duplicado. El espacio de la firma queda en blanco para firmar a mano.',
    width: 460,
    actions: [
      { label: 'Después', value: null },
      { label: 'Guardar PDF', value: 'pdf' },
      { label: 'Imprimir', value: 'imprimir', variant: 'primary', autofocus: true },
    ],
  });
  if (val === 'pdf') {
    await attempt(async () => {
      const r = await rx.recetas.pdf(recetaId);
      if (!r.cancelado) Toast.show({ title: 'PDF guardado', text: r.ruta, icon: 'save' });
    }, { errorTitle: 'No se pudo generar el PDF' });
  } else if (val === 'imprimir') {
    await attempt(async () => {
      const r = await rx.recetas.imprimir(recetaId);
      if (!r.cancelado && !r.ok) throw new Error(r.motivo || 'La impresora rechazó el trabajo.');
    }, { errorTitle: 'No se pudo imprimir' });
  }
}

/* ══ Historial ═══════════════════════════════════════════════════════════════ */

export async function vistaRecetas(recetaId = null) {
  const lista = await rx.recetas.list({ limite: 300 });

  paint(head({
    title: 'Recetas',
    /* `plural()` ya trae el número adelante, así que no se le antepone otro —
       y "emitida" concuerda a mano en vez de pasar por un segundo `plural()`,
       que metería el número una tercera vez. */
    sub: lista.length
      ? `${plural(lista.length, 'receta')} ${lista.length === 1 ? 'emitida' : 'emitidas'}`
      : 'Todavía no emitiste ninguna',
    actions: `<button class="ox-btn ox-btn--primary ox-flashable" id="h-nueva">
                <i data-icon="plus"></i> Nueva receta</button>`,
  }) + `
    <div class="ox-scroll ox-grow ox-scroll--line-bottom">
      ${lista.length === 0
      ? empty({ icon: 'file', title: 'Sin recetas', text: 'La primera sale del botón de arriba.' })
      : `<div class="ox-list">${lista.map((r) => `
        <div class="ox-listitem" data-abrir="${esc(r.id)}" role="button" tabindex="0">
          <div class="ox-iconcell"><i data-icon="file"></i></div>
          <div class="ox-listitem__main">
            <div class="ox-listitem__title">${esc(r.paciente || '— paciente eliminado —')}</div>
            <div class="ox-listitem__sub ox-truncate">${esc(r.detalle || '')}</div>
          </div>
          <div class="ox-listitem__aside ox-num">${esc(fecha(r.fecha))}</div>
          <div class="ox-rowactions">
            <button class="ox-iconbtn ox-iconbtn--sm" data-imprimir="${esc(r.id)}"
                    data-tip="Imprimir"><i data-icon="printer"></i></button>
            <button class="ox-iconbtn ox-iconbtn--sm" data-pdf="${esc(r.id)}"
                    data-tip="Guardar PDF"><i data-icon="download"></i></button>
          </div>
        </div>`).join('')}</div>`}
    </div>`);

  document.getElementById('h-nueva').onclick = () => Router.go('receta');

  for (const el of document.querySelectorAll('[data-abrir]')) {
    const ver = () => verReceta(el.dataset.abrir);
    el.addEventListener('click', (e) => {
      if (e.target.closest('.ox-rowactions')) return;   // los botones tienen lo suyo
      ver();
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ver(); }
    });
  }

  for (const b of document.querySelectorAll('[data-imprimir]')) {
    b.onclick = () => attempt(async () => {
      const r = await rx.recetas.imprimir(b.dataset.imprimir);
      if (!r.cancelado && !r.ok) throw new Error(r.motivo || 'La impresora rechazó el trabajo.');
    }, { errorTitle: 'No se pudo imprimir' });
  }

  for (const b of document.querySelectorAll('[data-pdf]')) {
    b.onclick = () => attempt(async () => {
      const r = await rx.recetas.pdf(b.dataset.pdf);
      if (!r.cancelado) Toast.show({ title: 'PDF guardado', text: r.ruta, icon: 'save' });
    }, { errorTitle: 'No se pudo generar el PDF' });
  }

  if (recetaId) verReceta(recetaId);
}

/** Muestra la hoja tal como se emitió, desde la instantánea. */
async function verReceta(id) {
  const r = await rx.recetas.get(id);
  if (!r) return Toast.error('No está', 'Esa receta ya no existe.');

  const datos = {
    paciente: r.snapshot?.paciente || null,
    medico: r.snapshot?.medico || null,
    items: r.items,
    fecha: r.fecha,
    plantilla: r.plantilla,
    numero: r.numero,
  };

  const caja = document.createElement('div');
  caja.innerHTML = `<div class="rx-previa__papel" style="--rx-zoom:.62;margin:0 auto">
    ${hoja(datos, { duplicado: false })}</div>`;

  const val = await Modal.show({
    title: `Receta del ${fecha(r.fecha)}`,
    sub: 'Tal como se emitió. Los datos son los de ese día, no los actuales.',
    body: caja,
    width: 520,
    actions: [
      { label: 'Cerrar', value: null },
      { label: 'Eliminar', value: 'borrar', variant: 'danger' },
      { label: 'Guardar PDF', value: 'pdf' },
      { label: 'Imprimir', value: 'imprimir', variant: 'primary' },
    ],
  });

  if (val === 'borrar') {
    const ok = await Modal.confirm({
      title: 'Eliminar la receta',
      sub: 'Se borra del historial. Si ya salió impresa, el papel sigue existiendo. No hay vuelta atrás.',
      confirmLabel: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    await attempt(() => rx.recetas.remove(id));
    Toast.show({ title: 'Receta eliminada', icon: 'trash' });
    Router.refresh();
  } else if (val === 'pdf') {
    await attempt(async () => {
      const res = await rx.recetas.pdf(id);
      if (!res.cancelado) Toast.show({ title: 'PDF guardado', text: res.ruta, icon: 'save' });
    }, { errorTitle: 'No se pudo generar el PDF' });
  } else if (val === 'imprimir') {
    await attempt(async () => {
      const res = await rx.recetas.imprimir(id);
      if (!res.cancelado && !res.ok) throw new Error(res.motivo || 'La impresora rechazó el trabajo.');
    }, { errorTitle: 'No se pudo imprimir' });
  }
}
