/* ═══════════════════════════════════════════════════════════════════════════
   Humo de Rx: monta la app de verdad, la desbloquea y la recorre entera.

     npm run humo

   Corre contra una carpeta de datos temporal (RX_DATA), así que nunca toca los
   datos reales. Empieza por la cerradura porque es lo primero que ve la
   doctora, y porque si el desbloqueo se rompe no hay app.

   La regla que lo guía: **medí dónde CAE una cosa, no solo si existe.** Un
   modal presente en el DOM y renderizado en top:-281px pasa cualquier test que
   pregunte "¿existe?" y es inalcanzable con el mouse.
   ═══════════════════════════════════════════════════════════════════════════ */

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const W = 1440; const H = 900;
const CLAVE = 'clave-de-humo-2026';

const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'rx-humo-'));
process.env.RX_DATA = carpeta;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0; let fail = 0;
const ok = (n, c, x = '') => {
  if (c) { pass++; console.log(`  ok    ${n}`); }
  else { fail++; console.log(`  FALLA ${n}${x ? '  → ' + x : ''}`); }
};
/* Los errores del renderer se juntan siempre, y se vuelcan al abortar: sin eso,
   un "Script failed to execute" no dice absolutamente nada de qué se rompió. */
const errores = [];
const bail = (w, e) => {
  console.log(`\nABORTADO ${w}`, e?.stack || e || '');
  if (errores.length) console.log('\nConsola del renderer:\n  ' + errores.join('\n  '));
  app.exit(3);
};
process.on('unhandledRejection', (e) => bail('rechazo', e));
process.on('uncaughtException', (e) => bail('excepción', e));
setTimeout(() => bail('timeout de 180s'), 180000);

