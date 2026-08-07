/* ═══════════════════════════════════════════════════════════════════════════
   El hex de arranque contra los tokens.

   main.cjs tiene que llevar un `backgroundColor` en hex porque Electron no
   entiende oklch, pero el color real vive en tokens.css. Son dos lugares con
   el mismo dato, y eso siempre se desincroniza. Este test lo hace imposible:
   convierte --ox-bg a sRGB con la misma matemática que el navegador y lo
   compara contra el hex de main.cjs.

   Si falla, el síntoma en producción sería un destello del color viejo al
   minimizar y restaurar la ventana — que es exactamente el bug que la app
   está tratando de no tener.
   ═══════════════════════════════════════════════════════════════════════════ */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { oklchToHex, sameColor } from '../tools/oklch.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0; let fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FALLA ${n} ${x}`); } };

console.log('\n1. Los tokens se pueden leer');
const css = fs.readFileSync(path.join(ROOT, 'renderer', 'css', 'tokens.css'), 'utf8');

const hue = Number(css.match(/--ox-hue:\s*([\d.]+)/)?.[1]);
const tint = Number(css.match(/--ox-tint:\s*([\d.]+)/)?.[1]);
ok('--ox-hue está declarado', Number.isFinite(hue), String(hue));
ok('--ox-tint está declarado', Number.isFinite(tint), String(tint));

const bgDecl = css.match(/--ox-bg:\s*oklch\(([\d.]+)%\s*calc\(([\d.]+)\s*\*\s*var\(--ox-tint\)\)\s*var\(--ox-hue\)\)/);
ok('--ox-bg es oklch derivado de las perillas', !!bgDecl, bgDecl ? '' : 'no matcheó el patrón');

console.log('\n2. La familia monoespaciada');
const monoSel = css.match(/--ox-mono:\s*([^;]+)/)?.[1]?.trim();
ok('--ox-mono apunta a un token, no a una familia suelta',
  /^var\(--ox-mono-[a-z0-9-]+\)$/.test(monoSel || ''), String(monoSel));

const declaradas = [...css.matchAll(/--ox-mono-([a-z0-9-]+):/g)].map((m) => m[1]);
const elegida = monoSel?.match(/--ox-mono-([a-z0-9-]+)/)?.[1];
ok(`la elegida ("${elegida}") está declarada`, declaradas.includes(elegida), declaradas.join(', '));
ok('hay más de una opción', declaradas.length >= 2, declaradas.join(', '));

