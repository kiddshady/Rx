/* Pacientes: la lista, y la ficha clínica de cada uno. */

import { Modal, Toast, Menu } from '../overlays.js';
import Router from '../router.js';
import { paint, head, esc, empty, attempt } from '../ui.js';
import { campoFecha, cablearFechas, isoDe } from '../campo-fecha.js';
import { S, fecha, edad, hoyISO, validarDNI, validarCUIL } from '../tienda.js';
import { plural } from '../format.js';

const rx = window.rx;

/* ══ Formulario de datos personales ══════════════════════════════════════════ */

function campo(id, rotulo, valor, extra = '') {
  return `<div class="ox-field">
    <label class="ox-field__label" for="${id}">${esc(rotulo)}</label>
    <input class="ox-input" id="${id}" spellcheck="false" value="${esc(valor || '')}" ${extra}>
  </div>`;
}

/* Los tres que admite el DNI. */
const SEXOS = ['Femenino', 'Masculino', 'X'];

/* El sexo sale de una lista corta y cerrada, así que va en el select propio y
   no en un `<input list>`. El datalist abre el desplegable NATIVO de Chromium
   —su chevron, su lista, su tipografía—, que es lo único que quedaba sin
   dibujar en toda la app.

   El valor vive en el `value` del botón, que es una propiedad real de
   `<button>` y no un truco: así `leerFormulario` lo lee igual que a cualquier
   input, sin tener que saber que este campo es distinto. */
function campoSexo(valor) {
  return `<div class="ox-field">
    <label class="ox-field__label">Sexo</label>
    <button class="ox-select" id="p-sexo" type="button" value="${esc(valor || '')}">
      <span class="ox-select__value" data-placeholder="Sin especificar">${esc(valor || '')}</span>
      <i data-icon="chevronDown"></i>
    </button>
  </div>`;
}

function cablearSexo(caja) {
  const btn = caja.querySelector('#p-sexo');
  const val = btn.querySelector('.ox-select__value');
  const poner = (v) => { btn.value = v; val.textContent = v; };

  btn.addEventListener('click', () => {
    Menu.show(btn, [
      ...SEXOS.map((s) => ({ label: s, selected: btn.value === s, onSelect: () => poner(s) })),
      { sep: true },
      /* Con el `<input>` el campo se vaciaba borrando el texto. Sin esta
         opción, un click equivocado no tendría vuelta atrás. */
      { label: 'Sin especificar', selected: !btn.value, onSelect: () => poner('') },
    ]);
  });
}

function formularioPaciente(p = {}) {
  const caja = document.createElement('div');
  caja.className = 'ox-col';
  caja.style.gap = 'var(--ox-3)';
  caja.innerHTML = `
    ${campo('p-nombre', 'Apellido y nombre', p.apellido_nombre, 'placeholder="GÓMEZ, MARÍA ELENA"')}
    <div class="rx-fila">
      ${campo('p-dni', 'DNI', p.dni, 'placeholder="28123456" inputmode="numeric"')}
      ${campo('p-cuil', 'CUIL', p.cuil, 'placeholder="27-28123456-4"')}
    </div>
    <div class="rx-fila">
      ${campoSexo(p.sexo)}
      ${campoFecha({ id: 'p-nac', label: 'Fecha de nacimiento', valor: p.nacimiento })}
    </div>
    ${campo('p-domicilio', 'Domicilio', p.domicilio)}
    <div class="rx-fila">
      ${campo('p-telefono', 'Teléfono', p.telefono, 'inputmode="tel"')}
      ${campo('p-email', 'Correo', p.email, 'inputmode="email"')}
    </div>
    <div class="rx-fila">
      ${campo('p-cobertura', 'Cobertura', p.cobertura, 'placeholder="Particular / OSDE / PAMI"')}
      ${campo('p-afiliado', 'Nº de afiliado', p.afiliado)}
    </div>
    <div class="rx-cerradura__error" id="p-error"></div>`;
  cablearFechas(caja);
  cablearSexo(caja);
  return caja;
}

