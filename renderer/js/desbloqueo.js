/* ═══════════════════════════════════════════════════════════════════════════
   Rx — la cerradura

   Lo primero que se ve. Tiene tres caras según el estado de la instalación:

     · primera vez  → crear la contraseña, con el aviso de que no hay
                      recuperación posible (y hay que leerlo, no esconderlo);
     · bloqueada    → pedir la contraseña;
     · recordada    → ni se muestra, se abre sola.

   No valida nada por su cuenta: manda la contraseña al proceso principal y es
   SQLCipher el que dice si sirve. Acá no hay ningún hash contra el cual
   comparar, que es justamente la idea.
   ═══════════════════════════════════════════════════════════════════════════ */

import { Icons } from './icons.js';
import { esc } from './ui.js';

/* La marca vive en CUATRO lugares que tienen que coincidir: el splash y la
   titlebar (renderer/index.html), acá, y build/make-icon.cjs. Si cambiás uno
   solo, el arranque salta de un dibujo a otro. */
const MARCA = '<svg class="rx-cerradura__marca" viewBox="0 0 16 16" aria-hidden="true">'
  + '<path d="M8 1.9V7.9"/>'
  + '<path d="M8 9.6V14.1"/>'
  + '<path d="M8.2 13.2A2.8 2.8 0 0 0 6.6 8.2 3 3 0 0 1 9.9 3.5"/>'
  + '<circle cx="9.9" cy="3.5" r=".85" fill="currentColor" stroke="none"/></svg>';

let host = null;
let mostrando = false;

/** Un `.ox-check` de Onyx, que es un botón y no un input nativo. */
function check(id, etiqueta, marcado) {
  return `<label class="ox-row" style="gap:var(--ox-2);cursor:pointer;align-items:center">
    <button type="button" class="ox-check${marcado ? ' is-on' : ''}" id="${id}"
            role="checkbox" aria-checked="${marcado}">
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.4l3 3 6-6.4"/></svg>
    </button>
    <span style="font-size:var(--ox-fs-13);color:var(--ox-text-2)">${esc(etiqueta)}</span>
  </label>`;
}

function pantallaCrear(estado) {
  return `
    ${MARCA}
    <div class="rx-cerradura__titulo">Rx</div>
    <p class="rx-cerradura__sub">
      Elegí la contraseña que va a proteger la historia clínica de tus pacientes.
    </p>
    <form class="rx-cerradura__form" id="form-cerradura" autocomplete="off">
      <div class="rx-aviso">
        ${Icons.svg('key', 'ox-icon--sm')}
        <div>
          <strong>No hay forma de recuperarla.</strong> Los datos se cifran con esta
          contraseña y nadie —ni esta app, ni yo, ni nadie— puede abrirlos sin ella.
          Si la perdés, perdés los datos. Anotala en un lugar seguro.
        </div>
      </div>
      <div class="ox-field">
        <label class="ox-field__label" for="clave">Contraseña</label>
        <input class="ox-input" type="password" id="clave" minlength="8"
               autocomplete="new-password" spellcheck="false" required>
        <span class="ox-field__hint">Mínimo 8 caracteres.</span>
      </div>
      <div class="ox-field">
        <label class="ox-field__label" for="clave2">Repetila</label>
        <input class="ox-input" type="password" id="clave2"
               autocomplete="new-password" spellcheck="false" required>
      </div>
      ${estado.puedeRecordar ? check('recordar', 'Recordar en esta computadora', false) : ''}
      <div class="rx-cerradura__error" id="error"></div>
      <button class="ox-btn ox-btn--primary ox-flashable" type="submit" id="enviar">
        Crear y entrar
      </button>
    </form>`;
}

function pantallaAbrir(estado, motivo) {
  const sub = motivo === 'inactividad'
    ? 'Se bloqueó sola por inactividad.'
    : 'Ingresá tu contraseña para abrir la historia clínica.';
  return `
    ${MARCA}
    <div class="rx-cerradura__titulo">Rx</div>
    <p class="rx-cerradura__sub">${esc(sub)}</p>
    <form class="rx-cerradura__form" id="form-cerradura" autocomplete="off">
      <div class="ox-field">
        <label class="ox-field__label" for="clave">Contraseña</label>
        <input class="ox-input" type="password" id="clave"
               autocomplete="current-password" spellcheck="false" required>
      </div>
      ${estado.puedeRecordar ? check('recordar', 'Recordar en esta computadora', false) : ''}
      <div class="rx-cerradura__error" id="error"></div>
      <button class="ox-btn ox-btn--primary ox-flashable" type="submit" id="enviar">
        Desbloquear
      </button>
    </form>
    <div class="rx-cerradura__pie">${Icons.svg('lock', 'ox-icon--sm')} Los datos están cifrados en disco</div>`;
}

