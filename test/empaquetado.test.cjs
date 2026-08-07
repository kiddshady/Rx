/* ═══════════════════════════════════════════════════════════════════════════
   Verifica el build empaquetado, no el código fuente.

     npm run build && npm run test:paquete

   Existe porque una app Electron empaquetada se rompe de maneras que en `npm
   run dev` no aparecen nunca: el módulo nativo adentro del asar no carga, el
   renderer queda en pantalla blanca por una ruta que solo resuelve en dev, y
   la carpeta de datos pasa a ser de solo lectura. Nada de eso lo agarra un
   test del fuente.

   Las dos preguntas que contesta:
     1. ¿El .node que se ENVÍA descifra de verdad? (no el de node_modules)
     2. ¿El .exe arranca, abre ventana y puede escribir en su carpeta de datos?
   ═══════════════════════════════════════════════════════════════════════════ */

const { app } = require('electron');
const assert = require('node:assert');
const { spawn, execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

app.on('window-all-closed', () => { });

const RAIZ = path.join(__dirname, '..');
const SALIDA = path.join(RAIZ, 'dist');
const EXE = path.join(SALIDA, 'win-unpacked', 'Rx.exe');
const DESEMPACADO = path.join(SALIDA, 'win-unpacked', 'resources', 'app.asar.unpacked');

let pasaron = 0; let fallaron = 0;
const prueba = async (nombre, fn) => {
  try { await fn(); pasaron++; console.log('  OK    ' + nombre); }
  catch (err) { fallaron++; console.log('  FALLA ' + nombre + '\n        ' + (err.message || err)); }
};
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Evalúa una expresión adentro del renderer de la app EMPAQUETADA, hablando
 * CDP con `--remote-debugging-port`. Node 24 ya trae `fetch` y `WebSocket`, así
 * que no hace falta ninguna dependencia para esto.
 */
async function cdpEvaluar(puerto, expresion) {
  const paginas = await (await fetch(`http://127.0.0.1:${puerto}/json`)).json();
  const pagina = paginas.find((p) => p.type === 'page' && /index\.html/.test(p.url || ''));
  assert.ok(pagina, 'el depurador remoto no ve ninguna página de la app');

  return new Promise((listo, error) => {
    const ws = new WebSocket(pagina.webSocketDebuggerUrl);
    const reloj = setTimeout(() => { ws.close(); error(new Error('el depurador no contestó')); }, 8000);

    ws.onopen = () => ws.send(JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: { expression: expresion, returnByValue: true, awaitPromise: true },
    }));
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id !== 1) return;
      clearTimeout(reloj);
      ws.close();
      if (m.result?.exceptionDetails) {
        return error(new Error(m.result.exceptionDetails.exception?.description
          || m.result.exceptionDetails.text));
      }
      listo(m.result?.result?.value);
    };
    ws.onerror = () => { clearTimeout(reloj); error(new Error('no se pudo hablar con el depurador')); };
  });
}