function leerFormulario(caja, p) {
  const v = (sel) => caja.querySelector(sel).value;
  return {
    id: p?.id,
    apellido_nombre: v('#p-nombre'),
    dni: v('#p-dni'),
    cuil: v('#p-cuil'),
    sexo: v('#p-sexo'),
    nacimiento: isoDe(caja.querySelector('#p-nac')),
    domicilio: v('#p-domicilio'),
    telefono: v('#p-telefono'),
    email: v('#p-email'),
    cobertura: v('#p-cobertura'),
    afiliado: v('#p-afiliado'),
    /* La ficha clínica no se toca acá: este diálogo es solo la filiación. Si
       mandara los campos vacíos, editar un teléfono borraría las alergias. */
    antecedentes: p?.antecedentes ?? '',
    alergias: p?.alergias ?? '',
    medicacion_habitual: p?.medicacion_habitual ?? '',
    notas: p?.notas ?? '',
  };
}

/**
 * Abre el diálogo y devuelve el paciente guardado, o null si se canceló.
 *
 * Si algo no valida, el diálogo se vuelve a abrir CON LO QUE YA SE HABÍA
 * ESCRITO. Validar después de cerrarlo y mostrar un aviso deja a la doctora
 * tipeando doce campos de nuevo por un dígito verificador mal puesto — que es
 * justo el error más fácil de cometer.
 */
async function editarPaciente(p) {
  let datos = { ...p };

  for (;;) {
    const caja = formularioPaciente(datos);
    const val = await Modal.show({
      title: p?.id ? 'Editar paciente' : 'Nuevo paciente',
      body: caja,
      width: 620,
      actions: [
        { label: 'Cancelar', value: null },
        { label: 'Guardar', value: 'ok', variant: 'primary' },
      ],
    });
    if (val !== 'ok') return null;

    datos = leerFormulario(caja, p);
    const error = !datos.apellido_nombre.trim()
      ? 'Falta el apellido y nombre.'
      : (validarDNI(datos.dni) || validarCUIL(datos.cuil));

    if (!error) {
      return attempt(() => rx.pacientes.save(datos),
        { errorTitle: 'No se pudo guardar el paciente' });
    }
    Toast.error('Revisá los datos', error);
  }
}

/* ══ Lista ═══════════════════════════════════════════════════════════════════ */

export async function vistaPacientes(busqueda = '') {
  const q = typeof busqueda === 'string' ? busqueda : '';
  const lista = await rx.pacientes.list({ busqueda: q });

  paint(head({
    title: 'Pacientes',
    sub: lista.length
      ? `${lista.length} ${plural(lista.length, 'paciente')}`
      : 'Todavía no hay pacientes cargados',
    actions: `<button class="ox-btn ox-btn--primary ox-flashable" id="p-nuevo">
                <i data-icon="plus"></i> Nuevo paciente</button>`,
  }) + `
    <div class="ox-scroll ox-grow ox-scroll--line-bottom">
      <div class="ox-inputwrap rx-buscador" style="margin-bottom:var(--ox-4)">
        <i data-icon="search"></i>
        <input class="ox-input" id="p-buscar" placeholder="Buscar por apellido, DNI o cobertura…"
               spellcheck="false" value="${esc(q)}">
      </div>
      ${lista.length === 0
      ? empty({
        icon: 'users',
        title: q ? 'Nadie coincide con esa búsqueda' : 'No hay pacientes todavía',
        text: q ? 'Probá con el apellido o el DNI.' : 'Cargá el primero con el botón de arriba.',
      })
      : `<div class="ox-list">${lista.map((p) => {
        const a = edad(p.nacimiento);
        return `<div class="ox-listitem" data-ficha="${esc(p.id)}" role="button" tabindex="0">
            <div class="ox-iconcell"><i data-icon="user"></i></div>
            <div class="ox-listitem__main">
              <div class="ox-listitem__title">${esc(p.apellido_nombre)}</div>
              <div class="ox-listitem__sub ox-truncate">${[
          p.dni && `DNI ${p.dni}`,
          a != null && `${a} años`,
          p.cobertura,
        ].filter(Boolean).map(esc).join(' · ') || '—'}</div>
            </div>
            ${p.alergias ? `<div class="ox-listitem__aside">
              <span class="ox-chip ox-chip--danger" data-tip="${esc(p.alergias)}">Alergias</span></div>` : ''}
          </div>`;
      }).join('')}</div>`}
    </div>`);

  const buscar = document.getElementById('p-buscar');
  let reloj = null;
  buscar.addEventListener('input', () => {
    clearTimeout(reloj);
    reloj = setTimeout(() => vistaPacientes(buscar.value), 160);
  });
  Router.onLeave(() => clearTimeout(reloj));

  document.getElementById('p-nuevo').onclick = async () => {
    const nuevo = await editarPaciente({});
    if (nuevo) Router.go('ficha', nuevo.id);
  };

  for (const el of document.querySelectorAll('[data-ficha]')) {
    const ir = () => Router.go('ficha', el.dataset.ficha);
    el.addEventListener('click', ir);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ir(); }
    });
  }
}

