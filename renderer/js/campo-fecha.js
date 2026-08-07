/* ═══════════════════════════════════════════════════════════════════════════
   Rx — campo de fecha

   Existe para no usar `<input type="date">`. Ese control abre el calendario
   NATIVO de Chromium: tipografía del sistema, colores del sistema, y un
   ícono de calendario que no se puede teñir ni sacar. Al lado del resto de la
   app se ve como lo que es, una página web adentro de una ventana.

   Además, para cargar una fecha de nacimiento el calendario es peor: nadie
   quiere retroceder 46 años a flechazos. Se tipea 14051980 y listo.

   El valor que se lee siempre es ISO (`aaaa-mm-dd`), que es como se guarda
   todo en la base. Lo que se ve es dd/mm/aaaa, que es como se escribe acá.
   ═══════════════════════════════════════════════════════════════════════════ */

import { esc } from './ui.js';

/** ISO → dd/mm/aaaa. Lo que no sea ISO vuelve vacío. */
export function deISO(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/**
 * dd/mm/aaaa → ISO, o '' si no es una fecha real.
 * El 31 de febrero se escribe igual de bien que el 28: la única forma de
 * saber si existe es construirla y ver si el Date devolvió lo mismo.
 */
export function aISO(texto) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(texto || '').trim());
  if (!m) return '';
  const dd = Number(m[1]); const mm = Number(m[2]); const aaaa = Number(m[3]);
  const d = new Date(aaaa, mm - 1, dd);
  if (d.getFullYear() !== aaaa || d.getMonth() !== mm - 1 || d.getDate() !== dd) return '';
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/**
 * El HTML de un campo de fecha.
 * @param {{id:string, label:string, valor?:string, hint?:string}} o
 */
export function campoFecha({ id, label, valor = '', hint = '' }) {
  return `<div class="ox-field">
    <label class="ox-field__label" for="${esc(id)}">${esc(label)}</label>
    <input class="ox-input ox-input--mono" id="${esc(id)}" data-fecha
           inputmode="numeric" maxlength="10" spellcheck="false" autocomplete="off"
           placeholder="dd/mm/aaaa" value="${esc(deISO(valor))}"
           data-iso="${esc(valor || '')}">
    ${hint ? `<span class="ox-field__hint">${esc(hint)}</span>` : ''}
  </div>`;
}

/** La fecha en ISO de un campo cableado, o '' si está vacío o incompleto. */
export function isoDe(input) {
  return input?.dataset.iso || '';
}

/**
 * Cablea todos los `[data-fecha]` que haya adentro de `raiz`.
 * @param {Element} raiz
 * @param {(iso:string, input:HTMLInputElement) => void} [onChange]
 */
export function cablearFechas(raiz, onChange) {
  for (const input of raiz.querySelectorAll('input[data-fecha]')) {
    const formatear = () => {
      const alFinal = input.selectionStart === input.value.length;
      const d = input.value.replace(/\D/g, '').slice(0, 8);

      let texto = d;
      if (d.length > 4) texto = `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
      else if (d.length > 2) texto = `${d.slice(0, 2)}/${d.slice(2)}`;

      if (texto !== input.value) {
        const pos = input.selectionStart;
        input.value = texto;
        /* La barra se inserta sola mientras se tipea. Si el cursor estaba al
           final se lo deja al final; si estaba en el medio se lo respeta, o
           cada barra automática lo mandaría al principio. */
        if (alFinal) input.setSelectionRange(texto.length, texto.length);
        else input.setSelectionRange(Math.min(pos, texto.length), Math.min(pos, texto.length));
      }

      const iso = aISO(texto);
      input.dataset.iso = iso;
      // Incompleta no es inválida: recién se marca cuando ya escribió los 8.
      input.classList.toggle('is-invalid', texto.length === 10 && !iso);
      onChange?.(iso, input);
    };

    input.addEventListener('input', formatear);
    input.addEventListener('blur', () => {
      if (!input.value.trim()) {
        input.dataset.iso = '';
        input.classList.remove('is-invalid');
        onChange?.('', input);
      }
    });
  }
}
