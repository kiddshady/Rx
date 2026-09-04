/* ═══════════════════════════════════════════════════════════════════════════
   Rx — la plantilla de la hoja

   Un solo módulo, dos consumidores: la vista previa dentro de la app y la
   ventana oculta que imprime. Si esto se duplicara, tarde o temprano la previa
   mostraría algo que el papel no dice — que en una receta no es un detalle
   cosmético.

   Recibe siempre la MISMA forma de dato, que es la que queda congelada en
   `receta.snapshot`. Así reimprimir una receta de marzo pinta exactamente lo
   que salió en marzo.

   Son tres hojas: la receta clásica, la RPE y la orden de estudios. La orden
   es la clásica con el listado de estudios donde va el Rp/, y por eso comparte
   con ella el encabezado del paciente y el pie de firma — literalmente las
   mismas funciones, no una copia parecida.
   ═══════════════════════════════════════════════════════════════════════════ */

const CRUDO = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => CRUDO[c]);
}

/** ISO (2026-08-07) → 07/08/2026. Lo que no sea ISO se devuelve como vino. */
export function fechaLarga(f) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(f || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(f || '');
}

/** Los años cumplidos a la fecha de la receta, para el encabezado. */
export function edad(nacimiento, hasta) {
  const n = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(nacimiento || ''));
  if (!n) return null;
  const ref = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(hasta || '')) || null;
  const hoy = ref
    ? new Date(Number(ref[1]), Number(ref[2]) - 1, Number(ref[3]))
    : new Date();
  const nac = new Date(Number(n[1]), Number(n[2]) - 1, Number(n[3]));
  let a = hoy.getFullYear() - nac.getFullYear();
  const antes = hoy.getMonth() < nac.getMonth()
    || (hoy.getMonth() === nac.getMonth() && hoy.getDate() < nac.getDate());
  if (antes) a -= 1;
  return a >= 0 && a < 130 ? a : null;
}

function fila(rotulo, valor) {
  return valor ? `<dt>${esc(rotulo)}</dt><dd>${esc(valor)}</dd>` : '';
}

/* ── Piezas que comparten la clásica y la orden ──────────────────────────── */

/** El encabezado con la filiación del paciente. La edad se calcula A LA FECHA
    del documento, no a hoy: una orden de marzo dice los años que tenía en
    marzo. */
function bloquePaciente(p, fechaRef) {
  const años = edad(p.nacimiento, fechaRef);
  let h = `<div class="paciente"><dl>`;
  if (p.apellido_nombre) {
    h += fila('Paciente:', p.apellido_nombre);
    h += fila('DNI:', p.dni || '—');
    h += fila('CUIL:', p.cuil);
    h += fila('Sexo:', p.sexo);
    h += fila('F. nacimiento:', p.nacimiento
      ? `${fechaLarga(p.nacimiento)}${años != null ? ` (${años} años)` : ''}` : '');
    h += fila('Domicilio:', p.domicilio);
    h += fila('Cobertura:', p.cobertura);
    h += fila('Afiliado:', p.afiliado);
  } else {
    h += `<dt>Paciente:</dt><dd class="sin-datos">— sin paciente —</dd>`;
  }
  h += `</dl></div>`;
  return h;
}

/** El pie: fecha a la izquierda y el espacio de firma manuscrita a la derecha,
    con el nombre y los sellos debajo de la línea. */
function pieFirmado(m, fechaDoc) {
  let h = `<div class="pie">`;
  h += `<div class="fecha">Fecha: ${esc(fechaLarga(fechaDoc) || '—')}</div>`;
  h += `<div class="firma"><div class="hueco"></div>`;
  h += `<div class="linea">${esc(m.apellido_nombre || 'Firma y sello')}</div>`;
  if (m.matricula) h += `<div class="sello">Mat. ${esc(m.matricula)}</div>`;
  if (m.especialidad) h += `<div class="sello">${esc(m.especialidad)}</div>`;
  h += `</div></div>`;
  return h;
}

/* ── Clásica ─────────────────────────────────────────────────────────────── */

function clasica(r, duplicado) {
  const p = r.paciente || {};
  const m = r.medico || {};
  const items = r.items || [];

  let h = `<section class="rx-hoja rx-hoja--clasica">`;
  h += duplicado
    ? `<span class="marca-dup">Duplicado</span>`
    : `<span class="marca-dup marca-dup--vacia">Duplicado</span>`;

  h += `<div class="cuerpo">` + bloquePaciente(p, r.fecha);

  h += `<div class="rp">Rp/</div>`;
  for (const it of items) {
    h += `<div class="item"><div class="nombre">${esc(it.nombre || '—')}</div><div class="detalle">`;
    if (it.dosis) h += `<span>${esc(it.dosis)}</span>`;
    h += `<div class="fila">`;
    if (it.marca) h += `<span>Marca sugerida: ${esc(it.marca)}</span>`;
    h += `<span>Envases: ${esc(it.envases || 1)}</span>`;
    h += `</div>`;
    if (it.diagnostico) h += `<span>Diagnóstico: ${esc(it.diagnostico)}</span>`;
    if (it.indicaciones) h += `<span>Indicaciones: ${esc(it.indicaciones)}</span>`;
    h += `</div></div>`;
  }
  h += `</div>`;

  h += pieFirmado(m, r.fecha);
  h += `</section>`;
  return h;
}

/* ── RPE ─────────────────────────────────────────────────────────────────── */