/* ══ Evoluciones ═════════════════════════════════════════════════════════════ */

function formularioEvolucion(e = {}) {
  const caja = document.createElement('div');
  caja.className = 'ox-col';
  caja.style.gap = 'var(--ox-3)';
  caja.innerHTML = `
    <div class="rx-fila">
      ${campoFecha({ id: 'e-fecha', label: 'Fecha', valor: e.fecha || hoyISO() })}
      <div class="ox-field">
        <label class="ox-field__label" for="e-motivo">Motivo de consulta</label>
        <input class="ox-input" id="e-motivo" spellcheck="false" value="${esc(e.motivo || '')}">
      </div>
    </div>
    <div class="ox-field">
      <label class="ox-field__label" for="e-notas">Evolución</label>
      <textarea class="ox-textarea" id="e-notas" rows="7"
                placeholder="Qué se observó, qué se decidió, qué se indicó.">${esc(e.notas || '')}</textarea>
    </div>
    <div class="ox-field">
      <label class="ox-field__label" for="e-diag">Diagnóstico</label>
      <input class="ox-input" id="e-diag" spellcheck="false" value="${esc(e.diagnostico || '')}">
    </div>
    <div class="rx-fila">
      <div class="ox-field">
        <label class="ox-field__label" for="e-peso">Peso</label>
        <input class="ox-input" id="e-peso" placeholder="72 kg" value="${esc(e.peso || '')}">
      </div>
      <div class="ox-field">
        <label class="ox-field__label" for="e-talla">Talla</label>
        <input class="ox-input" id="e-talla" placeholder="1,68 m" value="${esc(e.talla || '')}">
      </div>
      <div class="ox-field">
        <label class="ox-field__label" for="e-presion">Presión</label>
        <input class="ox-input" id="e-presion" placeholder="120/80" value="${esc(e.presion || '')}">
      </div>
    </div>`;
  cablearFechas(caja);
  return caja;
}

async function editarEvolucion(pacienteId, e) {
  const caja = formularioEvolucion(e);
  const val = await Modal.show({
    title: e?.id ? 'Editar evolución' : 'Nueva evolución',
    body: caja,
    width: 640,
    actions: [
      { label: 'Cancelar', value: null },
      { label: 'Guardar', value: 'ok', variant: 'primary' },
    ],
  });
  if (val !== 'ok') return false;

  const r = await attempt(() => rx.evoluciones.save({
    id: e?.id,
    paciente_id: pacienteId,
    fecha: isoDe(caja.querySelector('#e-fecha')),
    motivo: caja.querySelector('#e-motivo').value,
    notas: caja.querySelector('#e-notas').value,
    diagnostico: caja.querySelector('#e-diag').value,
    peso: caja.querySelector('#e-peso').value,
    talla: caja.querySelector('#e-talla').value,
    presion: caja.querySelector('#e-presion').value,
  }), { errorTitle: 'No se pudo guardar la evolución' });
  return !!r;
}

/* ══ Ficha ═══════════════════════════════════════════════════════════════════ */

