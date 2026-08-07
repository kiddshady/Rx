/* El módulo del documento de impresión.

   Va en un archivo aparte y no como `<script>` inline porque la CSP es
   `script-src 'self'`: un módulo inline queda BLOQUEADO en silencio y lo único
   que se ve del otro lado es que `window.__pintar` nunca aparece. */

import { juego } from './hoja.js';

window.__pintar = async (receta) => {
  document.getElementById('papel').innerHTML = juego(receta);
  /* Sin esto, printToPDF puede disparar mientras la Source Sans todavía no
     terminó de cargar: el texto sale con las métricas de la tipografía de
     respaldo y los renglones caen distinto que en la vista previa. */
  await document.fonts.ready;
  return true;
};
