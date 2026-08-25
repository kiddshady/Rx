'use strict';

/* Prueba de la capa de datos. Corre bajo Electron porque el llavero usa
   safeStorage y las rutas dependen de `app`:

     npm run test:datos

   Lo que se verifica no es "que la API no tire error" sino que el archivo en
   disco esté realmente cifrado, que una contraseña equivocada NO abra, y que
   una receta emitida quede congelada aunque después cambien los datos vivos. */

const { app } = require('electron');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'rx-test-'));
process.env.RX_DATA = carpeta;

const rutas = require('../src/rutas.cjs');
const llave = require('../src/llave.cjs');
const db = require('../src/db.cjs');

/* Electron sale solo cuando se cierra la última ventana. La prueba del PDF abre
   una y la destruye, así que sin esto el proceso se moría ahí: los tests que
   venían después NO corrían, no se imprimía el resumen, y el exit code era 0.
   Un test que termina antes de tiempo y reporta éxito es peor que uno que
   falla. */
app.on('window-all-closed', () => { });

let pasaron = 0, fallaron = 0;
async function prueba(nombre, fn) {
  try { await fn(); pasaron++; console.log('  OK    ' + nombre); }
  catch (err) { fallaron++; console.log('  FALLA ' + nombre + '\n        ' + (err.message || err)); }
}

