/* ═══════════════════════════════════════════════════════════════════════════
   Rx — íconos del dominio

   Van acá y no en `icons.js` a propósito: así traerse una versión nueva del set
   base de Onyx no pisa estos. Misma receta que el resto — grilla de 16, trazo
   1.5, contenido entre 1.8 y 14.2, sin `fill` salvo puntos macizos.
   ═══════════════════════════════════════════════════════════════════════════ */

import { Icons } from './icons.js';

Icons.add({
  /* Dos pacientes. El de atrás va incompleto: dice "más de uno" sin competir
     con el de adelante por el peso del trazo. */
  users: '<circle cx="6.2" cy="5.3" r="2.6"/>'
       + '<path d="M1.7 13.6a4.5 4.5 0 0 1 9 0"/>'
       + '<path d="M10.9 3.1a2.6 2.6 0 0 1 0 4.4"/>'
       + '<path d="M12.3 9.6a4.2 4.2 0 0 1 2 3.9"/>',

  /* Cápsula partida al medio. Va DERECHA y no en diagonal: a 16 px la versión
     rotada 45° se lee como un eslabón de cadena, no como una pastilla. */
  pill: '<rect x="1.9" y="5.2" width="12.2" height="5.6" rx="2.8"/>'
      + '<path d="M8 5.2v5.6"/>',

  printer: '<path d="M4.4 6V2.6h7.2V6"/>'
         + '<path d="M4.4 11.6H3.1A1.3 1.3 0 0 1 1.8 10.3V7.3A1.3 1.3 0 0 1 3.1 6h9.8a1.3 1.3 0 0 1 1.3 1.3v3a1.3 1.3 0 0 1-1.3 1.3h-1.3"/>'
         + '<path d="M4.4 9.8h7.2v3.6H4.4z"/>',

  /* Caja de archivo: la tapa separada del cuerpo, y el tirador. */
  archivar: '<rect x="1.9" y="2.4" width="12.2" height="3.2" rx="1.1"/>'
          + '<path d="M3.2 5.6v6.5a1.4 1.4 0 0 0 1.4 1.4h6.8a1.4 1.4 0 0 0 1.4-1.4V5.6"/>'
          + '<path d="M6.5 8.5h3"/>',

  /* Hoja con el pulso: la ficha clínica. */
  ficha: '<path d="M9.2 1.9H5A1.8 1.8 0 0 0 3.2 3.7v8.6A1.8 1.8 0 0 0 5 14.1h6a1.8 1.8 0 0 0 1.8-1.8V5.5z"/>'
       + '<path d="M9.2 1.9v3.6h3.6"/>'
       + '<path d="M5.4 10.4h1.3l.9-1.8 1.1 3 .8-1.2h1.1"/>',

  /* Cruz médica, para el bloque de alergias y advertencias clínicas. */
  cruz: '<path d="M6.4 2.4h3.2v4h4v3.2h-4v4H6.4v-4h-4V6.4h4z"/>',
});