app.whenReady().then(async () => {
  require(path.join(ROOT, 'src', 'ipc.cjs')).register();

  const win = new BrowserWindow({
    x: -20000, y: -20000, width: W, height: H,
    frame: false, show: false, paintWhenInitiallyHidden: true, backgroundColor: '#000',
    webPreferences: { preload: path.join(ROOT, 'preload.cjs'), contextIsolation: true },
  });

  win.webContents.on('console-message', (e) => {
    if (e.level >= 2) errores.push(`${e.level}: ${e.message}`);
  });
  win.webContents.on('render-process-gone', (_e, d) => bail('el renderer se murió: ' + JSON.stringify(d)));

  await win.loadFile(path.join(ROOT, 'renderer', 'index.html'));
  win.show();
  await sleep(1800);

  const js = (c) => win.webContents.executeJavaScript(c);
  const click = (sel) => js(`(() => { const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return false; el.click(); return true; })()`);
  const escribir = (sel, valor) => js(`(() => {
    const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return false;
    el.value = ${JSON.stringify(valor)};
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true; })()`);
  /** Caja de un elemento, para poder preguntar DÓNDE cayó. */
  const caja = (sel) => js(`(() => { const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return null; const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);

  /* ── 1. Cerradura ─────────────────────────────────────────────────────── */
  console.log('\n1. Cerradura');
  ok('el splash se fue', !(await js(`!!document.getElementById('boot-splash')`)));
  ok('la cerradura está en pantalla', await js(`!document.getElementById('cerradura').hidden`));
  ok('primera vez: pide crear la contraseña', await js(`!!document.getElementById('clave2')`));
  ok('avisa que no hay recuperación',
    await js(`document.querySelector('.rx-aviso')?.textContent.includes('No hay forma de recuperarla')`));

  const cajaCaja = await caja('.rx-cerradura__caja');
  ok('la caja cae dentro de la ventana',
    !!cajaCaja && cajaCaja.x >= 0 && cajaCaja.y >= 0 && cajaCaja.x + cajaCaja.w <= W,
    JSON.stringify(cajaCaja));

  // Contraseñas que no coinciden: tiene que rebotar y NO abrir.
  await escribir('#clave', CLAVE);
  await escribir('#clave2', 'otra-cosa-distinta');
  await click('#enviar');
  await sleep(400);
  ok('rechaza cuando las contraseñas no coinciden',
    await js(`document.getElementById('error')?.classList.contains('is-visible')`));
  ok('sigue bloqueada después del rechazo', await js(`!document.getElementById('cerradura').hidden`));

  // Ahora bien.
  await escribir('#clave', CLAVE);
  await escribir('#clave2', CLAVE);
  await click('#enviar');
  await sleep(2500);

  ok('la cerradura se fue', await js(`document.getElementById('cerradura').hidden`));
  ok('la cerradura no dejó la contraseña en el DOM',
    !(await js(`document.body.innerHTML.includes(${JSON.stringify(CLAVE)})`)));

  /* ── 2. Shell ─────────────────────────────────────────────────────────── */
  console.log('\n2. Shell');
  ok('la titlebar y el rail están montados',
    await js(`!!document.querySelector('.ox-titlebar') && !!document.querySelector('.ox-rail')`));
  ok('los <i data-icon> se reemplazaron por SVG',
    !(await js(`!!document.querySelector('i[data-icon]')`)));
  ok('la vista inicial pintó algo', (await js(`document.getElementById('view').children.length`)) > 0);

  /* Cero emojis y cero glifos unicode: todo símbolo tiene que ser un SVG. Se
     buscan emojis y flechas/tildes usadas como ícono. La rayita (—) y el punto
     medio (·) son tipografía, no símbolos, y están permitidos. */
  const glifos = await js(`(() => {
    const malos = /[\\u{1F000}-\\u{1FAFF}\\u{2190}-\\u{21FF}\\u{2700}-\\u{27BF}\\u2713\\u2714\\u2717\\u2718\\u21B5\\u2605\\u2606]/u;
    const encontrados = [];
    const it = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n; while ((n = it.nextNode())) {
      if (malos.test(n.textContent)) encontrados.push(n.textContent.trim().slice(0, 40));
    }
    return encontrados;
  })()`);
  ok('no hay emojis ni glifos unicode de símbolo', glifos.length === 0, JSON.stringify(glifos));

  /* ── 3. Recorrer las vistas ───────────────────────────────────────────── */
  console.log('\n3. Vistas');
  for (const vista of ['tablero', 'pacientes', 'recetas', 'ordenes', 'medicamentos', 'estudios', 'ajustes']) {
    await click(`.ox-navitem[data-view="${vista}"]`);
    await sleep(600);
    const hijos = await js(`document.getElementById('view').children.length`);
    const titulo = await js(`document.querySelector('.ox-viewhead')?.textContent?.trim().slice(0,40) || ''`);
    ok(`"${vista}" monta y tiene encabezado`, hijos > 0 && titulo.length > 0, `hijos=${hijos} tit="${titulo}"`);
    ok(`"${vista}" ilumina su ítem del rail`,
      await js(`document.querySelector('.ox-navitem[data-view="${vista}"]')?.classList.contains('is-active')`));
  }

  /* ── 4. Alta de un paciente por la UI real ────────────────────────────── */
  console.log('\n4. Paciente');
  await click('.ox-navitem[data-view="pacientes"]');
  await sleep(500);
  await click('#p-nuevo');
  await sleep(700);

  const cajaModal = await caja('.ox-modal');
  ok('el modal cae dentro de la ventana',
    !!cajaModal && cajaModal.y >= 0 && cajaModal.x >= 0
    && cajaModal.y + cajaModal.h <= H + 1 && cajaModal.x + cajaModal.w <= W + 1,
    JSON.stringify(cajaModal));

  const guardar = () => js(`[...document.querySelectorAll('.ox-modal__foot .ox-btn')]
             .find(b => b.textContent.trim() === 'Guardar')?.click()`);

  await escribir('#p-nombre', 'GÓMEZ, MARÍA ELENA');
  await escribir('#p-dni', '28123456');

  /* El campo de fecha es propio, no el `type="date"` de Chromium: se tipea
     dd/mm/aaaa y guarda ISO. Una fecha que no existe no puede dar ISO. */
  await escribir('#p-nac', '31/02/1980');
  ok('una fecha inexistente no produce ISO',
    (await js(`document.getElementById('p-nac')?.dataset.iso`)) === ''
    && (await js(`document.getElementById('p-nac')?.classList.contains('is-invalid')`)));
  await escribir('#p-nac', '14/05/1980');
  ok('una fecha real se guarda en ISO',
    (await js(`document.getElementById('p-nac')?.dataset.iso`)) === '1980-05-14');
  ok('el campo de fecha no es un control nativo',
    (await js(`document.getElementById('p-nac')?.type`)) === 'text');

  /* Un CUIL con el dígito verificador mal. Tiene que rebotar, y sobre todo
     tiene que DEVOLVER EL FORMULARIO CON LO TIPEADO: perder doce campos por un
     dígito es la peor manera de validar. */
  await escribir('#p-cuil', '27-28123456-4');
  await guardar();
  await sleep(900);
  ok('el CUIL inválido no guarda', await js(`!!document.querySelector('.ox-modal')`));
  ok('y el formulario vuelve con lo que ya estaba escrito',
    (await js(`document.getElementById('p-nombre')?.value`)) === 'GÓMEZ, MARÍA ELENA'
    && (await js(`document.getElementById('p-dni')?.value`)) === '28123456');

  await escribir('#p-cuil', '27-28123456-6');   // este sí verifica
  await guardar();
  await sleep(1600);

  ok('quedó en la ficha del paciente nuevo',
    await js(`document.querySelector('.ox-viewhead')?.textContent.includes('GÓMEZ')`));
  ok('el rail contó el paciente',
    (await js(`document.getElementById('cuenta-pacientes')?.textContent`)) === '1');

  // La ficha clínica se guarda al salir del campo, sin botón.
  await js(`(() => { const t = document.getElementById('f-alergias');
    t.value = 'Penicilina'; t.dispatchEvent(new Event('input', {bubbles:true}));
    t.dispatchEvent(new Event('blur')); })()`);
  await sleep(1400);
  ok('la alergia se guardó sola y el campo quedó teñido',
    await js(`!!document.querySelector('#f-alergias')
              && document.getElementById('f-alergias').closest('.ox-field').classList.contains('rx-campo-alerta')`));

  /* ── 5. Emitir una receta ─────────────────────────────────────────────── */
  console.log('\n5. Receta');
  await click('#f-receta');
  await sleep(900);
  ok('la vista de receta montó', await js(`!!document.getElementById('r-previa')`));

  /* El segmentado sin cablear deja la cápsula sin medida y tapando el texto de
     las dos opciones. Se ve horrible y ningún test de "¿existe?" lo agarra. */
  const anchoSeg = await js(`(() => {
    const s = document.getElementById('r-plantilla');
    return parseFloat(getComputedStyle(s).getPropertyValue('--seg-w')) || 0; })()`);
  ok('la cápsula del segmentado tiene ancho', anchoSeg > 20, `--seg-w=${anchoSeg}`);
  ok('y el texto de las opciones se lee',
    await js(`document.querySelector('#r-plantilla .ox-segmented__opt')?.textContent.trim()`) === 'Clásica');

  ok('trajo al paciente de la ficha',
    await js(`document.getElementById('r-paciente-txt')?.textContent.includes('GÓMEZ')`));
  ok('muestra la alergia antes de recetar', await js(`!!document.querySelector('#r-alergias .rx-alergias')`));

  await escribir('input[data-campo="nombre"][data-i="0"]', 'Sertralina 50 mg');
  await escribir('input[data-campo="indicaciones"][data-i="0"]', '1 comprimido por día');
  await sleep(400);

  const hojas = await js(`document.querySelectorAll('#r-previa .rx-hoja').length`);
  ok('la previa dibuja original y duplicado', hojas === 2, `hojas=${hojas}`);
  ok('la previa muestra el medicamento tipeado',
    await js(`document.getElementById('r-previa').textContent.includes('Sertralina 50 mg')`));
  ok('la previa marca el duplicado',
    await js(`document.getElementById('r-previa').textContent.includes('Duplicado')`));

  /* La hoja tiene que medir el área imprimible de una A5 con 8mm de margen:
     132mm de ancho. A 96 dpi son 498.9 px. Si esto se corre, lo que se ve en
     pantalla deja de ser lo que sale por la impresora. */
  const anchoHoja = await js(`(() => {
    const h = document.querySelector('#r-previa .rx-hoja');
    if (!h) return 0;
    // getBoundingClientRect ya viene con el zoom aplicado; se lo saca.
    const z = parseFloat(getComputedStyle(h.parentElement).zoom) || 1;
    return h.getBoundingClientRect().width / z; })()`);
  ok('la hoja mide 132 mm de ancho (A5 menos márgenes)',
    Math.abs(anchoHoja - 498.9) < 2, `${anchoHoja.toFixed(1)}px`);

  await click('#r-emitir');
  await sleep(900);
  ok('ofrece imprimir o guardar después de emitir',
    await js(`document.querySelector('.ox-modal')?.textContent.includes('Receta emitida')`));
  await js(`[...document.querySelectorAll('.ox-modal__foot .ox-btn')]
             .find(b => b.textContent.trim() === 'Después')?.click()`);
  await sleep(1200);

  ok('la receta quedó en el historial',
    (await js(`document.querySelectorAll('[data-abrir]').length`)) === 1);
  ok('la statusbar cuenta la receta de hoy',
    (await js(`document.getElementById('stat-hoy')?.textContent`)) === '1');

  /* ── 6. La instantánea manda ──────────────────────────────────────────── */
  console.log('\n6. Instantánea');
  await click('[data-abrir]');
  await sleep(900);
  ok('la receta guardada se puede volver a ver',
    await js(`document.querySelector('.ox-modal')?.textContent.includes('Receta del')`));
  ok('la hoja guardada muestra el medicamento',
    await js(`document.querySelector('.ox-modal .rx-hoja')?.textContent.includes('Sertralina')`));
  await js(`[...document.querySelectorAll('.ox-modal__foot .ox-btn')]
             .find(b => b.textContent.trim() === 'Cerrar')?.click()`);
  await sleep(500);

  /* ── 7. Emitir una orden de estudios ──────────────────────────────────── */
  console.log('\n7. Orden');
  await click('.ox-navitem[data-view="pacientes"]');
  await sleep(700);
  await click('[data-ficha]');
  await sleep(900);
  await click('#f-orden');
  await sleep(900);
  ok('la vista de orden montó', await js(`!!document.getElementById('o-previa')`));
  ok('trajo al paciente de la ficha',
    await js(`document.getElementById('o-paciente-txt')?.textContent.includes('GÓMEZ')`));
  ok('también avisa de la alergia antes de pedir',
    await js(`!!document.querySelector('#o-alergias .rx-alergias')`));

  await escribir('input[data-campo="nombre"][data-i="0"]', 'Hemograma completo');
  await escribir('input[data-campo="aclaracion"][data-i="0"]', 'en ayunas');
  await escribir('#o-diagnostico', 'Astenia');
  await sleep(400);

  /* Lo que separa la orden de la receta en el papel: va UNA hoja y sin sello de
     duplicado. Si alguna vez salen dos, es que se coló el juego de la receta. */
  const hojasOrden = await js(`document.querySelectorAll('#o-previa .rx-hoja').length`);
  ok('la orden se dibuja en una sola hoja', hojasOrden === 1, `hojas=${hojasOrden}`);
  ok('y no lleva sello de duplicado',
    !(await js(`document.getElementById('o-previa').textContent.includes('Duplicado')`)));
  ok('la previa muestra el estudio tipeado',
    await js(`document.getElementById('o-previa').textContent.includes('Hemograma completo')`));
  ok('y lo numera', await js(`!!document.querySelector('#o-previa .estudios li')`));
  ok('el rótulo del panel dice que entra en una hoja',
    (await js(`document.getElementById('o-hojas')?.textContent`)) === 'una hoja');

  await click('#o-emitir');
  await sleep(900);
  ok('ofrece imprimir o guardar después de emitir',
    await js(`document.querySelector('.ox-modal')?.textContent.includes('Orden emitida')`));
  await js(`[...document.querySelectorAll('.ox-modal__foot .ox-btn')]
             .find(b => b.textContent.trim() === 'Después')?.click()`);
  await sleep(1200);

  ok('la orden quedó en el historial',
    (await js(`document.querySelectorAll('[data-abrir]').length`)) === 1);
  ok('el rail cuenta la orden',
    (await js(`document.getElementById('cuenta-ordenes')?.textContent`)) === '1');

  await click('[data-abrir]');
  await sleep(900);
  ok('la orden guardada se puede volver a ver',
    await js(`document.querySelector('.ox-modal')?.textContent.includes('Orden del')`));
  ok('la hoja guardada muestra el estudio',
    await js(`document.querySelector('.ox-modal .rx-hoja')?.textContent.includes('Hemograma')`));
  await js(`[...document.querySelectorAll('.ox-modal__foot .ox-btn')]
             .find(b => b.textContent.trim() === 'Cerrar')?.click()`);
  await sleep(500);

  /* Un pedido largo no entra en la A5 y sigue en una segunda página. La previa
     no lo muestra sola —el papel simplemente se dibuja más alto— así que el
     rótulo lo tiene que decir. Es lo único de esta vista que no se ve mirando. */
  await click('.ox-navitem[data-view="pacientes"]');
  await sleep(700);
  await click('[data-ficha]');
  await sleep(900);
  await click('#f-orden');
  await sleep(900);
  await js(`(() => {
    for (let i = 0; i < 15; i++) {
      if (i) document.getElementById('o-agregar').click();
      const el = document.querySelector('input[data-campo="nombre"][data-i="' + i + '"]');
      el.value = 'Estudio de prueba número ' + (i + 1);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  })()`);
  await sleep(700);
  ok('un pedido largo sigue siendo una sola hoja en el DOM',
    (await js(`document.querySelectorAll('#o-previa .rx-hoja').length`)) === 1);
  ok('pero la previa avisa que no va a entrar',
    (await js(`document.getElementById('o-hojas')?.textContent`) || '').includes('segunda hoja'));

  /* ── 8. Bloqueo ───────────────────────────────────────────────────────── */
  console.log('\n8. Bloqueo');
  await click('#btn-bloquear');
  await sleep(1200);
  ok('vuelve la cerradura', await js(`!document.getElementById('cerradura').hidden`));
  ok('ahora pide contraseña, no crearla', !(await js(`!!document.getElementById('clave2')`)));
  ok('la vista quedó vacía detrás de la cerradura',
    (await js(`document.getElementById('view').children.length`)) === 0);
  ok('no quedó ningún dato de paciente en el DOM',
    !(await js(`document.body.textContent.includes('GÓMEZ')`)));

  await escribir('#clave', 'contrasena-equivocada');
  await click('#enviar');
  await sleep(1500);
  ok('una contraseña equivocada no abre', await js(`!document.getElementById('cerradura').hidden`));

  await escribir('#clave', CLAVE);
  await click('#enviar');
  await sleep(2000);
  ok('la correcta reabre', await js(`document.getElementById('cerradura').hidden`));
  ok('los datos siguen ahí',
    (await js(`document.getElementById('cuenta-pacientes')?.textContent`)) === '1');

  /* ── Cierre ───────────────────────────────────────────────────────────── */
  ok('la consola del renderer no tiró errores', errores.length === 0, errores.slice(0, 4).join(' | '));

  console.log(`\n${pass} bien, ${fail} mal\n`);
  win.destroy();
  try { fs.rmSync(carpeta, { recursive: true, force: true }); } catch { /* Windows */ }
  app.exit(fail ? 1 : 0);
});