app.whenReady().then(async () => {
  console.log('\npaquete\n');

  await prueba('el instalador existe y no está vacío', () => {
    const inst = fs.readdirSync(SALIDA).filter((f) => /^Rx-Setup-.*\.exe$/.test(f));
    assert.ok(inst.length === 1, `esperaba un instalador, encontré ${inst.length}`);
    const mb = fs.statSync(path.join(SALIDA, inst[0])).size / 1024 / 1024;
    assert.ok(mb > 40, `el instalador salió sospechosamente chico (${mb.toFixed(1)} MB)`);
  });

  await prueba('el .node quedó FUERA del asar', () => {
    const nodo = path.join(DESEMPACADO, 'node_modules', 'better-sqlite3-multiple-ciphers',
      'build', 'Release', 'better_sqlite3.node');
    assert.ok(fs.existsSync(nodo), 'no está en app.asar.unpacked: adentro del asar no carga');
  });

  /* Esta es la prueba que vale: se carga el módulo TAL COMO SE ENVÍA y se le
     pide que cifre. Que el archivo exista no dice nada — podría ser el binario
     compilado para Node en vez de para Electron, que es exactamente el error
     que se comete al empaquetar y solo se descubre usando la app. */
  await prueba('el módulo que se envía cifra y descifra de verdad', () => {
    const Database = require(path.join(DESEMPACADO, 'node_modules',
      'better-sqlite3-multiple-ciphers'));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rx-paq-'));
    const archivo = path.join(dir, 'p.db');
    const clave = crypto.randomBytes(32).toString('hex');

    const db = new Database(archivo);
    db.pragma(`cipher='sqlcipher'`);
    db.pragma(`key="x'${clave}'"`);
    db.exec('CREATE TABLE p (n TEXT)');
    db.prepare('INSERT INTO p VALUES (?)').run('SECRETO-CLINICO');
    db.close();

    const bytes = fs.readFileSync(archivo);
    assert.ok(!bytes.subarray(0, 16).toString('latin1').startsWith('SQLite format 3'),
      'el archivo NO quedó cifrado');
    assert.ok(!bytes.toString('latin1').includes('SECRETO-CLINICO'),
      'el dato se lee en crudo');

    const db2 = new Database(archivo);
    db2.pragma(`cipher='sqlcipher'`);
    db2.pragma(`key="x'${clave}'"`);
    assert.equal(db2.prepare('SELECT n FROM p').get().n, 'SECRETO-CLINICO');
    db2.close();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* Windows */ }
  });

  /* Arrancar el .exe de verdad. Una app empaquetada que muere al segundo —
     por un módulo que no carga o una ruta que solo existía en dev— igual deja
     el proceso vivo un instante, así que se le da tiempo y se pregunta por la
     VENTANA, no solo por el proceso. */
  let hijo = null;
  const datos = fs.mkdtempSync(path.join(os.tmpdir(), 'rx-paq-datos-'));
  const PUERTO = 9333;

  await prueba('el .exe arranca, abre ventana y escribe en su carpeta de datos', async () => {
    assert.ok(fs.existsSync(EXE), 'no está Rx.exe');
    hijo = spawn(EXE, [`--remote-debugging-port=${PUERTO}`], {
      env: { ...process.env, RX_DATA: datos },
      detached: false, stdio: 'ignore',
    });
    let murio = null;
    hijo.on('exit', (code) => { murio = code; });

    await dormir(9000);
    assert.equal(murio, null, `el proceso se murió solo (código ${murio})`);

    const titulos = execFileSync('powershell', ['-NoProfile', '-Command',
      `Get-Process -Id ${hijo.pid} -ErrorAction SilentlyContinue | ` +
      'Select-Object -ExpandProperty MainWindowTitle'], { encoding: 'utf8' }).trim();
    assert.ok(titulos.includes('Rx'), `la ventana no tiene título "Rx" (vi: "${titulos}")`);

    /* Al moverse a su posición final la ventana guarda su estado: si ese
       archivo aparece, el proceso principal pudo escribir donde le toca. */
    const estado = path.join(datos, 'window.json');
    assert.ok(fs.existsSync(estado),
      'no escribió window.json: la carpeta de datos no es escribible');
    const j = JSON.parse(fs.readFileSync(estado, 'utf8'));
    assert.ok(Number.isFinite(j.width) && j.width > 0, 'window.json salió sin medidas');
  });

  /* El título de la ventana lo pone el <title>, así que se puede tener título
     y pantalla en blanco: alcanza con que el CSS o los módulos ES no resuelvan
     desde adentro del asar, que es exactamente el modo de falla clásico. La
     única forma honesta de descartarlo es mirar el DOM de la app corriendo. */
  await prueba('el renderer empaquetado montó de verdad (no es pantalla en blanco)', async () => {
    const v = await cdpEvaluar(PUERTO, `(() => ({
      splashIdo:  !document.getElementById('boot-splash'),
      cerradura:  !!document.querySelector('.rx-cerradura__caja'),
      visible:    !document.getElementById('cerradura').hidden,
      cssCargado: getComputedStyle(document.documentElement).getPropertyValue('--ox-bg').trim(),
      iconosSVG:  !document.querySelector('i[data-icon]') && !!document.querySelector('svg'),
      boton:      document.getElementById('enviar')?.textContent.trim() || '',
    }))()`);

    assert.ok(v.cssCargado, 'los tokens no cargaron: el CSS no resuelve desde el asar');
    assert.ok(v.splashIdo, 'el splash sigue puesto: app.js no llegó a correr');
    assert.ok(v.cerradura && v.visible, 'la cerradura no se dibujó');
    assert.ok(v.iconosSVG, 'los <i data-icon> no se reemplazaron: los módulos ES no cargaron');
    assert.ok(/Crear y entrar|Desbloquear/.test(v.boton),
      `el botón de la cerradura dice "${v.boton}"`);
  });

  if (hijo && hijo.exitCode === null) { try { hijo.kill(); } catch { /* ya murió */ } }
  await dormir(500);
  try { fs.rmSync(datos, { recursive: true, force: true }); } catch { /* Windows */ }

  console.log(`\n${pasaron} bien, ${fallaron} mal\n`);
  setTimeout(() => app.exit(fallaron ? 1 : 0), 200);
});