// Un @font-face con la ruta mal puesta NO da error: el navegador cae a la de
// respaldo y todo parece funcionar. La única defensa es mirar el disco.
const fontsCss = fs.readFileSync(path.join(ROOT, 'renderer', 'css', 'fonts.css'), 'utf8');
const urls = [...fontsCss.matchAll(/url\('([^']+)'\)/g)].map((m) => m[1]);
ok('fonts.css declara archivos', urls.length > 0, String(urls.length));
const faltan = urls.filter((u) => !fs.existsSync(path.join(ROOT, 'renderer', 'css', u)));
ok('todos los .woff2 referenciados existen', faltan.length === 0, faltan.join(', '));

// Los pesos que declara el CSS tienen que tener su archivo: si falta el 500, el
// navegador engorda el 400 a mano y en una monoespaciada se nota.
const pesos = [...fontsCss.matchAll(/font-weight:\s*(\d+)/g)].map((m) => m[1]);
ok('declara los pesos 400 y 500', pesos.includes('400') && pesos.includes('500'), [...new Set(pesos)].join(', '));
ok('la licencia viaja con la fuente (OFL lo exige)',
  fs.existsSync(path.join(ROOT, 'renderer', 'fonts', 'Roboto-Mono-LICENSE.txt')));

console.log('\n3. El hex de main.cjs coincide con --ox-bg');
const main = fs.readFileSync(path.join(ROOT, 'main.cjs'), 'utf8');
const bgHex = main.match(/const BG\s*=\s*'(#[0-9a-f]{6})'/i)?.[1]?.toLowerCase();
ok('main.cjs declara BG', !!bgHex, String(bgHex));

if (bgDecl && bgHex) {
  const esperado = oklchToHex(Number(bgDecl[1]) / 100, Number(bgDecl[2]) * tint, hue);
  ok(`BG (${bgHex}) coincide con --ox-bg (${esperado})`, sameColor(bgHex, esperado),
    'corré `node tools/retint.mjs` para volver a sincronizarlos');
}

console.log('\n4. El splash del index.html usa el mismo color');
const html = fs.readFileSync(path.join(ROOT, 'renderer', 'index.html'), 'utf8');
const splashBg = html.match(/#boot-splash\s*\{[^}]*background:\s*(#[0-9a-f]{6})/i)?.[1]?.toLowerCase();
ok('el splash declara un color literal', !!splashBg, String(splashBg));
ok('y es el mismo que el de la ventana', splashBg === bgHex, `${splashBg} vs ${bgHex}`);

console.log('\n5. Ningún archivo del sistema quedó con el prefijo viejo');
// Solo el código que se envía. Los tests quedan afuera a propósito: este mismo
// archivo contiene el patrón que busca, y se encontraría a sí mismo.
const files = [path.join(ROOT, 'main.cjs'), path.join(ROOT, 'preload.cjs')];
(function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'data' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(js|cjs|mjs|css|html)$/.test(e.name)) files.push(p);
  }
}(path.join(ROOT, 'renderer')));
(function walkSrc(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkSrc(p);
    else if (/\.(js|cjs|mjs)$/.test(e.name)) files.push(p);
  }
}(path.join(ROOT, 'src')));
const sucios = files.filter((f) => /(--vc-|\.vc-|"vc-|'vc-)/.test(fs.readFileSync(f, 'utf8')));
ok('sin restos de otro prefijo', sucios.length === 0, sucios.join(', '));

/* ── La marca ────────────────────────────────────────────────────────────────
   El bastón de Asclepio está dibujado en CUATRO archivos: el splash y la
   titlebar (index.html), la cerradura (desbloqueo.js) y el generador del ícono
   (make-icon.cjs). Cambiar uno solo hace que el arranque salte de un dibujo a
   otro, o que el ícono de Windows deje de ser el de la app — y nadie lo nota
   hasta que ya está empaquetada. */
console.log('\n6. La marca es la misma en los cuatro lugares');

const leer = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const entre = (txt, desde, hasta) => {
  const a = txt.indexOf(desde);
  const b = txt.indexOf(hasta, a + 1);
  return a < 0 || b < 0 ? '' : txt.slice(a, b);
};
/** Los trazos y la cabeza de una región, normalizados para poder comparar. */
const marca = (txt) => JSON.stringify({
  trazos: (txt.match(/\sd="([^"]+)"/g) || []).map((s) => s.replace(/\s+/g, ' ').trim()),
  cabeza: (txt.match(/<circle[^>]*>/) || [''])[0].replace(/\s+/g, ' ').trim(),
});

const indice = leer('renderer', 'index.html');
const lugares = {
  splash: entre(indice, 'id="boot-splash"', '<div class="ox-app">'),
  titlebar: entre(indice, 'ox-brand__mark', '</svg>'),
  cerradura: entre(leer('renderer', 'js', 'desbloqueo.js'), 'const MARCA', '</svg>'),
  icono: entre(leer('build', 'make-icon.cjs'), '<div class="placa">', '</div>'),
};

const referencia = marca(lugares.splash);
const trazos = JSON.parse(referencia).trazos.length;
ok('el splash tiene la marca dibujada', trazos === 3, `trazos=${trazos}`);
ok('el splash tiene la cabeza de la serpiente',
  JSON.parse(referencia).cabeza.includes('circle'));

for (const [donde, txt] of Object.entries(lugares)) {
  if (donde === 'splash') continue;
  ok(`"${donde}" dibuja exactamente la misma marca`, marca(txt) === referencia,
    `\n         esperaba ${referencia}\n         encontré ${marca(txt)}`);
}

/* La cabeza es un punto macizo con fill="currentColor". Si el contenedor no
   declara `color`, hereda el del texto y puede quedar invisible. */
/* Se mira una ventana de caracteres y no "hasta la llave que cierra": en
   make-icon.cjs el CSS vive adentro de un template literal y el primer `}` es
   el de un `${...}`, que corta el bloque antes de llegar a la declaración. */
for (const [donde, archivo, selector] of [
  ['splash', 'renderer/index.html', '#boot-splash svg'],
  ['cerradura', 'renderer/css/rx.css', '.rx-cerradura__marca'],
  ['ícono', 'build/make-icon.cjs', '  svg {'],
]) {
  const txt = leer(...archivo.split('/'));
  const i = txt.indexOf(selector);
  const bloque = i < 0 ? '' : txt.slice(i, i + 420);
  ok(`"${donde}" declara color para la cabeza maciza`,
    i >= 0 && /(^|[^-\w])color:/.test(bloque), `en ${archivo} → ${selector}`);
}

console.log(`\n═══ ${pass} ok · ${fail} fallas ═══`);
process.exit(fail ? 1 : 0);
