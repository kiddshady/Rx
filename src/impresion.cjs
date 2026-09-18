'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   Rx — imprimir y exportar

   La hoja se pinta en una ventana oculta que carga `renderer/imprimir.html`,
   el MISMO documento y el MISMO módulo de plantilla que usa la vista previa.
   El PDF sale de `printToPDF`, que es el motor de impresión de Chromium: lo
   que se ve es lo que se guarda.

   Todo lo que se imprime sale del `snapshot`, nunca de las tablas vivas.
   Reimprimir una receta de marzo tiene que dar la hoja de marzo.

   Hay dos documentos —la receta y la orden de estudios— y de acá para abajo
   son el mismo trámite: traducir la fila a la forma que espera la plantilla y
   mandarla a la ventana. Lo único que cambia es de qué tabla salen y cuántas
   hojas imprime cada uno, y eso lo decide `juego()` en la plantilla. Por eso
   el circuito de impresión no se duplicó: se le pasa el dato ya traducido.
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
    tipo: 'receta',
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

/** Traduce una fila de `orden` a lo que espera la plantilla. */
function datosDeOrden(o) {
  if (!o) throw new Error('Esa orden no existe.');
  const s = o.snapshot || {};
  return {
    tipo: 'orden',
    paciente: s.paciente || null,
    medico: s.medico || null,
    items: (o.items || []).map((it) => ({ nombre: it.nombre, aclaracion: it.aclaracion })),
    fecha: o.fecha,
    diagnostico: o.diagnostico,
  };
}

/** Cómo se llama el documento en un diálogo o en un nombre de archivo. */
function esOrden(datos) { return datos?.tipo === 'orden'; }

/** Nombre sugerido: receta-apellido-nombre-2026-08-07.pdf (u orden-…). */
function nombreSugerido(datos) {
  const quien = String(datos?.paciente?.apellido_nombre || 'paciente')
    .normalize('NFD').replace(new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g'), '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${esOrden(datos) ? 'orden' : 'receta'}-${quien}-${datos.fecha}.pdf`;
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
 * Genera el PDF de un documento ya traducido y devuelve los bytes. Está
 * separado del guardado para que se pueda probar sin que aparezca un diálogo
 * — si no, la única forma de saber si la impresión anda es abrirla y mirar,
 * que no es una prueba.
 * @returns {Promise<Buffer>}
 */
async function pdfDe(datos) {
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

/** Pide dónde guardar, escribe el PDF y lo abre. */
async function guardarPdf(padre, datos) {
  const pdf = await pdfDe(datos);

  const res = await dialog.showSaveDialog(padre, {
    title: esOrden(datos) ? 'Guardar la orden como PDF' : 'Guardar la receta como PDF',
    defaultPath: nombreSugerido(datos),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (res.canceled || !res.filePath) return { cancelado: true };

  await fsp.writeFile(res.filePath, pdf);
  shell.openPath(res.filePath);
  return { cancelado: false, ruta: res.filePath };
}

/** Manda el documento a la impresora, con el diálogo del sistema. */
async function mandarAImpresora(datos) {
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

/* ── Por documento ───────────────────────────────────────────────────────── */

const generarPdf = (recetaId) => pdfDe(datosDeReceta(db.recetas.get(recetaId)));
const aPdf = (padre, recetaId) => guardarPdf(padre, datosDeReceta(db.recetas.get(recetaId)));
const aImpresora = (recetaId) => mandarAImpresora(datosDeReceta(db.recetas.get(recetaId)));

const generarPdfOrden = (ordenId) => pdfDe(datosDeOrden(db.ordenes.get(ordenId)));
const aPdfOrden = (padre, ordenId) => guardarPdf(padre, datosDeOrden(db.ordenes.get(ordenId)));
const aImpresoraOrden = (ordenId) => mandarAImpresora(datosDeOrden(db.ordenes.get(ordenId)));

module.exports = {
  aPdf, aImpresora, generarPdf, datosDeReceta,
  aPdfOrden, aImpresoraOrden, generarPdfOrden, datosDeOrden,
};
