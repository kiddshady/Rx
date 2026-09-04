/* Órdenes de estudios: emitir una nueva (con la hoja en vivo al lado) y el
   historial. Es la vista de recetas con otro cuerpo — mismo circuito, mismo
   congelado por instantánea, misma salida a papel o PDF. Lo único distinto es
   qué se pide y que sale en UNA hoja: la orden se la queda el laboratorio. */

import { Modal, Toast, Menu } from '../overlays.js';
import { Icons } from '../icons.js';
import Router from '../router.js';
import { paint, head, esc, empty, attempt } from '../ui.js';
import { exit } from '../motion.js';
import { campoFecha, cablearFechas } from '../campo-fecha.js';
import { S, fecha, hoyISO, edad } from '../tienda.js';
import { plural } from '../format.js';
import { hoja } from '../hoja.js';

const rx = window.rx;

/* ══ Nueva orden ═════════════════════════════════════════════════════════════ */

function itemVacio() {
  return { nombre: '', aclaracion: '', desde: null };
}

function filaItem(it, i) {
  return `<div class="rx-item rx-item--fila" data-item="${i}">
    <div class="rx-item__campos">
      <div class="rx-item__grid">
        <input class="ox-input" data-campo="nombre" data-i="${i}" spellcheck="false"
               placeholder="Estudio o práctica" value="${esc(it.nombre)}">
        <input class="ox-input" data-campo="aclaracion" data-i="${i}" spellcheck="false"
               placeholder="Aclaración (lado, región, ayuno…)" value="${esc(it.aclaracion)}">
      </div>
    </div>
    <div class="rx-item__acciones">
      <button class="ox-iconbtn ox-iconbtn--sm" data-catalogo="${i}"
              data-tip="Cargar del catálogo"><i data-icon="estudio"></i></button>
      <button class="ox-iconbtn ox-iconbtn--sm" data-quitar="${i}"
              data-tip="Quitar"><i data-icon="trash"></i></button>
    </div>
  </div>`;
}

