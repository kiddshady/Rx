/* ═══════════════════════════════════════════════════════════════════════════
   Muestrario de marcas candidatas.

     npx electron build/logos.cjs [salida.png]

   Cada candidata se muestra en la placa grande, a los tamaños REALES a los que
   se va a ver (16, 20, 24, 32) y ampliada por vecino más cercano desde un
   rasterizado de 16 px. Esa última columna es la que decide: renderizar el
   símbolo grande lo re-vectoriza y borra los defectos que después aparecen en
   la titlebar. Un logo se juzga al tamaño al que se usa.
   ═══════════════════════════════════════════════════════════════════════════ */

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const SALIDA = process.argv[2] || path.join(__dirname, 'logos.png');

/* Todas sobre viewBox 0 0 16 16, trazo 1.5, puntas redondeadas, contenido
   entre 1.8 y 14.2 — la misma receta que el resto de los íconos del sistema. */
/* El asta entera de arriba abajo, cortada UNA sola vez donde la serpiente pasa
   por delante; y la serpiente cortada UNA sola vez donde pasa por detrás. Dos
   cruces, o sea una vuelta. Con tres vueltas, a 16 px los huecos miden menos
   que un pixel y todo se funde en un borrón. */
const ASCLEPIO = `
  <path d="M8 1.9V10.4"/>
  <path d="M8 12.2V14.1"/>
  <path d="M11.2 12.7C9.2 12.7 4.9 11.7 4.9 9.6c0-1.6 1.3-2.3 2.3-2.7"/>
  <path d="M8.9 6.4c1.3-.6 2.1-1.4 2.1-2.2"/>
  <circle cx="11" cy="3.3" r=".95" fill="currentColor" stroke="none"/>`;

const CANDIDATAS = [
  {
    id: 'v1-actual',
    nombre: 'v1 · la que está puesta',
    nota: 'En grande el arco de arriba corre pegado al asta y se fusionan en una masa.',
    svg: `
      <path d="M8 1.9V7.3"/>
      <path d="M8 9.1V14.1"/>
      <path d="M8.4 13A2.9 2.9 0 0 0 7.6 7.6 2.4 2.4 0 0 1 9.5 3.7"/>
      <circle cx="9.5" cy="3.7" r=".85" fill="currentColor" stroke="none"/>`,
  },
  {
    id: 'v2-a',
    nombre: 'v2 · lóbulos separados',
    nota: 'Una panza a cada lado, y el asta cortada en las DOS cruces: nada se toca.',
    svg: `
      <path d="M8 1.9V3.5"/>
      <path d="M8 5.1V7.8"/>
      <path d="M8 9.6V14.1"/>
      <path d="M8.2 13.2A2.8 2.8 0 0 1 6.6 8.2 3 3 0 0 0 9.6 3.6"/>
      <circle cx="9.6" cy="3.6" r=".85" fill="currentColor" stroke="none"/>`,
  },
  {
    id: 'v2-b',
    nombre: 'v2 · arcos al revés',
    nota: 'La misma con el sentido invertido, por si el enroscado se lee mejor.',
    svg: `
      <path d="M8 1.9V3.5"/>
      <path d="M8 5.1V7.8"/>
      <path d="M8 9.6V14.1"/>
      <path d="M8.2 13.2A2.8 2.8 0 0 0 6.6 8.2 3 3 0 0 1 9.6 3.6"/>
      <circle cx="9.6" cy="3.6" r=".85" fill="currentColor" stroke="none"/>`,
  },
  {
    id: 'v2-c',
    nombre: 'v2 · un solo corte',
    nota: 'Lóbulos de v2, pero el asta se corta UNA vez. Menos trozos a 16 px.',
    svg: `
      <path d="M8 1.9V7.9"/>
      <path d="M8 9.6V14.1"/>
      <path d="M8.2 13.2A2.8 2.8 0 0 1 6.6 8.2 3 3 0 0 0 9.6 3.6"/>
      <circle cx="9.6" cy="3.6" r=".85" fill="currentColor" stroke="none"/>`,
  },
  {
    id: 'v2-d',
    nombre: 'v2 · un corte, al revés',
    nota: 'Lo mismo con el sentido invertido.',
    svg: `
      <path d="M8 1.9V7.9"/>
      <path d="M8 9.6V14.1"/>
      <path d="M8.2 13.2A2.8 2.8 0 0 0 6.6 8.2 3 3 0 0 1 9.6 3.6"/>
      <circle cx="9.6" cy="3.6" r=".85" fill="currentColor" stroke="none"/>`,
  },
];

const TAMANOS = [16, 20, 24, 32];
const LUPA = 9;          // aumento del rasterizado de 16 px

