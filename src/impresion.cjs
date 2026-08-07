'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   Rx — imprimir y exportar

   La hoja se pinta en una ventana oculta que carga `renderer/imprimir.html`,
   el MISMO documento y el MISMO módulo de plantilla que usa la vista previa.
   El PDF sale de `printToPDF`, que es el motor de impresión de Chromium: lo
   que se ve es lo que se guarda.

   Todo lo que se imprime sale de `receta.snapshot`, nunca de las tablas vivas.
   Reimprimir una receta de marzo tiene que dar la hoja de marzo.
   ═══════════════════════════════════════════════════════════════════════════ */

const { BrowserWindow, dialog, shell } = require('electron');
const fsp = require('fs/promises');
const path = require('path');
const db = require('./db.cjs');

const DOCUMENTO = path.join(__dirname, '..', 'renderer', 'imprimir.html');

/** Traduce una fila de `receta` a lo que espera la plantilla. */
function datosDeReceta(r) {
  if (!r) throw new Error('Esa receta no existe.');
  const s = r.snapshot || {};
  return {
    paciente: s.paciente || null,
    medico: s.medico || null,
    items: (r.items || []).map((it) => ({
      nombre: it.nombre, marca: it.marca, dosis: it.dosis,
      envases: it.envases, diagnostico: it.diagnostico, indicaciones: it.indicaciones,
    })),
    fecha: r.fecha,
    plantilla: r.plantilla,
    numero: r.numero,
  };
}

/** Nombre de archivo sugerido: receta-apellido-nombre-2026-08-07.pdf */
function nombreSugerido(datos) {
  const quien = String(datos?.paciente?.apellido_nombre || 'paciente')
    .normalize('NFD').replace(new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g'), '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `receta-${quien}-${datos.fecha}.pdf`;
}

/**
 * Abre una ventana oculta con la hoja ya pintada y las tipografías cargadas.
 * Quien la llama es responsable de destruirla.
 */
async function ventanaConHoja(datos) {
  const win = new BrowserWindow({
    show: false,
    width: 620, height: 880,
    backgroundColor: '#ffffff',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });

  try {
    await win.loadFile(DOCUMENTO);
    const json = JSON.stringify(datos).replace(/</g, '\\u003c');

    /* El módulo de la plantilla es `type="module"`, o sea diferido: cuando
       termina de cargar el documento puede no haberse ejecutado todavía. En vez
       de dormir un rato y cruzar los dedos, se espera a que `__pintar` exista. */
    await win.webContents.executeJavaScript(`
      new Promise((listo, error) => {
        const desde = Date.now();
        (function esperar() {
          if (window.__pintar) return listo(window.__pintar(${json}));
          if (Date.now() - desde > 5000) return error(new Error('la plantilla de la hoja no cargó'));
          setTimeout(esperar, 16);
        })();
      })
    `, true);

    return win;
  } catch (err) {
    win.destroy();
    throw err;
  }
}

/**
 * Genera el PDF y devuelve los bytes. Está separado de `aPdf` para que se
 * pueda probar sin que aparezca un diálogo de guardado — si no, la única forma
 * de saber si la impresión anda es abrirla y mirar, que no es una prueba.
 * @returns {Promise<Buffer>}
 */
async function generarPdf(recetaId) {
  const datos = datosDeReceta(db.recetas.get(recetaId));
  const win = await ventanaConHoja(datos);
  try {
    return await win.webContents.printToPDF({
      pageSize: 'A5',
      printBackground: true,
      margins: { marginType: 'none' },  // el margen ya lo pone @page
    });
  } finally {
    win.destroy();
  }
}

/** Exporta la receta a PDF y la abre. */
async function aPdf(padre, recetaId) {
  const datos = datosDeReceta(db.recetas.get(recetaId));
  const pdf = await generarPdf(recetaId);

  const res = await dialog.showSaveDialog(padre, {
    title: 'Guardar la receta como PDF',
    defaultPath: nombreSugerido(datos),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (res.canceled || !res.filePath) return { cancelado: true };

  await fsp.writeFile(res.filePath, pdf);
  shell.openPath(res.filePath);
  return { cancelado: false, ruta: res.filePath };
}

/** Manda la receta a la impresora, con el diálogo del sistema. */
async function aImpresora(recetaId) {
  const datos = datosDeReceta(db.recetas.get(recetaId));
  const win = await ventanaConHoja(datos);
  return new Promise((listo) => {
    win.webContents.print(
      { silent: false, printBackground: true, pageSize: 'A5', margins: { marginType: 'none' } },
      (ok, motivo) => {
        win.destroy();
        // `cancelled` no es un error: es la doctora cerrando el diálogo.
        listo({ cancelado: !ok && /cancel/i.test(String(motivo || '')), ok, motivo: motivo || '' });
      },
    );
  });
}

module.exports = { aPdf, aImpresora, generarPdf, datosDeReceta };
