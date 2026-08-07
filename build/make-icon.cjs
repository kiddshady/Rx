/* ═══════════════════════════════════════════════════════════════════════════
   Genera build/icon.png (1024×1024) desde la marca de la app.

   La marca es la MISMA que pintan el splash, la titlebar
   (renderer/index.html) y la cerradura (renderer/js/desbloqueo.js): el bastón
   de Asclepio. Son CUATRO lugares que tienen que coincidir. Si la cambiás
   allá, corré esto de nuevo:

     npm run icon

   Se renderiza con Electron y no con una librería de imágenes porque Electron
   ya está instalado, y porque así el ícono sale del MISMO motor que dibuja la
   app: lo que se ve en la ventana es lo que queda en el .png.
   ═══════════════════════════════════════════════════════════════════════════ */

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const LADO = 1024;
const SALIDA = path.join(__dirname, 'icon.png');

/* El viewBox es 0 0 16 16, pero el dibujo NO está centrado ahí: el asta sí cae
   en x=8 y por eso engaña, pero la espiral y la cabeza corren la masa para un
   costado. Sin corregirlo el ícono queda pegado a un lado de su placa — el
   tipo de cosa que no se sabe nombrar y se nota al lado de los demás en la
   barra de tareas. Más abajo se mide y se corrige solo.

   En la app NO se corrige: ahí la marca va al lado del nombre, y el asta
   alineada con el resto del chrome se ve mejor que la masa centrada. Acá está
   sola adentro de un cuadrado, así que manda la caja.

   `color` va además de `stroke` porque la cabeza de la serpiente es un punto
   macizo con fill="currentColor". */
const HTML = `<!doctype html>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: ${LADO}px; height: ${LADO}px; background: transparent; }
  .placa {
    width: ${LADO}px; height: ${LADO}px;
    box-sizing: border-box;
    background: #0a0b0d;
    border-radius: ${Math.round(LADO * 0.18)}px;
    display: grid; place-items: center;
  }
  svg { width: ${Math.round(LADO * 0.60)}px; height: ${Math.round(LADO * 0.60)}px;
        stroke: #f2f4f7; color: #f2f4f7; fill: none;
        stroke-width: 1.25; stroke-linecap: round; stroke-linejoin: round; }
</style>
<div class="placa">
  <svg viewBox="0 0 16 16">
    <g id="marca">
      <path d="M8 1.9V7.9"/>
      <path d="M8 9.6V14.1"/>
      <path d="M8.2 13.2A2.8 2.8 0 0 0 6.6 8.2 3 3 0 0 1 9.9 3.5"/>
      <circle cx="9.9" cy="3.5" r=".85" fill="currentColor" stroke="none"/>
    </g>
  </svg>
</div>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: LADO, height: LADO, show: false,
    transparent: true, frame: false, backgroundColor: '#00000000',
    useContentSize: true,
  });

  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(HTML));

  /* Se centra MIDIENDO lo pintado, no con un número a mano. La caja incluye el
     trazo (getBoundingClientRect, no getBBox), que es lo que se ve. Así, si
     mañana se cambia el dibujo, el ícono se recentra solo en vez de quedar
     corrido con un desplazamiento que ya no corresponde. */
  const centrado = await win.webContents.executeJavaScript(`(() => {
    const g = document.getElementById('marca');
    const svg = document.querySelector('svg');
    const a = g.getBoundingClientRect();
    const b = svg.getBoundingClientRect();
    const cx = ((a.left + a.right) / 2 - b.left) / b.width  * 16;
    const cy = ((a.top + a.bottom) / 2 - b.top)  / b.height * 16;
    const dx = 8 - cx, dy = 8 - cy;
    g.setAttribute('transform', 'translate(' + dx.toFixed(3) + ' ' + dy.toFixed(3) + ')');
    return { dx: +dx.toFixed(3), dy: +dy.toFixed(3) };
  })()`);
  console.log(`  centrado: dx=${centrado.dx} dy=${centrado.dy}`);

  await new Promise((r) => setTimeout(r, 700));   // que asiente el layout

  const img = await win.capturePage();
  const { width, height } = img.getSize();
  if (width !== LADO || height !== LADO) {
    console.log(`ABORTADO: la captura salió ${width}×${height}, se esperaba ${LADO}×${LADO}`);
    app.exit(1);
    return;
  }

  fs.mkdirSync(path.dirname(SALIDA), { recursive: true });
  fs.writeFileSync(SALIDA, img.toPNG());
  console.log(`  ${SALIDA}  (${LADO}×${LADO})`);

  win.destroy();
  setTimeout(() => app.exit(0), 150);
});

// Sin esto, destruir la ventana termina el proceso antes de tiempo.
app.on('window-all-closed', () => { });