app.whenReady().then(async () => {
  console.log('\ndatos — ' + carpeta + '\n');

  const CLAVE_BUENA = 'contrasena-de-prueba';
  const CLAVE_MALA = 'contrasena-equivocada';
  let clave;

  await prueba('configura la contraseña y crea la base', async () => {
    clave = await llave.configurar(CLAVE_BUENA);
    assert.equal(clave.length, 32, 'la clave derivada tiene que ser de 32 bytes');
    db.abrir(clave);
    assert.ok(db.abierta());
  });

  await prueba('rechaza contraseñas cortas', async () => {
    await assert.rejects(() => llave.configurar('corta'), /8 caracteres/);
  });

  await prueba('guarda y relee un paciente', () => {
    const p = db.pacientes.save({
      apellido_nombre: 'GÓMEZ, MARÍA ELENA', dni: '28123456',
      alergias: 'Penicilina', antecedentes: 'HTA',
    });
    assert.ok(p.id);
    const leido = db.pacientes.get(p.id);
    assert.equal(leido.apellido_nombre, 'GÓMEZ, MARÍA ELENA');
    assert.equal(leido.alergias, 'Penicilina');
  });

  await prueba('encuentra al paciente buscando sin acentos', () => {
    assert.equal(db.pacientes.list({ busqueda: 'gomez' }).length, 1, 'buscando "gomez"');
    assert.equal(db.pacientes.list({ busqueda: 'GÓMEZ' }).length, 1, 'buscando "GÓMEZ"');
    assert.equal(db.pacientes.list({ busqueda: '28123' }).length, 1, 'buscando por DNI');
    assert.equal(db.pacientes.list({ busqueda: 'perez' }).length, 0, 'buscando a alguien que no está');
  });

  await prueba('exige apellido y nombre', () => {
    assert.throws(() => db.pacientes.save({ apellido_nombre: '   ' }), /apellido y nombre/);
  });

  await prueba('el archivo en disco está cifrado de verdad', () => {
    const bytes = fs.readFileSync(rutas.base());
    assert.ok(!bytes.subarray(0, 16).toString('latin1').startsWith('SQLite format 3'),
      'la cabecera delata un SQLite sin cifrar');
    assert.ok(!bytes.toString('latin1').includes('GÓMEZ'), 'el apellido se lee en crudo');
    assert.ok(!bytes.toString('latin1').includes('Penicilina'), 'la alergia se lee en crudo');
  });

  await prueba('emite una receta con sus ítems', () => {
    db.medico.save({ apellido_nombre: 'DRA. LOPEZ, ANA', matricula: '12345' });
    const p = db.pacientes.list()[0];
    const r = db.recetas.emitir({
      paciente_id: p.id, fecha: '2026-08-07', plantilla: 'clasica',
      items: [
        { nombre: 'Sertralina 50 mg', envases: 2, indicaciones: '1 comp. por día' },
        { nombre: 'Clonazepam 0,5 mg', envases: 1 },
      ],
    });
    assert.equal(r.items.length, 2);
    assert.equal(r.items[0].nombre, 'Sertralina 50 mg');
    assert.equal(r.items[0].envases, 2);
    assert.equal(r.snapshot.medico.matricula, '12345');
  });

  await prueba('rechaza una receta sin medicamentos', () => {
    const p = db.pacientes.list()[0];
    assert.throws(
      () => db.recetas.emitir({ paciente_id: p.id, fecha: '2026-08-07', items: [] }),
      /al menos un medicamento/);
  });

  /* El tope de dos es legal, no de la hoja. Que la vista apague el botón no
     alcanza: si la regla solo la cumple la interfaz, alcanza con que un camino
     nuevo se olvide. Se prueba del lado que la hace cumplir. */
  await prueba('rechaza una receta con más de 2 medicamentos', () => {
    const p = db.pacientes.list()[0];
    assert.throws(
      () => db.recetas.emitir({
        paciente_id: p.id, fecha: '2026-08-07',
        items: [{ nombre: 'Uno' }, { nombre: 'Dos' }, { nombre: 'Tres' }],
      }),
      /no puede llevar más de 2/);
  });

  await prueba('pero dos sí entran', () => {
    const p = db.pacientes.list()[0];
    const r = db.recetas.emitir({
      paciente_id: p.id, fecha: '2026-08-07',
      items: [{ nombre: 'Uno' }, { nombre: 'Dos' }],
    });
    assert.equal(r.items.length, 2);
    db.recetas.remove(r.id);   // no ensucia el conteo de los tests que siguen
  });

  await prueba('el tope NO se aplica a la orden de estudios', () => {
    const p = db.pacientes.list()[0];
    const o = db.ordenes.emitir({
      paciente_id: p.id, fecha: '2026-08-07',
      items: Array.from({ length: 9 }, (_, i) => ({ nombre: `Estudio ${i + 1}` })),
    });
    assert.equal(o.items.length, 9, 'un pedido de laboratorio largo es normal');
    db.ordenes.remove(o.id);
  });

  await prueba('rechaza una fecha inválida', () => {
    const p = db.pacientes.list()[0];
    assert.throws(
      () => db.recetas.emitir({ paciente_id: p.id, fecha: '7/8/2026', items: [{ nombre: 'X' }] }),
      /fecha .* inválida/);
  });

  await prueba('la receta emitida NO cambia si después cambian los datos vivos', () => {
    const p = db.pacientes.list()[0];
    const antes = db.recetas.list({ pacienteId: p.id })[0];
    db.pacientes.save({ ...db.pacientes.get(p.id), domicilio: 'Calle Nueva 999' });
    db.medico.save({ apellido_nombre: 'DRA. LOPEZ, ANA', matricula: '99999' });
    const r = db.recetas.get(antes.id);
    assert.equal(r.snapshot.medico.matricula, '12345', 'la matrícula impresa cambió sola');
    assert.notEqual(r.snapshot.paciente.domicilio, 'Calle Nueva 999',
      'el domicilio impreso cambió solo');
  });

  await prueba('emite una orden de estudios con sus ítems', () => {
    const p = db.pacientes.list()[0];
    const o = db.ordenes.emitir({
      paciente_id: p.id, fecha: '2026-08-07',
      diagnostico: 'Astenia', observaciones: 'Traer estudios previos',
      items: [
        { nombre: 'Hemograma completo', aclaracion: 'en ayunas' },
        { nombre: 'TSH' },
        { nombre: 'Rx de tórax frente' },
      ],
    });
    assert.equal(o.items.length, 3);
    assert.equal(o.items[0].nombre, 'Hemograma completo');
    assert.equal(o.items[0].aclaracion, 'en ayunas');
    /* El orden en que se pidieron es parte del pedido: la hoja los numera. */
    assert.equal(o.items[2].nombre, 'Rx de tórax frente', 'los estudios salieron desordenados');
    assert.equal(o.diagnostico, 'Astenia');
    assert.ok(o.snapshot.medico, 'la orden se guardó sin instantánea del profesional');
  });

  await prueba('rechaza una orden sin estudios', () => {
    const p = db.pacientes.list()[0];
    assert.throws(
      () => db.ordenes.emitir({ paciente_id: p.id, fecha: '2026-08-07', items: [] }),
      /al menos un estudio/);
  });

  await prueba('pedir del catálogo le suma uso al estudio', () => {
    const p = db.pacientes.list()[0];
    const e = db.estudios.save({ nombre: 'Glucemia', aclaracion: 'ayuno de 8 h' });
    assert.equal(e.usos, 0);
    db.ordenes.emitir({
      paciente_id: p.id, fecha: '2026-08-07',
      items: [{ nombre: e.nombre, aclaracion: e.aclaracion }],
      desdeCatalogo: [e.id],
    });
    assert.equal(db.estudios.list()[0].usos, 1, 'el contador de uso no subió');
  });

  await prueba('la orden emitida NO cambia si después cambian los datos vivos', () => {
    const p = db.pacientes.list()[0];
    const antes = db.ordenes.list({ pacienteId: p.id })[0];
    db.pacientes.save({ ...db.pacientes.get(p.id), cobertura: 'OTRA OBRA SOCIAL' });
    const o = db.ordenes.get(antes.id);
    assert.notEqual(o.snapshot.paciente.cobertura, 'OTRA OBRA SOCIAL',
      'la cobertura impresa cambió sola');
  });

  await prueba('borrar al paciente deja la receta consultable', () => {
    const p = db.pacientes.list()[0];
    const rid = db.recetas.list({ pacienteId: p.id })[0].id;
    db.pacientes.remove(p.id);
    const r = db.recetas.get(rid);
    assert.ok(r, 'la receta desapareció con el paciente');
    assert.equal(r.paciente_id, null, 'la clave foránea tendría que quedar en null');
    assert.equal(r.snapshot.paciente.apellido_nombre, 'GÓMEZ, MARÍA ELENA',
      'la instantánea perdió al paciente');
  });

  await prueba('borrar al paciente deja la orden consultable', () => {
    const o = db.ordenes.list()[0];
    assert.ok(o, 'la orden desapareció con el paciente');
    assert.equal(o.paciente_id, null, 'la clave foránea tendría que quedar en null');
    assert.equal(db.ordenes.get(o.id).snapshot.paciente.apellido_nombre, 'GÓMEZ, MARÍA ELENA',
      'la instantánea perdió al paciente');
  });

  await prueba('la evolución exige un paciente que exista', () => {
    assert.throws(() => db.evoluciones.save({ paciente_id: 'inventado', fecha: '2026-08-07' }),
      /no existe/);
  });

  await prueba('guarda evoluciones y las borra en cascada con el paciente', () => {
    const p = db.pacientes.save({ apellido_nombre: 'PEREZ, JUAN' });
    db.evoluciones.save({ paciente_id: p.id, fecha: '2026-08-01', motivo: 'Control' });
    db.evoluciones.save({ paciente_id: p.id, fecha: '2026-08-05', motivo: 'Seguimiento' });
    assert.equal(db.evoluciones.list(p.id).length, 2);
    assert.equal(db.evoluciones.list(p.id)[0].fecha, '2026-08-05', 'tienen que venir de la más nueva');
    db.pacientes.remove(p.id);
    assert.equal(db.evoluciones.list(p.id).length, 0, 'quedaron evoluciones huérfanas');
  });

  await prueba('una contraseña equivocada NO abre la base', async () => {
    db.cerrar();
    const mala = await llave.derivarGuardada(CLAVE_MALA);
    assert.throws(() => db.abrir(mala), /Contraseña incorrecta/);
  });

  await prueba('la contraseña correcta reabre con los datos intactos', async () => {
    const buena = await llave.derivarGuardada(CLAVE_BUENA);
    db.abrir(buena);
    assert.equal(db.recetas.list().length, 1, 'se perdió la receta');
    assert.equal(db.medico.get().matricula, '99999');
  });

  await prueba('el respaldo se puede volver a abrir con la misma clave', async () => {
    const destino = path.join(carpeta, 'respaldo.db');
    db.respaldar(destino);
    assert.ok(fs.existsSync(destino));
    const bytes = fs.readFileSync(destino);
    assert.ok(!bytes.subarray(0, 16).toString('latin1').startsWith('SQLite format 3'),
      'el respaldo quedó SIN cifrar');
    assert.ok(!bytes.toString('latin1').includes('Sertralina'),
      'el respaldo tiene los medicamentos en crudo');
  });

  await prueba('genera el PDF con las dos hojas', async () => {
    const impresion = require('../src/impresion.cjs');
    const r = db.recetas.list()[0];
    const pdf = await impresion.generarPdf(r.id);

    assert.ok(Buffer.isBuffer(pdf), 'no devolvió un Buffer');
    assert.equal(pdf.subarray(0, 5).toString('latin1'), '%PDF-', 'no tiene la firma de un PDF');
    assert.ok(pdf.length > 3000, `el PDF salió sospechosamente chico (${pdf.length} bytes)`);

    /* Original + duplicado son DOS páginas. Es lo que separa "generó un PDF" de
       "generó la receta": una sola página significa que el salto de página del
       duplicado se perdió, y eso no se ve hasta que sale mal por la impresora. */
    const texto = pdf.toString('latin1');
    const porTipo = (texto.match(/\/Type\s*\/Page[^s]/g) || []).length;
    const porCuenta = /\/Count\s+2\b/.test(texto);
    assert.ok(porTipo === 2 || porCuenta,
      `esperaba 2 páginas; /Type /Page apareció ${porTipo} veces y /Count 2 ${porCuenta ? 'sí' : 'no'} está`);
  });

  await prueba('el PDF de la orden sale en UNA hoja', async () => {
    const impresion = require('../src/impresion.cjs');
    const o = db.ordenes.list()[0];
    const pdf = await impresion.generarPdfOrden(o.id);

    assert.ok(Buffer.isBuffer(pdf), 'no devolvió un Buffer');
    assert.equal(pdf.subarray(0, 5).toString('latin1'), '%PDF-', 'no tiene la firma de un PDF');

    /* La contracara del test de la receta. Acá dos páginas serían el error: la
       orden no tiene duplicado, y si aparece es porque se coló el juego de la
       receta — o porque la lista de estudios se desbordó de la A5. */
    const texto = pdf.toString('latin1');
    const porTipo = (texto.match(/\/Type\s*\/Page[^s]/g) || []).length;
    const porCuenta = /\/Count\s+1\b/.test(texto);
    assert.ok(porTipo === 1 || porCuenta,
      `esperaba 1 página; /Type /Page apareció ${porTipo} veces y /Count 1 ${porCuenta ? 'sí' : 'no'} está`);
  });

  /* La migración es el camino riesgoso de verdad: la base nueva la estrena
     cualquiera que instale hoy, pero la vieja está en la PC de quien ya venía
     usando la app, con las historias clínicas adentro. */
  await prueba('una base del esquema 1 migra sola al abrirla', async () => {
    const Database = require('better-sqlite3-multiple-ciphers');
    const buena = await llave.derivarGuardada(CLAVE_BUENA);
    db.cerrar();

    /* Se la deja como estaba antes de que existiera la orden: sin sus tablas y
       con `user_version` en 1. */
    const cruda = new Database(rutas.base());
    cruda.pragma(`cipher='sqlcipher'`);
    cruda.pragma(`key="x'${buena.toString('hex')}'"`);
    cruda.exec('DROP TABLE orden_item; DROP TABLE orden; DROP TABLE estudio;');
    cruda.pragma('user_version = 1');
    cruda.close();

    db.abrir(buena);
    assert.equal(db.estudios.list().length, 0, 'no se recreó el catálogo de estudios');
    assert.equal(db.ordenes.list().length, 0, 'no se recreó la tabla de órdenes');
    assert.equal(db.recetas.list().length, 1, 'la migración se llevó puestas las recetas');

    /* Y dejó el respaldo antes de tocar nada, que es lo que hace que migrar no
       sea una apuesta. */
    const respaldos = fs.readdirSync(rutas.respaldos()).filter((f) => f.includes('-v1-'));
    assert.ok(respaldos.length > 0, 'migró sin respaldar la base vieja');
  });

  await prueba('cambiar la contraseña recifra: la vieja deja de servir', async () => {
    const nueva = await llave.reconfigurar('contrasena-nueva-2026');
    db.recifrar(nueva);
    db.cerrar();

    const vieja = await llave.derivarGuardada(CLAVE_BUENA);
    assert.throws(() => db.abrir(vieja), /Contraseña incorrecta/,
      'la contraseña vieja todavía abre');

    db.abrir(nueva);
    assert.equal(db.recetas.list().length, 1, 'el recifrado se comió los datos');
  });

  await prueba('recordar en esta PC devuelve la misma clave', async () => {
    const actual = await llave.derivarGuardada('contrasena-nueva-2026');
    const est = await llave.estado();
    if (!est.puedeRecordar) { console.log('        (safeStorage no disponible, se omite)'); return; }
    await llave.recordar(actual);
    assert.ok((await llave.estado()).recordada);
    const recuperada = await llave.recuperarRecordada();
    assert.ok(recuperada && recuperada.equals(actual), 'la clave recordada no coincide');
    await llave.olvidar();
    assert.equal(await llave.recuperarRecordada(), null);
  });

  db.cerrar();
  try { fs.rmSync(carpeta, { recursive: true, force: true }); } catch { /* Windows a veces la tiene tomada */ }

  console.log(`\n${pasaron} bien, ${fallaron} mal\n`);
  /* `app.exit()` mata el proceso sin vaciar stdout. Desde que este archivo abre
     una BrowserWindow para probar el PDF, salir de una se comía el resumen: los
     tests pasaban, el exit code era 0, y por pantalla no se veía el total. */
  setTimeout(() => app.exit(fallaron ? 1 : 0), 200);
});