/** Un bloque clínico que se edita en el lugar y se guarda al salir del campo.

    `alerta` tiñe el campo de rojo cuando tiene contenido. Es para alergias, y
    reemplaza al cartel separado que había antes arriba: mostrar el mismo texto
    dos veces a diez centímetros no lo hace más visible, lo hace ruido. Acá el
    dato salta a la vista Y se edita en el mismo lugar. El rojo no significa
    "falló algo" — es el otro uso legítimo del único color fuerte de la app. */
function bloqueClinico(id, rotulo, valor, placeholder, alerta = false) {
  const encendido = alerta && !!String(valor || '').trim();
  return `<div class="ox-field${encendido ? ' rx-campo-alerta' : ''}">
    <label class="ox-field__label" for="${id}">${esc(rotulo)}</label>
    <textarea class="ox-textarea" id="${id}" rows="3" data-clinico
              placeholder="${esc(placeholder)}">${esc(valor || '')}</textarea>
  </div>`;
}

export async function vistaFicha(id) {
  if (!id) return Router.go('pacientes');

  const p = await rx.pacientes.get(id);
  if (!p) {
    paint(head({ title: 'Paciente', crumbs: [{ label: 'Pacientes', view: 'pacientes' }] })
      + empty({ icon: 'users', title: 'Ese paciente ya no existe' }));
    return;
  }

  const [evoluciones, recetas, ordenes] = await Promise.all([
    rx.evoluciones.list(id),
    rx.recetas.list({ pacienteId: id, limite: 50 }),
    rx.ordenes.list({ pacienteId: id, limite: 50 }),
  ]);

  const años = edad(p.nacimiento);
  const filiacion = [
    p.dni && `DNI ${p.dni}`,
    p.cuil && `CUIL ${p.cuil}`,
    p.nacimiento && `${fecha(p.nacimiento)}${años != null ? ` (${años} años)` : ''}`,
    p.sexo,
    p.cobertura && (p.afiliado ? `${p.cobertura} · ${p.afiliado}` : p.cobertura),
    p.telefono,
    p.domicilio,
  ].filter(Boolean);

  paint(head({
    title: p.apellido_nombre,
    sub: filiacion.join(' · ') || 'Sin datos de filiación',
    crumbs: [{ label: 'Pacientes', view: 'pacientes' }],
    /* Dos emisiones y un solo primario: la receta es lo que más se hace desde
       una ficha, y la orden va al lado en secundario en vez de competir por el
       mismo peso. */
    actions: `
      <button class="ox-btn ox-btn--secondary ox-flashable" id="f-orden">
        <i data-icon="orden"></i> Nueva orden</button>
      <button class="ox-btn ox-btn--primary ox-flashable" id="f-receta">
        <i data-icon="plus"></i> Nueva receta</button>
      <button class="ox-iconbtn" id="f-mas" data-tip="Más acciones"><i data-icon="more"></i></button>`,
  }) + `
    <div class="ox-scroll ox-grow ox-scroll--line-bottom">

      <div class="ox-section">
        <div class="ox-section__head">
          <div class="ox-section__title">Ficha clínica</div>
          <span class="ox-meta" id="f-estado"></span>
        </div>
        <div class="ox-card"><div class="ox-card__body ox-col" style="gap:var(--ox-3)">
          ${bloqueClinico('f-alergias', 'Alergias', p.alergias, 'Penicilina, AINEs…', true)}
          ${bloqueClinico('f-antecedentes', 'Antecedentes', p.antecedentes, 'Personales, familiares, quirúrgicos.')}
          ${bloqueClinico('f-medicacion', 'Medicación habitual', p.medicacion_habitual, 'Lo que ya toma, con dosis.')}
          ${bloqueClinico('f-notas', 'Notas', p.notas, '')}
        </div></div>
      </div>

      <div class="ox-section">
        <div class="ox-section__head">
          <div class="ox-section__title">Evoluciones</div>
          <button class="ox-btn ox-btn--secondary ox-btn--sm ox-flashable" id="f-evo-nueva">
            <i data-icon="plus"></i> Agregar</button>
        </div>
        ${evoluciones.length === 0
      ? empty({ icon: 'ficha', title: 'Sin evoluciones', text: 'Cada consulta se anota acá.' })
      : `<div class="ox-card"><div class="ox-card__body">${evoluciones.map((e) => `
          <div class="rx-evolucion" data-evo="${esc(e.id)}">
            <div class="rx-evolucion__fecha">${esc(fecha(e.fecha))}</div>
            <div class="rx-evolucion__cuerpo">
              ${e.motivo ? `<div class="rx-evolucion__motivo">${esc(e.motivo)}</div>` : ''}
              ${e.notas ? `<div class="rx-evolucion__notas ox-copyable">${esc(e.notas)}</div>` : ''}
              ${e.diagnostico ? `<div class="ox-meta">Diagnóstico: ${esc(e.diagnostico)}</div>` : ''}
              ${(e.peso || e.talla || e.presion) ? `<div class="rx-evolucion__signos">
                ${e.peso ? `<span class="ox-chip ox-chip--mono">${esc(e.peso)}</span>` : ''}
                ${e.talla ? `<span class="ox-chip ox-chip--mono">${esc(e.talla)}</span>` : ''}
                ${e.presion ? `<span class="ox-chip ox-chip--mono">${esc(e.presion)}</span>` : ''}
              </div>` : ''}
            </div>
            <div class="ox-rowactions">
              <button class="ox-iconbtn ox-iconbtn--sm" data-evo-editar="${esc(e.id)}"
                      data-tip="Editar"><i data-icon="edit"></i></button>
              <button class="ox-iconbtn ox-iconbtn--sm" data-evo-borrar="${esc(e.id)}"
                      data-tip="Eliminar"><i data-icon="trash"></i></button>
            </div>
          </div>`).join('')}</div></div>`}
      </div>

      <div class="ox-section">
        <div class="ox-section__head"><div class="ox-section__title">Recetas</div></div>
        ${recetas.length === 0
      ? empty({ icon: 'file', title: 'Sin recetas emitidas' })
      : `<div class="ox-list">${recetas.map((r) => `
          <div class="ox-listitem" data-receta="${esc(r.id)}" role="button" tabindex="0">
            <div class="ox-iconcell"><i data-icon="file"></i></div>
            <div class="ox-listitem__main">
              <div class="ox-listitem__title ox-truncate">${esc(r.detalle || '—')}</div>
              <div class="ox-listitem__sub">${esc(r.items)} ${plural(r.items, 'medicamento')} ·
                plantilla ${esc(r.plantilla === 'rpe' ? 'RPE' : 'Clásica')}</div>
            </div>
            <div class="ox-listitem__aside ox-num">${esc(fecha(r.fecha))}</div>
          </div>`).join('')}</div>`}
      </div>

      <div class="ox-section">
        <div class="ox-section__head"><div class="ox-section__title">Órdenes</div></div>
        ${ordenes.length === 0
      ? empty({ icon: 'orden', title: 'Sin órdenes emitidas' })
      : `<div class="ox-list">${ordenes.map((o) => `
          <div class="ox-listitem" data-orden="${esc(o.id)}" role="button" tabindex="0">
            <div class="ox-iconcell"><i data-icon="orden"></i></div>
            <div class="ox-listitem__main">
              <div class="ox-listitem__title ox-truncate">${esc(o.detalle || '—')}</div>
              <div class="ox-listitem__sub">${plural(o.items, 'estudio')}${
        o.diagnostico ? ` · ${esc(o.diagnostico)}` : ''}</div>
            </div>
            <div class="ox-listitem__aside ox-num">${esc(fecha(o.fecha))}</div>
          </div>`).join('')}</div>`}
      </div>
    </div>`);

  /* ── Ficha clínica: se guarda al salir del campo, no con un botón ──────────
     Es lo que se espera de un cuaderno. Solo escribe si algo cambió de verdad:
     un blur sin edición no tiene por qué tocar el disco. */
  const estado = document.getElementById('f-estado');
  const campos = {
    alergias: document.getElementById('f-alergias'),
    antecedentes: document.getElementById('f-antecedentes'),
    medicacion_habitual: document.getElementById('f-medicacion'),
    notas: document.getElementById('f-notas'),
  };
  const original = Object.fromEntries(
    Object.entries(campos).map(([k, el]) => [k, el.value]));

  for (const [clave, el] of Object.entries(campos)) {
    el.addEventListener('blur', async () => {
      if (el.value === original[clave]) return;
      await attempt(async () => {
        await rx.pacientes.save({ ...p, ...Object.fromEntries(
          Object.entries(campos).map(([k, e2]) => [k, e2.value])) });
        original[clave] = el.value;
        estado.textContent = 'Guardado';
        setTimeout(() => { if (estado.textContent === 'Guardado') estado.textContent = ''; }, 2200);
        /* Si tocó las alergias, el bloque rojo de arriba tiene que reflejarlo. */
        if (clave === 'alergias') vistaFicha(id);
      }, { errorTitle: 'No se pudo guardar la ficha' });
    });
  }

  /* ── Acciones ── */
  document.getElementById('f-receta').onclick = () => Router.go('receta', id);
  document.getElementById('f-orden').onclick = () => Router.go('orden', id);

  document.getElementById('f-mas').onclick = (ev) => {
    Menu.show(ev.currentTarget, [
      { label: 'Editar datos personales', icon: 'edit', onSelect: async () => {
        if (await editarPaciente(p)) vistaFicha(id);
      } },
      { sep: true },
      { label: p.archivado ? 'Desarchivar' : 'Archivar', icon: 'archivar', onSelect: async () => {
        await attempt(() => rx.pacientes.archivar(id, !p.archivado));
        Toast.show({ title: p.archivado ? 'Desarchivado' : 'Archivado', icon: 'archivar' });
        Router.go('pacientes');
      } },
      { label: 'Eliminar paciente', icon: 'trash', danger: true, onSelect: async () => {
        const ok = await Modal.confirm({
          title: 'Eliminar el paciente',
          sub: `Se borran también sus ${evoluciones.length} ${plural(evoluciones.length, 'evolución', 'evoluciones')}. `
             + `Las ${recetas.length} ${plural(recetas.length, 'receta')} ya emitidas se conservan, `
             + 'porque son documentos que ya salieron impresos. No hay vuelta atrás.',
          confirmLabel: 'Eliminar',
          danger: true,
        });
        if (!ok) return;
        await attempt(() => rx.pacientes.remove(id));
        Toast.show({ title: 'Paciente eliminado', icon: 'trash' });
        Router.go('pacientes');
      } },
    ], { align: 'end' });
  };

  document.getElementById('f-evo-nueva').onclick = async () => {
    if (await editarEvolucion(id, {})) vistaFicha(id);
  };

  for (const b of document.querySelectorAll('[data-evo-editar]')) {
    b.onclick = async () => {
      const e = evoluciones.find((x) => x.id === b.dataset.evoEditar);
      if (e && await editarEvolucion(id, e)) vistaFicha(id);
    };
  }

  for (const b of document.querySelectorAll('[data-evo-borrar]')) {
    b.onclick = async () => {
      const e = evoluciones.find((x) => x.id === b.dataset.evoBorrar);
      const ok = await Modal.confirm({
        title: 'Eliminar la evolución',
        sub: `La del ${fecha(e.fecha)}. No hay vuelta atrás.`,
        confirmLabel: 'Eliminar',
        danger: true,
      });
      if (!ok) return;
      await attempt(() => rx.evoluciones.remove(e.id));
      vistaFicha(id);
    };
  }

  for (const el of document.querySelectorAll('[data-receta]')) {
    const ir = () => Router.go('recetas', el.dataset.receta);
    el.addEventListener('click', ir);
    el.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ir(); }
    });
  }

  for (const el of document.querySelectorAll('[data-orden]')) {
    const ir = () => Router.go('ordenes', el.dataset.orden);
    el.addEventListener('click', ir);
    el.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ir(); }
    });
  }
}