export async function vistaOrden(pacienteId = null) {
  const [pacientes, catalogo] = await Promise.all([
    rx.pacientes.list(), rx.estudios.list(),
  ]);

  const E = {
    paciente: null,
    fecha: hoyISO(),
    diagnostico: '',
    observaciones: '',
    items: [itemVacio()],
  };
  if (pacienteId) E.paciente = await rx.pacientes.get(pacienteId);

  paint(head({
    title: 'Nueva orden',
    sub: 'La hoja de la derecha es exactamente lo que va a salir impreso',
    crumbs: [{ label: 'Órdenes', view: 'ordenes' }],
    actions: `<button class="ox-btn ox-btn--primary ox-flashable" id="o-emitir">
                <i data-icon="check"></i> Emitir</button>`,
  }) + `
    <div class="rx-receta">
      <div class="ox-scroll rx-receta__form ox-scroll--line-bottom">

        <div class="ox-field">
          <label class="ox-field__label">Paciente</label>
          <button class="ox-select" id="o-paciente" type="button">
            <span id="o-paciente-txt">${E.paciente
      ? esc(E.paciente.apellido_nombre) : 'Elegir paciente…'}</span>
            <i data-icon="chevronDown"></i>
          </button>
          <span class="ox-field__hint" id="o-paciente-hint"></span>
        </div>

        <div id="o-alergias"></div>

        <div class="rx-fila">
          ${campoFecha({ id: 'o-fecha', label: 'Fecha', valor: E.fecha })}
          <div class="ox-field">
            <label class="ox-field__label" for="o-diagnostico">Diagnóstico o indicación</label>
            <input class="ox-input" id="o-diagnostico" spellcheck="false"
                   placeholder="Lo que motiva el pedido">
          </div>
        </div>

        <div class="ox-section">
          <div class="ox-section__head">
            <div class="ox-section__title">Estudios</div>
            <button class="ox-btn ox-btn--secondary ox-btn--sm ox-flashable" id="o-agregar">
              <i data-icon="plus"></i> Agregar</button>
          </div>
          <div class="ox-col" id="o-items" style="gap:var(--ox-3)"></div>
        </div>

        <div class="ox-field">
          <label class="ox-field__label" for="o-observaciones">Observaciones</label>
          <input class="ox-input" id="o-observaciones" spellcheck="false"
                 placeholder="Lo que el laboratorio o el centro tenga que saber">
        </div>
      </div>

      <div class="rx-receta__previa">
        <div class="rx-previa ox-grow">
          <div class="rx-previa__head">
            <i data-icon="printer"></i> Vista previa
            <span class="ox-spacer"></span>
            <span class="ox-meta" id="o-hojas">una hoja</span>
          </div>
          <div class="rx-previa__scroll" id="o-previa"></div>
        </div>
      </div>
    </div>`);

  const elItems = document.getElementById('o-items');
  const elPrevia = document.getElementById('o-previa');
  const elAlergias = document.getElementById('o-alergias');
  const elHint = document.getElementById('o-paciente-hint');
  const elHojas = document.getElementById('o-hojas');

  /* ── Pintar ─────────────────────────────────────────────────────────────── */

  function datosHoja() {
    return {
      tipo: 'orden',
      paciente: E.paciente,
      medico: S.medico,
      items: E.items.filter((i) => i.nombre.trim()),
      fecha: E.fecha,
      diagnostico: E.diagnostico,
      observaciones: E.observaciones,
    };
  }

  /* Un pedido largo no entra en la A5 y sigue en una segunda página. Eso no se
     nota mirando la previa —el papel simplemente se dibuja más alto— y sí se
     nota cuando ya salió por la impresora, que es tarde. Se mide y se avisa.

     El alto de una A5 se deduce del ancho del MISMO elemento (132 × 194 mm):
     así el zoom de la previa se cancela solo y no hay que compensarlo a mano,
     que es de donde salen los avisos que mienten en una ventana chica. */
  function medirHoja() {
    const papel = elPrevia.querySelector('.rx-hoja');
    if (!papel) return;
    const caja = papel.getBoundingClientRect();
    const sePasa = caja.height > caja.width * (194 / 132) + 1;
    elHojas.textContent = sePasa ? 'no entra: sigue en una segunda hoja' : 'una hoja';
    elHojas.classList.toggle('rx-previa__alerta', sePasa);
  }

  function pintarPrevia() {
    elPrevia.innerHTML = `<div class="rx-previa__papel">${hoja(datosHoja())}</div>`;
    medirHoja();
  }

  function pintarAlergias() {
    const a = E.paciente?.alergias;
    if (!a) { elAlergias.innerHTML = ''; return; }
    /* También acá: un contraste yodado o el látex se piden en una orden igual
       que un fármaco en una receta. Es el otro rojo de la app que no significa
       que algo falló. */
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

  function pintarFiliacion() {
    const a = edad(E.paciente.nacimiento);
    elHint.textContent = [
      E.paciente.dni && `DNI ${E.paciente.dni}`,
      a != null && `${a} años`,
      E.paciente.cobertura,
    ].filter(Boolean).join(' · ');
  }

  /* ── Cableado ───────────────────────────────────────────────────────────── */

  function cablearItems() {
    for (const inp of elItems.querySelectorAll('[data-campo]')) {
      inp.addEventListener('input', () => {
        E.items[Number(inp.dataset.i)][inp.dataset.campo] = inp.value;
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
          Toast.show({ title: 'El catálogo está vacío', text: 'Cargalo desde Estudios.', icon: 'estudio' });
          return;
        }
        const i = Number(b.dataset.catalogo);
        Menu.show(ev.currentTarget, catalogo.slice(0, 40).map((e) => ({
          label: e.nombre,
          icon: 'estudio',
          onSelect: () => {
            E.items[i] = { nombre: e.nombre, aclaracion: e.aclaracion, desde: e.id };
            pintarItems();
          },
        })), { align: 'end' });
      };
    }
  }

  document.getElementById('o-paciente').onclick = (ev) => {
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
        document.getElementById('o-paciente-txt').textContent = E.paciente.apellido_nombre;
        pintarFiliacion();
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

  document.getElementById('o-diagnostico').addEventListener('input', (e) => {
    E.diagnostico = e.target.value;
    pintarPrevia();
  });
  document.getElementById('o-observaciones').addEventListener('input', (e) => {
    E.observaciones = e.target.value;
    pintarPrevia();
  });

  document.getElementById('o-agregar').onclick = () => {
    E.items.push(itemVacio());
    pintarItems();
    elItems.lastElementChild?.querySelector('input')?.focus();
  };

  document.getElementById('o-emitir').onclick = async () => {
    if (!E.paciente) return Toast.error('Falta el paciente', 'Elegí a quién va dirigida la orden.');
    const items = E.items.filter((i) => i.nombre.trim());
    if (items.length === 0) return Toast.error('Falta el estudio', 'La orden necesita al menos uno.');

    const orden = await attempt(() => rx.ordenes.emitir({
      paciente_id: E.paciente.id,
      fecha: E.fecha,
      diagnostico: E.diagnostico,
      observaciones: E.observaciones,
      items,
      desdeCatalogo: items.map((i) => i.desde).filter(Boolean),
    }), { errorTitle: 'No se pudo emitir la orden' });
    if (!orden) return;

    await ofrecerSalida(orden.id, 'Orden emitida');
    Router.go('ordenes');
  };

  pintarItems();
  pintarAlergias();
  if (E.paciente) pintarFiliacion();

  /* Las métricas de la Source Sans cambian el alto de la hoja, así que la
     primera medición se repite cuando la tipografía terminó de cargar. Sin
     esto, abrir la vista en frío puede avisar de una segunda hoja que no
     existe — o callarse una que sí. */
  document.fonts.ready.then(medirHoja);
}

/* ══ Imprimir / PDF ══════════════════════════════════════════════════════════ */

async function ofrecerSalida(ordenId, titulo) {
  const val = await Modal.show({
    title: titulo,
    sub: 'Se imprime una sola hoja. El espacio de la firma queda en blanco para firmar a mano.',
    width: 460,
    actions: [
      { label: 'Después', value: null },
      { label: 'Guardar PDF', value: 'pdf' },
      { label: 'Imprimir', value: 'imprimir', variant: 'primary', autofocus: true },
    ],
  });
  if (val === 'pdf') {
    await attempt(async () => {
      const r = await rx.ordenes.pdf(ordenId);
      if (!r.cancelado) Toast.show({ title: 'PDF guardado', text: r.ruta, icon: 'save' });
    }, { errorTitle: 'No se pudo generar el PDF' });
  } else if (val === 'imprimir') {
    await attempt(async () => {
      const r = await rx.ordenes.imprimir(ordenId);
      if (!r.cancelado && !r.ok) throw new Error(r.motivo || 'La impresora rechazó el trabajo.');
    }, { errorTitle: 'No se pudo imprimir' });
  }
}

/* ══ Historial ═══════════════════════════════════════════════════════════════ */

export async function vistaOrdenes(ordenId = null) {
  const lista = await rx.ordenes.list({ limite: 300 });

  paint(head({
    title: 'Órdenes',
    /* `plural()` ya trae el número adelante, así que no se le antepone otro.
       Y el plural va explícito: "orden" se acentúa al pluralizar y la regla de
       agregarle una "s" da "ordens". */
    sub: lista.length
      ? `${plural(lista.length, 'orden', 'órdenes')} ${lista.length === 1 ? 'emitida' : 'emitidas'}`
      : 'Todavía no emitiste ninguna',
    /* Igual que en recetas: el de borrar todo solo existe cuando hay algo que
       borrar, y va en fantasma. El rojo aparece recién en la confirmación. */
    actions: `${lista.length ? `
              <button class="ox-btn ox-btn--ghost ox-flashable" id="ho-vaciar">
                <i data-icon="trash"></i> Borrar historial</button>` : ''}
              <button class="ox-btn ox-btn--primary ox-flashable" id="ho-nueva">
                <i data-icon="plus"></i> Nueva orden</button>`,
  }) + `
    <div class="ox-scroll ox-grow ox-scroll--line-bottom">
      ${lista.length === 0
      ? empty({ icon: 'orden', title: 'Sin órdenes', text: 'La primera sale del botón de arriba.' })
      : `<div class="ox-list">${lista.map((o) => `
        <div class="ox-listitem" data-abrir="${esc(o.id)}" role="button" tabindex="0">
          <div class="ox-iconcell"><i data-icon="orden"></i></div>
          <div class="ox-listitem__main">
            <div class="ox-listitem__title">${esc(o.paciente || '— paciente eliminado —')}</div>
            <div class="ox-listitem__sub ox-truncate">${esc(o.detalle || '')}</div>
          </div>
          <div class="ox-listitem__aside ox-num">${esc(fecha(o.fecha))}</div>
          <div class="ox-rowactions">
            <button class="ox-iconbtn ox-iconbtn--sm" data-imprimir="${esc(o.id)}"
                    data-tip="Imprimir"><i data-icon="printer"></i></button>
            <button class="ox-iconbtn ox-iconbtn--sm" data-pdf="${esc(o.id)}"
                    data-tip="Guardar PDF"><i data-icon="download"></i></button>
            <button class="ox-iconbtn ox-iconbtn--sm" data-borrar="${esc(o.id)}"
                    data-tip="Eliminar"><i data-icon="trash"></i></button>
          </div>
        </div>`).join('')}</div>`}
    </div>`);

  document.getElementById('ho-nueva').onclick = () => Router.go('orden');

  const elVaciar = document.getElementById('ho-vaciar');
  if (elVaciar) elVaciar.onclick = () => vaciarHistorial(lista.length);

  for (const el of document.querySelectorAll('[data-abrir]')) {
    const ver = () => verOrden(el.dataset.abrir);
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
      const r = await rx.ordenes.imprimir(b.dataset.imprimir);
      if (!r.cancelado && !r.ok) throw new Error(r.motivo || 'La impresora rechazó el trabajo.');
    }, { errorTitle: 'No se pudo imprimir' });
  }

  for (const b of document.querySelectorAll('[data-pdf]')) {
    b.onclick = () => attempt(async () => {
      const r = await rx.ordenes.pdf(b.dataset.pdf);
      if (!r.cancelado) Toast.show({ title: 'PDF guardado', text: r.ruta, icon: 'save' });
    }, { errorTitle: 'No se pudo generar el PDF' });
  }

  for (const b of document.querySelectorAll('[data-borrar]')) {
    /* La fila sale animada y recién después se repinta la lista. */
    b.onclick = () => borrarOrden(b.dataset.borrar, {
      antesDeRepintar: (listo) => exit(b.closest('.ox-listitem'), { onDone: listo }),
    });
  }

  if (ordenId) verOrden(ordenId);
}

