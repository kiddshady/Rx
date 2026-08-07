/* Saca capturas de la app con datos de muestra, contra una carpeta temporal.
   No es un test: es para mirar cómo quedó.

     node test/capturas.cjs   →  no; se corre con electron:
     npx electron test/capturas.cjs [carpeta-destino]
*/

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const DESTINO = process.argv[2] || path.join(os.tmpdir(), 'rx-capturas');
const datos = fs.mkdtempSync(path.join(os.tmpdir(), 'rx-demo-'));
process.env.RX_DATA = datos;

const W = 1440; const H = 900;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  fs.mkdirSync(DESTINO, { recursive: true });
  require(path.join(ROOT, 'src', 'ipc.cjs')).register();

  const llave = require(path.join(ROOT, 'src', 'llave.cjs'));
  const db = require(path.join(ROOT, 'src', 'db.cjs'));

  /* Se siembra ANTES de abrir la ventana. La clave NO se recuerda a propósito:
     así la app arranca pidiéndola y la última captura puede mostrar la
     cerradura de verdad, que es la primera pantalla que ve la doctora. */
  const CLAVE = 'demo-para-capturas';
  const clave = await llave.configurar(CLAVE);
  db.abrir(clave);

  db.medico.save({
    apellido_nombre: 'DRA. LÓPEZ, ANA MARÍA', matricula: '14872',
    especialidad: 'Psiquiatría', colegio: 'Colegio de Médicos de Santa Fe, 1ra. Circ.',
    licencia_sanitaria: '541025651468', fecha_vigencia: '2028-03-31',
    domicilio: 'San Martín 1240, Santa Fe', telefono: '342 415-8890',
  });

  const gomez = db.pacientes.save({
    apellido_nombre: 'GÓMEZ, MARÍA ELENA', dni: '28123456', cuil: '27-28123456-6',
    sexo: 'Femenino', nacimiento: '1980-05-14', domicilio: 'Av. Freyre 2210, Santa Fe',
    telefono: '342 500-1122', cobertura: 'OSDE', afiliado: '61-2299887-03',
    alergias: 'Penicilina — rash generalizado (2019). AINEs: dispepsia.',
    antecedentes: 'HTA en tratamiento desde 2021. Madre con diabetes tipo 2.',
    medicacion_habitual: 'Enalapril 10 mg, 1 comprimido por día.',
  });
  db.pacientes.save({
    apellido_nombre: 'ROMERO, JUAN CARLOS', dni: '31998450', cuil: '20-31998450-2',
    sexo: 'Masculino', nacimiento: '1986-11-02', cobertura: 'Particular',
  });
  db.pacientes.save({
    apellido_nombre: 'FERNÁNDEZ, LUCÍA', dni: '40332118', sexo: 'Femenino',
    nacimiento: '1997-08-23', cobertura: 'PAMI', afiliado: '150-88221-00',
  });

  for (const m of [
    { nombre: 'Sertralina 50 mg', marca: 'Zoloft', dosis: '1 comprimido por día', diagnostico: 'F32 — Episodio depresivo', indicaciones: '1 comprimido por la mañana' },
    { nombre: 'Clonazepam 0,5 mg', marca: 'Rivotril', dosis: '1 comprimido por noche', envases: 1 },
    { nombre: 'Enalapril 10 mg', dosis: '1 comprimido por día', diagnostico: 'I10 — Hipertensión esencial' },
    { nombre: 'Quetiapina 25 mg', dosis: '1 comprimido por noche' },
  ]) db.medicamentos.save(m);

  db.evoluciones.save({
    paciente_id: gomez.id, fecha: '2026-06-18', motivo: 'Control de tratamiento',
    notas: 'Refiere mejoría del sueño. Sostiene la adherencia. Se mantiene el esquema.',
    diagnostico: 'F32.1', presion: '130/85', peso: '68 kg',
  });
  db.evoluciones.save({
    paciente_id: gomez.id, fecha: '2026-07-30', motivo: 'Seguimiento',
    notas: 'Ánimo estable. Sin efectos adversos. Se cita en 60 días.',
    presion: '124/80', peso: '67 kg',
  });

  db.recetas.emitir({
    paciente_id: gomez.id, fecha: '2026-07-30', plantilla: 'clasica',
    items: [
      { nombre: 'Sertralina 50 mg', marca: 'Zoloft', dosis: '1 comprimido por día', envases: 2, diagnostico: 'F32 — Episodio depresivo', indicaciones: '1 comprimido por la mañana' },
      { nombre: 'Enalapril 10 mg', dosis: '1 comprimido por día', envases: 1 },
    ],
  });
  db.cerrar();

  const win = new BrowserWindow({
    x: -20000, y: -20000, width: W, height: H,
    frame: false, show: false, paintWhenInitiallyHidden: true, backgroundColor: '#0a0b0d',
    webPreferences: { preload: path.join(ROOT, 'preload.cjs'), contextIsolation: true },
  });
  await win.loadFile(path.join(ROOT, 'renderer', 'index.html'));
  win.show();
  await sleep(2600);

  const js = (c) => win.webContents.executeJavaScript(c);
  const foto = async (nombre) => {
    const img = await win.capturePage();
    const ruta = path.join(DESTINO, nombre + '.png');
    fs.writeFileSync(ruta, img.toPNG());
    console.log('  ' + ruta);
  };

  console.log('\nCapturas:');
  await foto('0-cerradura');

  await js(`(() => {
    const c = document.getElementById('clave');
    c.value = ${JSON.stringify(CLAVE)}; c.dispatchEvent(new Event('input', {bubbles:true}));
    document.getElementById('enviar').click(); })()`);
  await sleep(2600);
  await foto('1-tablero');

  await js(`document.querySelector('.ox-navitem[data-view="pacientes"]').click()`);
  await sleep(700); await foto('2-pacientes');

  // La de GÓMEZ, que es la única con alergias cargadas: es la ficha que muestra
  // el bloque rojo, que es lo que hay que mirar.
  await js(`[...document.querySelectorAll('[data-ficha]')]
             .find(e => e.textContent.includes('GÓMEZ')).click()`);
  await sleep(900); await foto('3-ficha');

  await js(`document.getElementById('f-receta').click()`);
  await sleep(1000);
  await js(`(() => {
    const i = document.querySelector('input[data-campo="nombre"][data-i="0"]');
    i.value = 'Sertralina 50 mg'; i.dispatchEvent(new Event('input', {bubbles:true}));
    const d = document.querySelector('input[data-campo="dosis"][data-i="0"]');
    d.value = '1 comprimido por día'; d.dispatchEvent(new Event('input', {bubbles:true}));
    const n = document.querySelector('input[data-campo="indicaciones"][data-i="0"]');
    n.value = '1 por la mañana, con el desayuno'; n.dispatchEvent(new Event('input', {bubbles:true}));
  })()`);
  await sleep(700); await foto('4-receta');

  await js(`document.querySelector('.ox-navitem[data-view="medicamentos"]').click()`);
  await sleep(700); await foto('5-medicamentos');

  await js(`document.querySelector('.ox-navitem[data-view="ajustes"]').click()`);
  await sleep(700); await foto('6-ajustes');

  await js(`document.querySelector('.ox-navitem[data-view="recetas"]').click()`);
  await sleep(700); await foto('7-recetas');

  win.destroy();
  try { fs.rmSync(datos, { recursive: true, force: true }); } catch { /* Windows */ }
  console.log('');
  app.exit(0);
});
