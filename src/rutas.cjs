'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   Rx — dónde viven los datos

   En desarrollo, al lado del proyecto (`data/`): se ven, se respaldan y se
   arreglan a mano, que es la convención de Onyx.

   Empaquetada, NO. La carpeta de instalación puede ser de solo lectura
   (Program Files) y además una actualización la reemplaza entera: los datos
   de los pacientes se irían con ella. Ahí van a userData.

   `RX_DATA` manda sobre las dos, para poder correr una copia de prueba contra
   datos falsos sin tocar los de verdad.
   ═══════════════════════════════════════════════════════════════════════════ */

const path = require('path');
const { app } = require('electron');

function raiz() {
  if (process.env.RX_DATA) return process.env.RX_DATA;
  return app.isPackaged ? app.getPath('userData') : path.join(__dirname, '..', 'data');
}

module.exports = {
  raiz,
  /** La base cifrada. Todo el dato clínico vive acá adentro. */
  base: () => path.join(raiz(), 'rx.db'),
  /** Sal y parámetros de derivación. NO es secreto: la sal es pública por diseño. */
  llave: () => path.join(raiz(), 'llave.json'),
  /** Respaldos automáticos antes de cada migración de esquema. */
  respaldos: () => path.join(raiz(), 'respaldos'),
};
