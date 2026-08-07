/* ═══════════════════════════════════════════════════════════════════════════
   Rx — estado compartido

   Vive aparte de `app.js` por una razón concreta: `app.js` importa las vistas y
   las vistas necesitan tocar el estado. Si el estado viviera en `app.js`, cada
   vista tendría que importarlo de vuelta y el ciclo de imports se arregla solo
   hasta el día que deja de hacerlo.

   Acá NO se cachean datos clínicos. Los contadores del rail sí, porque se
   dibujan en cada pintada; las fichas y las recetas se piden cuando se
   necesitan. Un espejo en memoria de la historia clínica sería una copia más
   que mantener sincronizada, y sobre todo una copia en claro más de la que
   preocuparse.
   ═══════════════════════════════════════════════════════════════════════════ */

export const S = {
  info: null,
  ajustes: {},
  resumen: { pacientes: 0, recetas: 0, recetasHoy: 0, evoluciones: 0, ultimasRecetas: [] },
  medico: null,
};

/** Vuelve a pedir los contadores y refresca el rail y la statusbar. */
export async function refrescar() {
  S.resumen = await window.rx.resumen();
  pintarChrome();
  return S.resumen;
}

export function pintarChrome() {
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el && el.textContent !== String(v)) el.textContent = String(v);
  };
  set('cuenta-pacientes', S.resumen.pacientes);
  set('cuenta-recetas', S.resumen.recetas);
  set('stat-hoy', S.resumen.recetasHoy);
}

/** La fecha de hoy en ISO, que es como se guardan todas las fechas. */
export function hoyISO() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** ISO → dd/mm/aaaa, para mostrar. Lo que no sea ISO vuelve como vino. */
export function fecha(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || '');
}

/** Los años cumplidos, o null si no hay fecha de nacimiento cargada. */
export function edad(nacimiento) {
  const n = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(nacimiento || ''));
  if (!n) return null;
  const hoy = new Date();
  const nac = new Date(Number(n[1]), Number(n[2]) - 1, Number(n[3]));
  let a = hoy.getFullYear() - nac.getFullYear();
  const antes = hoy.getMonth() < nac.getMonth()
    || (hoy.getMonth() === nac.getMonth() && hoy.getDate() < nac.getDate());
  if (antes) a -= 1;
  return a >= 0 && a < 130 ? a : null;
}

/* ── Validación de documentos ────────────────────────────────────────────────
   Se conservan del prototipo porque estaban bien: el CUIL trae dígito
   verificador y validarlo agarra el error de tipeo en el momento, no cuando la
   obra social rebota la receta. */

export function validarDNI(dni) {
  const d = String(dni || '').replace(/[.\s]/g, '');
  if (!d) return null;
  return /^\d{7,8}$/.test(d) ? null : 'El DNI tiene que tener 7 u 8 dígitos.';
}

export function validarCUIL(cuil) {
  const c = String(cuil || '').replace(/[-\s]/g, '');
  if (!c) return null;
  if (!/^\d{11}$/.test(c)) return 'El CUIL tiene que tener 11 dígitos.';
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  let suma = 0;
  for (let i = 0; i < 10; i++) suma += Number(c[i]) * pesos[i];
  const resto = suma % 11;
  if (resto === 1) return 'El CUIL no es válido (dígito verificador).';
  const dv = resto === 0 ? 0 : 11 - resto;
  return Number(c[10]) === dv ? null : 'El CUIL no es válido (dígito verificador).';
}
