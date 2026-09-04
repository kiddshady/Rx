'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   Rx — preload

   La única puerta entre el renderer y el sistema. Lo que no esté acá, el
   renderer no lo puede hacer.

   Lo que NO se expone, y es deliberado: la clave de cifrado. El renderer puede
   pedir "abrí con esta contraseña" y "bloqueá", pero la clave derivada nunca
   cruza el puente. Un XSS en una vista no puede llevarse con qué descifrar la
   base — y en una app que guarda historias clínicas eso importa más que la
   comodidad de tenerla a mano.
   ═══════════════════════════════════════════════════════════════════════════ */

const { contextBridge, ipcRenderer } = require('electron');

/** Desenvuelve {ok,data|error} y convierte el error en una excepción real. */
const call = async (canal, ...args) => {
  const res = await ipcRenderer.invoke(canal, ...args);
  if (!res?.ok) throw new Error(res?.error || `Falló ${canal}`);
  return res.data;
};

/* `onyx` es la API del framework: ventana, ajustes, info. No se renombra —
   es lo que hace que un arreglo del shell se pueda portar entre apps. */
contextBridge.exposeInMainWorld('onyx', {
  info: () => call('app:info'),

  win: {
    minimize: () => ipcRenderer.send('win:minimize'),
    toggleMaximize: () => ipcRenderer.send('win:toggle-maximize'),
    close: () => ipcRenderer.send('win:close'),
    isMaximized: () => ipcRenderer.invoke('win:is-maximized'),
    setBackground: (hex) => ipcRenderer.send('win:set-bg', hex),
    onMaximized: (cb) => {
      const h = (_e, v) => cb(v);
      ipcRenderer.on('win:maximized', h);
      return () => ipcRenderer.off('win:maximized', h);
    },
  },

  settings: {
    get: () => call('settings:get'),
    save: (patch) => call('settings:save', patch),
  },
});

/* `rx` es el dominio: todo lo clínico. */
contextBridge.exposeInMainWorld('rx', {
  sesion: {
    estado: () => call('sesion:estado'),
    configurar: (password, recordar) => call('sesion:configurar', password, !!recordar),
    abrir: (password, recordar) => call('sesion:abrir', password, !!recordar),
    abrirRecordada: () => call('sesion:abrir-recordada'),
    bloquear: () => call('sesion:bloquear'),
    cambiarClave: (actual, nueva) => call('sesion:cambiar-clave', actual, nueva),
    olvidarPC: () => call('sesion:olvidar-pc'),
    /** Le avisa al proceso principal que hubo actividad, para el auto-bloqueo. */
    actividad: () => ipcRenderer.send('sesion:actividad'),
    onBloqueada: (cb) => {
      const h = (_e, motivo) => cb(motivo);
      ipcRenderer.on('sesion:bloqueada', h);
      return () => ipcRenderer.off('sesion:bloqueada', h);
    },
  },

  resumen: () => call('resumen'),

  medico: {
    get: () => call('medico:get'),
    save: (d) => call('medico:save', d),
  },

  pacientes: {
    list: (opts) => call('pacientes:list', opts),
    get: (id) => call('pacientes:get', id),
    save: (d) => call('pacientes:save', d),
    archivar: (id, v) => call('pacientes:archivar', id, v),
    remove: (id) => call('pacientes:remove', id),
  },

  evoluciones: {
    list: (pacienteId) => call('evoluciones:list', pacienteId),
    save: (d) => call('evoluciones:save', d),
    remove: (id) => call('evoluciones:remove', id),
  },

  medicamentos: {
    list: (opts) => call('medicamentos:list', opts),
    save: (d) => call('medicamentos:save', d),
    remove: (id) => call('medicamentos:remove', id),
  },

  estudios: {
    list: (opts) => call('estudios:list', opts),
    save: (d) => call('estudios:save', d),
    remove: (id) => call('estudios:remove', id),
  },

  recetas: {
    emitir: (d) => call('recetas:emitir', d),
    get: (id) => call('recetas:get', id),
    list: (opts) => call('recetas:list', opts),
    remove: (id) => call('recetas:remove', id),
    vaciar: () => call('recetas:vaciar'),
    pdf: (id) => call('recetas:pdf', id),
    imprimir: (id) => call('recetas:imprimir', id),
  },

  ordenes: {
    emitir: (d) => call('ordenes:emitir', d),
    get: (id) => call('ordenes:get', id),
    list: (opts) => call('ordenes:list', opts),
    remove: (id) => call('ordenes:remove', id),
    vaciar: () => call('ordenes:vaciar'),
    pdf: (id) => call('ordenes:pdf', id),
    imprimir: (id) => call('ordenes:imprimir', id),
  },

  respaldo: {
    exportar: () => call('respaldo:exportar'),
    carpeta: () => call('respaldo:carpeta'),
    importarPrototipo: (ruta) => call('migracion:prototipo', ruta ?? null),
  },
});
