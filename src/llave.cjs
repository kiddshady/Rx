'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   Rx — el llavero

   Convierte la contraseña de la doctora en la clave de 32 bytes con la que se
   cifra la base. Tres decisiones que vale la pena entender:

   1) La derivación es scrypt, no PBKDF2. Es dura de memoria, así que una placa
      de video —que es cómo se rompen contraseñas hoy— no puede paralelizar
      barato. Los parámetros van guardados junto a la sal: si mañana se suben,
      las bases viejas se siguen abriendo con los suyos.

   2) NO se guarda ningún hash de la contraseña, ni acá ni en ningún lado. La
      verificación es abrir la base: si la clave está mal, SQLCipher no puede
      descifrar ni la primera página y falla. Un verificador guardado sería un
      blanco para atacar sin tocar los datos; no habiéndolo, no hay nada contra
      qué probar contraseñas más que la base entera.

   3) "Recordar en esta PC" guarda la clave derivada con safeStorage, que en
      Windows es OSCrypt (DPAPI atado a la cuenta de usuario). Eso protege el
      archivo si alguien se lo lleva a otra máquina, pero no si le abren la
      sesión de Windows. Y ojo: si se borra la carpeta de datos de la app, ese
      blob queda ilegible para siempre — por eso perder la clave recordada
      NUNCA puede ser fatal, siempre se puede volver a la contraseña.

   La clave en claro vive solo en el proceso principal, en memoria. Al renderer
   no se le manda nunca: puede pedir "abrí" y "cerrá", no la clave.
   ═══════════════════════════════════════════════════════════════════════════ */

const crypto = require('node:crypto');
const fsp = require('fs/promises');
const path = require('path');
const { safeStorage } = require('electron');
const rutas = require('./rutas.cjs');

/* N=2^17 tarda ~0.4 s en esta clase de máquina. Es a propósito: una demora que
   no se siente al abrir la app una vez por día vuelve carísimo probar millones
   de contraseñas. maxmem tiene que superar 128*N*r o scrypt tira ENOMEM. */
const KDF = { nombre: 'scrypt', N: 1 << 17, r: 8, p: 1, largo: 32 };
const MAXMEM = 256 * 1024 * 1024;

async function leerArchivo() {
  try {
    return JSON.parse(await fsp.readFile(rutas.llave(), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw new Error('El archivo de llave está ilegible: ' + err.message);
  }
}

async function escribirArchivo(obj) {
  await fsp.mkdir(rutas.raiz(), { recursive: true });
  const tmp = `${rutas.llave()}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(obj, null, 2), 'utf8');
  await fsp.rename(tmp, rutas.llave());
}

function derivar(password, salB64, params) {
  const sal = Buffer.from(salB64, 'base64');
  return new Promise((res, rej) => {
    crypto.scrypt(
      Buffer.from(String(password), 'utf8'), sal, params.largo,
      { N: params.N, r: params.r, p: params.p, maxmem: MAXMEM },
      (err, clave) => (err ? rej(err) : res(clave)),
    );
  });
}

/** ¿Ya hay contraseña configurada? ¿Está recordada en esta PC? */
async function estado() {
  const f = await leerArchivo();
  return {
    configurada: !!f?.sal,
    recordada: !!f?.recordada,
    puedeRecordar: safeStorage.isEncryptionAvailable(),
  };
}

/** Primera vez: crea la sal y devuelve la clave con la que se creará la base. */
async function configurar(password) {
  if (!password || String(password).length < 8) {
    throw new Error('La contraseña tiene que tener al menos 8 caracteres.');
  }
  const sal = crypto.randomBytes(16).toString('base64');
  const clave = await derivar(password, sal, KDF);
  await escribirArchivo({ version: 1, kdf: KDF.nombre, N: KDF.N, r: KDF.r, p: KDF.p, sal, recordada: null });
  return clave;
}

/** Deriva la clave de una contraseña usando la sal y los parámetros guardados. */
async function derivarGuardada(password) {
  const f = await leerArchivo();
  if (!f?.sal) throw new Error('Todavía no hay una contraseña configurada.');
  return derivar(password, f.sal, { N: f.N, r: f.r, p: f.p, largo: KDF.largo });
}

/** La clave recordada en esta PC, o null si no hay o si ya no se puede leer. */
async function recuperarRecordada() {
  const f = await leerArchivo();
  if (!f?.recordada) return null;
  if (!safeStorage.isEncryptionAvailable()) return null;
  try {
    const hex = safeStorage.decryptString(Buffer.from(f.recordada, 'base64'));
    const clave = Buffer.from(hex, 'hex');
    return clave.length === KDF.largo ? clave : null;
  } catch {
    /* Blob de otra cuenta de Windows, o userData reconstruido. No es un error
       fatal: se le pide la contraseña y listo. */
    return null;
  }
}

async function recordar(clave) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Windows no tiene disponible el cifrado de credenciales en esta sesión.');
  }
  const f = (await leerArchivo()) || {};
  f.recordada = safeStorage.encryptString(clave.toString('hex')).toString('base64');
  await escribirArchivo(f);
}

async function olvidar() {
  const f = await leerArchivo();
  if (!f) return;
  f.recordada = null;
  await escribirArchivo(f);
}

/** Cambio de contraseña: sal nueva (no se reusa) y clave nueva para el rekey. */
async function reconfigurar(passwordNueva) {
  if (!passwordNueva || String(passwordNueva).length < 8) {
    throw new Error('La contraseña tiene que tener al menos 8 caracteres.');
  }
  const f = (await leerArchivo()) || {};
  const sal = crypto.randomBytes(16).toString('base64');
  const clave = await derivar(passwordNueva, sal, KDF);
  await escribirArchivo({
    ...f, version: 1, kdf: KDF.nombre, N: KDF.N, r: KDF.r, p: KDF.p, sal,
    // La clave recordada quedó vieja: se descarta y se vuelve a pedir.
    recordada: null,
  });
  return clave;
}

module.exports = {
  estado, configurar, derivarGuardada, reconfigurar,
  recuperarRecordada, recordar, olvidar,
};