/**
 * Muestra la cerradura y no resuelve hasta que la sesión quede abierta.
 * @param {{configurada:boolean, puedeRecordar:boolean}} estado
 * @param {string} motivo  por qué se está mostrando ('inicio' | 'manual' | 'inactividad')
 */
export function pedirClave(estado, motivo = 'inicio') {
  host = document.getElementById('cerradura');
  mostrando = true;

  return new Promise((listo) => {
    const crear = !estado.configurada;
    host.innerHTML = `<div class="rx-cerradura__caja">${
      crear ? pantallaCrear(estado) : pantallaAbrir(estado, motivo)}</div>`;
    host.hidden = false;
    Icons.mount(host);

    const form = host.querySelector('#form-cerradura');
    const clave = host.querySelector('#clave');
    const clave2 = host.querySelector('#clave2');
    const recordar = host.querySelector('#recordar');
    const enviar = host.querySelector('#enviar');
    const error = host.querySelector('#error');

    /* El `.ox-check` es un botón: el estado lo lleva la clase, no un input. */
    if (recordar) {
      recordar.addEventListener('click', () => {
        const on = recordar.classList.toggle('is-on');
        recordar.setAttribute('aria-checked', String(on));
      });
    }

    function fallo(msg) {
      error.textContent = msg;
      error.classList.add('is-visible');
      clave.classList.add('is-invalid');
      /* El temblor tiene que poder repetirse: si la clase ya está puesta, el
         navegador no reinicia la animación. Se saca y se fuerza un reflow. */
      const caja = host.querySelector('.rx-cerradura__caja');
      caja.classList.remove('ox-shaking');
      void caja.offsetWidth;
      caja.classList.add('ox-shaking');
      clave.focus();
      clave.select();
    }

    function limpiar() {
      error.classList.remove('is-visible');
      clave.classList.remove('is-invalid');
    }

    clave.addEventListener('input', limpiar);
    clave2?.addEventListener('input', limpiar);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      limpiar();

      const valor = clave.value;
      if (crear) {
        if (valor.length < 8) return fallo('La contraseña necesita al menos 8 caracteres.');
        if (valor !== clave2.value) return fallo('Las dos contraseñas no coinciden.');
      } else if (!valor) {
        return fallo('Escribí tu contraseña.');
      }

      enviar.disabled = true;
      enviar.textContent = crear ? 'Creando…' : 'Abriendo…';
      const quiereRecordar = !!recordar?.classList.contains('is-on');

      try {
        if (crear) await window.rx.sesion.configurar(valor, quiereRecordar);
        else await window.rx.sesion.abrir(valor, quiereRecordar);
        clave.value = '';
        if (clave2) clave2.value = '';
        await cerrar();
        listo(true);
      } catch (err) {
        enviar.disabled = false;
        enviar.textContent = crear ? 'Crear y entrar' : 'Desbloquear';
        fallo(err.message || 'No se pudo abrir.');
      }
    });

    /* Un frame para que el foco no se coma la animación de entrada. */
    requestAnimationFrame(() => clave.focus());
  });
}

/** La saca de pantalla con su animación de salida, no de golpe.

    NO usa `exit()` de motion.js, aunque sea exactamente para esto: `exit()`
    termina con `el.remove()`, y la cerradura tiene que sobrevivir al cierre
    para poder volver a mostrarse cuando la app se bloquee de nuevo. Sacándola
    del DOM, el segundo bloqueo escribía en un nodo huérfano: la sesión se
    cerraba de verdad, pero en pantalla no pasaba nada. */
export function cerrar() {
  if (!host || !mostrando) return Promise.resolve();
  mostrando = false;

  return new Promise((listo) => {
    let terminado = false;
    const terminar = () => {
      if (terminado) return;
      terminado = true;
      clearTimeout(reloj);
      host.removeEventListener('animationend', alAnimar);
      host.hidden = true;
      host.innerHTML = '';
      host.removeAttribute('data-state');
      listo();
    };
    // Solo la animación del propio elemento, no la de sus hijos.
    const alAnimar = (e) => { if (e.target === host) terminar(); };
    host.addEventListener('animationend', alAnimar);
    const reloj = setTimeout(terminar, 500);
    host.dataset.state = 'closing';
  });
}