function svgTexto(d, lado, grosor = 1.5) {
  return `<svg viewBox="0 0 16 16" width="${lado}" height="${lado}"
    fill="none" stroke="#f2f4f7" stroke-width="${grosor}"
    stroke-linecap="round" stroke-linejoin="round"
    xmlns="http://www.w3.org/2000/svg">${d}</svg>`;
}

const filas = CANDIDATAS.map((c) => {
  const g = c.grosor || 1.5;
  return `
  <div class="fila">
    <div class="rotulo">
      <div class="nombre">${c.nombre}</div>
      <div class="nota">${c.nota}</div>
      <div class="id">${c.id}</div>
    </div>
    <div class="placa">${svgTexto(c.svg, 76, g * 0.87)}</div>
    <div class="reales">
      ${TAMANOS.map((t) => `<div class="real"><div class="caja" style="width:${t}px;height:${t}px">${
    svgTexto(c.svg, t, g)}</div><span>${t}</span></div>`).join('')}
    </div>
    <canvas class="lupa" data-svg="${encodeURIComponent(svgTexto(c.svg, 16, g))}"
            width="${16 * LUPA}" height="${16 * LUPA}"></canvas>
  </div>`;
}).join('');

const HTML = `<!doctype html>
<meta charset="utf-8">
<style>
  html, body { margin: 0; background: #0a0b0d; color: #f2f4f7;
               font-family: 'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif; }
  .hoja { padding: 26px 30px; }
  h1 { font-size: 15px; font-weight: 600; letter-spacing: .04em;
       text-transform: uppercase; color: #8b929e; margin: 0 0 20px; }
  .fila { display: grid; grid-template-columns: 210px 110px 1fr 156px;
          align-items: center; gap: 22px; padding: 14px 0;
          box-shadow: inset 0 -1px 0 rgba(255,255,255,.07); }
  .nombre { font-size: 14px; font-weight: 600; }
  .nota { font-size: 11.5px; color: #8b929e; margin-top: 3px; line-height: 1.4; }
  .id { font-size: 11px; color: #5d636e; margin-top: 4px;
        font-family: 'Roboto Mono', Consolas, monospace; }
  .placa { width: 130px; height: 130px; border-radius: 24px; background: #121418;
           display: grid; place-items: center; }
  .reales { display: flex; align-items: flex-end; gap: 24px; }
  .real { display: flex; flex-direction: column; align-items: center; gap: 7px; }
  .real span { font-size: 10.5px; color: #5d636e; }
  .caja { display: grid; place-items: center; }
  .lupa { image-rendering: pixelated; border-radius: 6px; background: #121418; }
</style>
<div class="hoja">
  <h1>Rx — marcas candidatas · la última columna es 16 px ampliado, que es lo que decide</h1>
  ${filas}
</div>
<script>
  // Rasteriza cada SVG a 16×16 y lo agranda sin suavizar: así se ve el ícono
  // como lo va a pintar la titlebar, con sus pixeles reales.
  window.__listo = Promise.all([...document.querySelectorAll('canvas.lupa')].map((c) =>
    new Promise((res) => {
      const img = new Image();
      img.onload = () => {
        const ctx = c.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        const tmp = document.createElement('canvas');
        tmp.width = 16; tmp.height = 16;
        tmp.getContext('2d').drawImage(img, 0, 0, 16, 16);
        ctx.drawImage(tmp, 0, 0, 16, 16, 0, 0, c.width, c.height);
        res();
      };
      img.onerror = () => res();
      img.src = 'data:image/svg+xml;charset=utf-8,' + c.dataset.svg;
    })));
</script>`;

app.on('window-all-closed', () => { });

app.whenReady().then(async () => {
  /* Con la cuenta justa la última fila queda cortada. Y ojo: Windows recorta
     la ventana al alto de la pantalla, así que pedir 1266 px devuelve 1032 y
     las últimas candidatas se pierden sin que nada avise. Si no entran, hay
     que sacar candidatas, no agrandar la ventana. */
  const alto = 130 + CANDIDATAS.length * 172;   // 172 es la fila MEDIDA, no la estimada
  const win = new BrowserWindow({
    width: 1180, height: alto, show: false, frame: false,
    backgroundColor: '#0a0b0d', useContentSize: true,
  });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(HTML));
  await win.webContents.executeJavaScript('window.__listo');
  await new Promise((r) => setTimeout(r, 400));

  const img = await win.capturePage();
  fs.writeFileSync(SALIDA, img.toPNG());
  const { width, height } = img.getSize();
  console.log(`  ${SALIDA}  (${width}×${height})`);
  if (height < alto - 4) {
    console.log(`  OJO: se pidieron ${alto} px de alto y la pantalla dio ${height}.`);
    console.log('       Las últimas candidatas quedaron cortadas.');
  }

  win.destroy();
  setTimeout(() => app.exit(0), 150);
});