/* ══ Borrar ══════════════════════════════════════════════════════════════════ */

/** Confirma y borra UNA orden. Lo comparten el tacho de la fila y el botón
    del modal de la orden. Devuelve si se borró. */
async function borrarOrden(id, { antesDeRepintar = (listo) => listo() } = {}) {
  const ok = await Modal.confirm({
    title: 'Eliminar la orden',
    sub: 'Se borra del historial. Si ya salió impresa, el papel sigue existiendo. No hay vuelta atrás.',
    confirmLabel: 'Eliminar',
    danger: true,
  });
  if (!ok) return false;
  const hecho = await attempt(() => rx.ordenes.remove(id), { errorTitle: 'No se pudo eliminar' });
  if (!hecho) return false;
  Toast.show({ title: 'Orden eliminada', icon: 'trash' });
  antesDeRepintar(() => Router.refresh());
  return true;
}

/** Borra el historial de órdenes ENTERO, escribiendo la palabra. */
async function vaciarHistorial(cuantas) {
  const ok = await Modal.confirmTyped({
    title: 'Borrar todo el historial',
    sub: `Se borran ${plural(cuantas, 'orden', 'órdenes')} ${cuantas === 1 ? 'emitida' : 'emitidas'}. `
      + 'Los pacientes, el catálogo de estudios y las recetas quedan. Si querés conservarlas, '
      + 'guardá antes un respaldo desde Ajustes. No hay vuelta atrás.',
    word: 'borrar',
    confirmLabel: 'Borrar historial',
  });
  if (!ok) return;
  const n = await attempt(() => rx.ordenes.vaciar(), { errorTitle: 'No se pudo borrar el historial' });
  if (n == null) return;
  Toast.show({
    title: 'Historial borrado',
    text: `${plural(n, 'orden', 'órdenes')} ${n === 1 ? 'eliminada' : 'eliminadas'}.`,
    icon: 'trash',
  });
  Router.refresh();
}