function rpe(r, duplicado) {
  const p = r.paciente || {};
  const items = r.items || [];

  let h = `<section class="rx-hoja rx-hoja--rpe">`;

  h += `<div class="caja-paciente">`;
  if (p.apellido_nombre) {
    h += `<div class="nombre">Paciente: ${esc(p.apellido_nombre)}</div>`;
    h += `<div class="fila"><span>CUIL: ${esc(p.cuil || '—')}</span><span>DNI: ${esc(p.dni || '—')}</span></div>`;
    if (p.sexo || p.nacimiento) {
      h += `<div class="fila">`;
      if (p.sexo) h += `<span>Sexo: ${esc(p.sexo)}</span>`;
      if (p.nacimiento) h += `<span>F.Nacimiento: ${esc(fechaLarga(p.nacimiento))}</span>`;
      h += `</div>`;
    }
    if (p.domicilio) h += `<div class="fila"><span>Domicilio: ${esc(p.domicilio)}</span></div>`;
  } else {
    h += `<div class="nombre sin-datos">— sin paciente —</div>`;
  }
  h += `</div>`;

  /* La cobertura va en su propia caja, aparte de la del paciente, como en el
     formulario oficial. Si no está cargada no se dibuja: una caja vacía ocupa
     lugar en la hoja y no dice nada. */
  if (p.cobertura) {
    h += `<div class="caja-cobertura"><span>Cobertura: ${esc(p.cobertura)}</span>`;
    if (p.afiliado) h += `<span>Afiliado: ${esc(p.afiliado)}</span>`;
    h += `</div>`;
  }

  h += `<div class="encabezado-rp"><div>Rp/</div>`;
  if (duplicado) h += `<div class="marca-dup">DUPLICADO</div>`;
  h += `<div>Envases</div></div>`;

  items.forEach((it, i) => {
    h += `<div class="item"><div class="principal">`;
    h += `<div class="nombre">${esc(it.nombre || '—')}</div>`;
    if (it.dosis) h += `<div class="dosis">${esc(it.dosis)}</div>`;
    if (it.marca) h += `<div class="marca">Marca sugerida: ${esc(it.marca)}</div>`;
    if (it.diagnostico) h += `<div class="diagnostico">Diagnóstico: ${esc(it.diagnostico)}</div>`;
    if (it.indicaciones) h += `<div class="indicaciones">Indicaciones: ${esc(it.indicaciones)}</div>`;
    h += `</div><div class="envases">${esc(it.envases || 1)}</div></div>`;
    if (i < items.length - 1) h += `<hr class="separador">`;
  });

  h += `<div class="hueco-firma"></div>`;
  h += `<div class="pie"><div>Emitida: ${esc(fechaLarga(r.fecha) || '—')}</div>`;
  h += `<div class="firma"><div class="linea"></div><div>Firma y sello</div></div>`;
  h += `</div></section>`;
  return h;
}

/* ── Orden de estudios ───────────────────────────────────────────────────── */

/* Mismo encabezado y mismo pie que la clásica; en el medio, el listado de lo
   que se pide en vez del Rp/. El diagnóstico y las observaciones van UNA vez,
   al final de la lista y no por renglón: es un solo pedido, no cinco. */
function orden(o) {
  const p = o.paciente || {};
  const m = o.medico || {};
  const items = o.items || [];

  let h = `<section class="rx-hoja rx-hoja--orden">`;
  h += `<div class="cuerpo">` + bloquePaciente(p, o.fecha);

  h += `<div class="titulo">Solicito:</div>`;
  h += `<ol class="estudios">`;
  for (const it of items) {
    h += `<li><span class="nombre">${esc(it.nombre || '—')}</span>`;
    if (it.aclaracion) h += `<span class="aclaracion">${esc(it.aclaracion)}</span>`;
    h += `</li>`;
  }
  h += `</ol>`;
  /* Solo se ve en la vista previa: emitir una orden sin estudios no se puede.
     Sin esto, el título quedaría colgado arriba de la nada mientras se escribe
     el primero, y la hoja parecería rota en vez de vacía. */
  if (items.length === 0) h += `<div class="sin-datos">— sin estudios —</div>`;

  if (o.diagnostico) {
    h += `<div class="dato"><span class="rotulo">Diagnóstico:</span> ${esc(o.diagnostico)}</div>`;
  }
  if (o.observaciones) {
    h += `<div class="dato"><span class="rotulo">Observaciones:</span> ${esc(o.observaciones)}</div>`;
  }
  h += `</div>`;

  h += pieFirmado(m, o.fecha);
  h += `</section>`;
  return h;
}

/**
 * Arma UNA hoja.
 *
 * El tipo manda antes que la plantilla: una orden no tiene clásica ni RPE.
 * Sin `tipo`, es una receta — es lo que había antes de que existiera la orden
 * y lo que sigue llegando desde los snapshots viejos.
 *
 * @param {object} d  receta {paciente, medico, items, fecha, plantilla, numero}
 *                    u orden {tipo:'orden', paciente, medico, items, fecha,
 *                             diagnostico, observaciones}
 * @param {{duplicado?: boolean}} opts
 */
export function hoja(d, { duplicado = false } = {}) {
  if (d?.tipo === 'orden') return orden(d);
  return (d?.plantilla === 'rpe' ? rpe : clasica)(d || {}, duplicado);
}

/**
 * El juego completo que se imprime.
 *
 * La receta van siempre las dos hojas — el duplicado es lo que se queda la
 * farmacia. La orden sale en UNA: se la queda el laboratorio y listo.
 */
export function juego(d) {
  if (d?.tipo === 'orden') return hoja(d);
  return hoja(d, { duplicado: false }) + hoja(d, { duplicado: true });
}