/** Muestra la hoja tal como se emitió, desde la instantánea. */
async function verOrden(id) {
  const o = await rx.ordenes.get(id);
  if (!o) return Toast.error('No está', 'Esa orden ya no existe.');

  const datos = {
    tipo: 'orden',
    paciente: o.snapshot?.paciente || null,
    medico: o.snapshot?.medico || null,
    items: o.items,
    fecha: o.fecha,
    diagnostico: o.diagnostico,
    observaciones: o.observaciones,
  };

  const caja = document.createElement('div');
  caja.innerHTML = `<div class="rx-previa__papel" style="--rx-zoom:.62;margin:0 auto">
    ${hoja(datos)}</div>`;

  const val = await Modal.show({
    title: `Orden del ${fecha(o.fecha)}`,
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
    await borrarOrden(id);
  } else if (val === 'pdf') {
    await attempt(async () => {
      const res = await rx.ordenes.pdf(id);
      if (!res.cancelado) Toast.show({ title: 'PDF guardado', text: res.ruta, icon: 'save' });
    }, { errorTitle: 'No se pudo generar el PDF' });
  } else if (val === 'imprimir') {
    await attempt(async () => {
      const res = await rx.ordenes.imprimir(id);
      if (!res.cancelado && !res.ok) throw new Error(res.motivo || 'La impresora rechazó el trabajo.');
    }, { errorTitle: 'No se pudo imprimir' });
  }
}
