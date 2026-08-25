'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   Rx — la base cifrada

   SQLite con SQLCipher: el archivo entero está cifrado en reposo, página por
   página. No hay "campos sensibles" cifrados y el resto en claro — en una
   historia clínica el nombre del paciente al lado de un diagnóstico YA es el
   dato sensible, así que se cifra todo o no sirve de nada.

   La clave llega derivada del llavero y se pasa cruda (`x'…'`), sin la
   derivación propia de SQLCipher: la de nosotros ya es scrypt, que es mejor.

   ── La instantánea de la receta ─────────────────────────────────────────────
   Una receta emitida es un documento que ya salió por la impresora. Si mañana
   la paciente se muda, o la doctora renueva la matrícula, la receta de marzo
   TIENE que seguir mostrando lo que decía en marzo. Por eso `receta.snapshot`
   guarda los datos del paciente y del profesional tal como se imprimieron, y
   la reimpresión los lee de ahí y no de las tablas vivas. Las claves foráneas
   quedan solo para poder listar "las recetas de esta paciente".

   La orden de estudios se guarda con exactamente la misma regla: es otro papel
   que ya salió por la impresora, así que también se congela.
   ═══════════════════════════════════════════════════════════════════════════ */

const fs = require('node:fs');
const path = require('path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3-multiple-ciphers');
const rutas = require('./rutas.cjs');

/** @type {import('better-sqlite3-multiple-ciphers').Database | null} */
let db = null;

const ESQUEMA = 2;

function id() { return crypto.randomBytes(8).toString('hex'); }
function ahora() { return new Date().toISOString(); }

/** Texto normalizado para buscar: sin acentos, sin puntuación, en minúsculas.
    SQLite compara ASCII sin distinguir mayúsculas, pero "GÓMEZ" y "gomez" le
    son dos cosas distintas. Se guarda ya normalizado y se busca contra eso. */
/* El rango se arma con códigos y no con un literal: los diacríticos combinantes
   son invisibles en el editor y cualquier reguardado en otra codificación los
   puede corromper sin que se note hasta que "Gómez" deje de aparecer. */
const DIACRITICOS = new RegExp(
  '[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g');

function normalizar(...partes) {
  return partes.filter(Boolean).join(' ')
    .normalize('NFD').replace(DIACRITICOS, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/* ── Apertura ────────────────────────────────────────────────────────────── */

/* Las tablas que trajo el esquema 2: la orden médica de estudios y su catálogo.
   Viven en una constante porque las necesitan DOS caminos —la base que se crea
   de cero y la migración de una que ya existía— y si el DDL se escribiera dos
   veces, el día que uno cambie el otro queda atrás sin que nada se queje.

   `orden_item.posicion` y no `orden`, que es como se llama en `receta_item`:
   acá la tabla padre YA se llama `orden`, y una columna `orden` al lado de
   `orden_id` se lee como si guardara la orden, no el lugar en la lista. */
const ESQUEMA_2 = `
  CREATE TABLE estudio (
    id         TEXT PRIMARY KEY,
    nombre     TEXT NOT NULL,
    aclaracion TEXT NOT NULL DEFAULT '',
    busqueda   TEXT NOT NULL DEFAULT '',
    usos       INTEGER NOT NULL DEFAULT 0,
    creado     TEXT NOT NULL
  );
  CREATE INDEX idx_estudio_uso ON estudio (usos DESC, nombre);

  CREATE TABLE orden (
    id            TEXT PRIMARY KEY,
    paciente_id   TEXT REFERENCES paciente(id) ON DELETE SET NULL,
    fecha         TEXT NOT NULL,
    diagnostico   TEXT NOT NULL DEFAULT '',
    observaciones TEXT NOT NULL DEFAULT '',
    snapshot      TEXT NOT NULL,
    creado        TEXT NOT NULL
  );
  CREATE INDEX idx_orden_paciente ON orden (paciente_id, fecha DESC);
  CREATE INDEX idx_orden_fecha    ON orden (fecha DESC);

  CREATE TABLE orden_item (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    orden_id   TEXT NOT NULL REFERENCES orden(id) ON DELETE CASCADE,
    posicion   INTEGER NOT NULL,
    nombre     TEXT NOT NULL,
    aclaracion TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX idx_item_orden ON orden_item (orden_id, posicion);
`;

function esquemaInicial(conn) {
  conn.exec(`
    CREATE TABLE medico (
      id                 INTEGER PRIMARY KEY CHECK (id = 1),
      apellido_nombre    TEXT NOT NULL DEFAULT '',
      matricula          TEXT NOT NULL DEFAULT '',
      especialidad       TEXT NOT NULL DEFAULT '',
      colegio            TEXT NOT NULL DEFAULT '',
      licencia_sanitaria TEXT NOT NULL DEFAULT '',
      fecha_vigencia     TEXT NOT NULL DEFAULT '',
      domicilio          TEXT NOT NULL DEFAULT '',
      telefono           TEXT NOT NULL DEFAULT ''
    );
    INSERT INTO medico (id) VALUES (1);

    CREATE TABLE paciente (
      id                  TEXT PRIMARY KEY,
      apellido_nombre     TEXT NOT NULL,
      dni                 TEXT NOT NULL DEFAULT '',
      cuil                TEXT NOT NULL DEFAULT '',
      sexo                TEXT NOT NULL DEFAULT '',
      nacimiento          TEXT NOT NULL DEFAULT '',
      domicilio           TEXT NOT NULL DEFAULT '',
      telefono            TEXT NOT NULL DEFAULT '',
      email               TEXT NOT NULL DEFAULT '',
      cobertura           TEXT NOT NULL DEFAULT '',
      afiliado            TEXT NOT NULL DEFAULT '',
      antecedentes        TEXT NOT NULL DEFAULT '',
      alergias            TEXT NOT NULL DEFAULT '',
      medicacion_habitual TEXT NOT NULL DEFAULT '',
      notas               TEXT NOT NULL DEFAULT '',
      busqueda            TEXT NOT NULL DEFAULT '',
      archivado           INTEGER NOT NULL DEFAULT 0,
      creado              TEXT NOT NULL,
      actualizado         TEXT NOT NULL
    );
    CREATE INDEX idx_paciente_busqueda ON paciente (busqueda);
    CREATE INDEX idx_paciente_orden    ON paciente (archivado, apellido_nombre);

    CREATE TABLE evolucion (
      id          TEXT PRIMARY KEY,
      paciente_id TEXT NOT NULL REFERENCES paciente(id) ON DELETE CASCADE,
      fecha       TEXT NOT NULL,
      motivo      TEXT NOT NULL DEFAULT '',
      notas       TEXT NOT NULL DEFAULT '',
      diagnostico TEXT NOT NULL DEFAULT '',
      peso        TEXT NOT NULL DEFAULT '',
      talla       TEXT NOT NULL DEFAULT '',
      presion     TEXT NOT NULL DEFAULT '',
      creado      TEXT NOT NULL,
      actualizado TEXT NOT NULL
    );
    CREATE INDEX idx_evolucion_paciente ON evolucion (paciente_id, fecha DESC);

    CREATE TABLE medicamento (
      id           TEXT PRIMARY KEY,
      nombre       TEXT NOT NULL,
      marca        TEXT NOT NULL DEFAULT '',
      dosis        TEXT NOT NULL DEFAULT '',
      envases      INTEGER NOT NULL DEFAULT 1,
      diagnostico  TEXT NOT NULL DEFAULT '',
      indicaciones TEXT NOT NULL DEFAULT '',
      busqueda     TEXT NOT NULL DEFAULT '',
      usos         INTEGER NOT NULL DEFAULT 0,
      creado       TEXT NOT NULL
    );
    CREATE INDEX idx_medicamento_uso ON medicamento (usos DESC, nombre);

    CREATE TABLE receta (
      id          TEXT PRIMARY KEY,
      paciente_id TEXT REFERENCES paciente(id) ON DELETE SET NULL,
      fecha       TEXT NOT NULL,
      plantilla   TEXT NOT NULL DEFAULT 'clasica',
      numero      TEXT NOT NULL DEFAULT '',
      snapshot    TEXT NOT NULL,
      creado      TEXT NOT NULL
    );
    CREATE INDEX idx_receta_paciente ON receta (paciente_id, fecha DESC);
    CREATE INDEX idx_receta_fecha    ON receta (fecha DESC);

    CREATE TABLE receta_item (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      receta_id    TEXT NOT NULL REFERENCES receta(id) ON DELETE CASCADE,
      orden        INTEGER NOT NULL,
      nombre       TEXT NOT NULL,
      marca        TEXT NOT NULL DEFAULT '',
      dosis        TEXT NOT NULL DEFAULT '',
      envases      INTEGER NOT NULL DEFAULT 1,
      diagnostico  TEXT NOT NULL DEFAULT '',
      indicaciones TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX idx_item_receta ON receta_item (receta_id, orden);
  `);
  conn.exec(ESQUEMA_2);
}

/* Cada entrada lleva el esquema de la versión N-1 a la N. Se corren en cadena
   dentro de una transacción, con un respaldo del archivo antes de empezar. */
const MIGRACIONES = {
  2: (conn) => conn.exec(ESQUEMA_2),
};

function respaldarAntesDeMigrar(version) {
  const origen = rutas.base();
  if (!fs.existsSync(origen)) return;
  fs.mkdirSync(rutas.respaldos(), { recursive: true });
  const sello = new Date().toISOString().replace(/[:.]/g, '-');
  fs.copyFileSync(origen, path.join(rutas.respaldos(), `rx-v${version}-${sello}.db`));
}

function migrar(conn) {
  let version = conn.pragma('user_version', { simple: true });

  if (version === 0) {
    esquemaInicial(conn);
    conn.pragma(`user_version = ${ESQUEMA}`);
    return;
  }
  if (version === ESQUEMA) return;
  if (version > ESQUEMA) {
    throw new Error(
      `Estos datos son de una versión más nueva de Rx (esquema ${version}, esta app entiende ${ESQUEMA}). ` +
      'Actualizá la app antes de abrirlos.',
    );
  }

  respaldarAntesDeMigrar(version);
  const correr = conn.transaction(() => {
    while (version < ESQUEMA) {
      const paso = MIGRACIONES[version + 1];
      if (!paso) throw new Error(`Falta la migración a la versión ${version + 1}.`);
      paso(conn);
      version += 1;
      conn.pragma(`user_version = ${version}`);
    }
  });
  correr();
}

/**
 * Abre (o crea) la base con la clave dada.
 * @param {Buffer} clave 32 bytes derivados por el llavero.
 * @throws si la clave es incorrecta o el archivo no es una base de Rx.
 */
function abrir(clave) {
  if (db) cerrar();
  fs.mkdirSync(rutas.raiz(), { recursive: true });

  const conn = new Database(rutas.base());
  try {
    conn.pragma(`cipher='sqlcipher'`);
    conn.pragma(`key="x'${clave.toString('hex')}'"`);

    /* La prueba de fuego. Hasta acá SQLCipher no descifró nada: los PRAGMA solo
       cargan la clave. Esta lectura toca la primera página, y si la clave está
       mal falla con SQLITE_NOTADB. Es la única verificación de contraseña que
       tiene la app, y es la correcta: no hay nada más barato contra qué probar. */
    conn.prepare('SELECT count(*) AS n FROM sqlite_master').get();

    conn.pragma('journal_mode = WAL');
    conn.pragma('foreign_keys = ON');
    conn.pragma('synchronous = FULL');
    migrar(conn);
  } catch (err) {
    conn.close();
    const msg = String(err?.code || err?.message || err);
    if (/NOTADB|file is not a database|HMAC/i.test(msg)) {
      throw new Error('Contraseña incorrecta.');
    }
    throw err;
  }

  db = conn;
  return true;
}

function cerrar() {
  if (!db) return;
  try { db.close(); } catch { /* ya estaba cerrada */ }
  db = null;
}

function abierta() { return !!db; }

function conexion() {
  if (!db) throw new Error('La base está cerrada. Desbloqueá la app primero.');
  return db;
}

/** Cambia la clave de cifrado del archivo entero, en caliente.

    El rekey reescribe TODAS las páginas, y con WAL activo las que quedaran en
    el diario seguirían cifradas con la clave vieja: SQLCipher directamente se
    niega ("Rekeying is not supported in WAL journal mode"). Se baja a journal
    clásico —lo que fuerza el checkpoint del WAL pendiente—, se recifra, y se
    vuelve a subir. El `finally` importa: si el rekey falla a mitad, la base no
    puede quedarse en modo DELETE sin que nadie la vuelva a WAL. */
function recifrar(claveNueva) {
  const c = conexion();
  c.pragma('journal_mode = DELETE');
  try {
    c.pragma(`rekey="x'${claveNueva.toString('hex')}'"`);
  } finally {
    c.pragma('journal_mode = WAL');
  }
  return true;
}

/** Copia consistente y cifrada con la MISMA clave. Sirve con la base abierta
    y con escrituras en curso, cosa que copiar el archivo a mano no garantiza. */
function respaldar(destino) {
  conexion().prepare('VACUUM INTO ?').run(destino);
  return destino;
}

/* ── Profesional ─────────────────────────────────────────────────────────── */

const medico = {
  get: () => conexion().prepare('SELECT * FROM medico WHERE id = 1').get(),
  save(datos) {
    const campos = ['apellido_nombre', 'matricula', 'especialidad', 'colegio',
      'licencia_sanitaria', 'fecha_vigencia', 'domicilio', 'telefono'];
    const set = campos.map((c) => `${c} = @${c}`).join(', ');
    const fila = Object.fromEntries(campos.map((c) => [c, String(datos?.[c] ?? '')]));
    conexion().prepare(`UPDATE medico SET ${set} WHERE id = 1`).run(fila);
    return medico.get();
  },
};

/* ── Pacientes ───────────────────────────────────────────────────────────── */

const CAMPOS_PACIENTE = ['apellido_nombre', 'dni', 'cuil', 'sexo', 'nacimiento',
  'domicilio', 'telefono', 'email', 'cobertura', 'afiliado',
  'antecedentes', 'alergias', 'medicacion_habitual', 'notas'];

const pacientes = {
  list({ busqueda = '', incluirArchivados = false } = {}) {
    const q = normalizar(busqueda);
    const cond = [incluirArchivados ? '1=1' : 'archivado = 0'];
    if (q) cond.push(`busqueda LIKE '%' || @q || '%'`);
    return conexion().prepare(
      `SELECT id, apellido_nombre, dni, cuil, nacimiento, cobertura, alergias, archivado, actualizado
         FROM paciente WHERE ${cond.join(' AND ')}
        ORDER BY archivado, apellido_nombre COLLATE NOCASE`,
    ).all({ q });
  },

  get(pid) {
    const p = conexion().prepare('SELECT * FROM paciente WHERE id = ?').get(pid);
    if (!p) return null;
    p.recetas = conexion().prepare(
      'SELECT count(*) AS n FROM receta WHERE paciente_id = ?').get(pid).n;
    return p;
  },

  save(datos) {
    const c = conexion();
    const nombre = String(datos?.apellido_nombre || '').trim();
    if (!nombre) throw new Error('El paciente necesita apellido y nombre.');

    const fila = Object.fromEntries(CAMPOS_PACIENTE.map((k) => [k, String(datos?.[k] ?? '').trim()]));
    fila.apellido_nombre = nombre;
    fila.busqueda = normalizar(nombre, fila.dni, fila.cuil, fila.cobertura, fila.afiliado);
    fila.actualizado = ahora();

    if (datos?.id) {
      fila.id = datos.id;
      const set = [...CAMPOS_PACIENTE, 'busqueda', 'actualizado'].map((k) => `${k} = @${k}`).join(', ');
      const r = c.prepare(`UPDATE paciente SET ${set} WHERE id = @id`).run(fila);
      if (r.changes === 0) throw new Error('Ese paciente ya no existe.');
      return pacientes.get(fila.id);
    }

    fila.id = id();
    fila.creado = fila.actualizado;
    const cols = [...CAMPOS_PACIENTE, 'busqueda', 'id', 'creado', 'actualizado'];
    c.prepare(
      `INSERT INTO paciente (${cols.join(', ')}) VALUES (${cols.map((k) => '@' + k).join(', ')})`,
    ).run(fila);
    return pacientes.get(fila.id);
  },

  /** Archivar en vez de borrar: una historia clínica no se tira a la basura
      porque la paciente dejó de venir, y las recetas emitidas la referencian. */
  archivar(pid, valor = true) {
    conexion().prepare('UPDATE paciente SET archivado = ?, actualizado = ? WHERE id = ?')
      .run(valor ? 1 : 0, ahora(), pid);
    return true;
  },

  /** Borrado real. Se lleva evoluciones (cascada) pero deja las recetas
      emitidas, que conservan su instantánea y siguen siendo consultables. */
  remove(pid) {
    conexion().prepare('DELETE FROM paciente WHERE id = ?').run(pid);
    return true;
  },
};

/* ── Evoluciones ─────────────────────────────────────────────────────────── */

const CAMPOS_EVOLUCION = ['fecha', 'motivo', 'notas', 'diagnostico', 'peso', 'talla', 'presion'];

const evoluciones = {
  list(pid) {
    return conexion().prepare(
      'SELECT * FROM evolucion WHERE paciente_id = ? ORDER BY fecha DESC, creado DESC').all(pid);
  },

  save(datos) {
    const c = conexion();
    const pid = datos?.paciente_id;
    if (!pid) throw new Error('La evolución tiene que pertenecer a un paciente.');
    if (!c.prepare('SELECT 1 FROM paciente WHERE id = ?').get(pid)) {
      throw new Error('Ese paciente no existe.');
    }
    const fila = Object.fromEntries(CAMPOS_EVOLUCION.map((k) => [k, String(datos?.[k] ?? '').trim()]));
    if (!fila.fecha) throw new Error('La evolución necesita una fecha.');
    fila.paciente_id = pid;
    fila.actualizado = ahora();

    if (datos?.id) {
      fila.id = datos.id;
      const set = [...CAMPOS_EVOLUCION, 'actualizado'].map((k) => `${k} = @${k}`).join(', ');
      const r = c.prepare(`UPDATE evolucion SET ${set} WHERE id = @id`).run(fila);
      if (r.changes === 0) throw new Error('Esa evolución ya no existe.');
    } else {
      fila.id = id();
      fila.creado = fila.actualizado;
      const cols = [...CAMPOS_EVOLUCION, 'id', 'paciente_id', 'creado', 'actualizado'];
      c.prepare(
        `INSERT INTO evolucion (${cols.join(', ')}) VALUES (${cols.map((k) => '@' + k).join(', ')})`,
      ).run(fila);
    }
    return c.prepare('SELECT * FROM evolucion WHERE id = ?').get(fila.id);
  },

  remove(eid) {
    conexion().prepare('DELETE FROM evolucion WHERE id = ?').run(eid);
    return true;
  },
};

/* ── Catálogo de medicamentos ────────────────────────────────────────────── */

const CAMPOS_MEDICAMENTO = ['nombre', 'marca', 'dosis', 'diagnostico', 'indicaciones'];

const medicamentos = {
  list({ busqueda = '' } = {}) {
    const q = normalizar(busqueda);
    const cond = q ? `WHERE busqueda LIKE '%' || @q || '%'` : '';
    return conexion().prepare(
      `SELECT * FROM medicamento ${cond} ORDER BY usos DESC, nombre COLLATE NOCASE`).all({ q });
  },

  save(datos) {
    const c = conexion();
    const nombre = String(datos?.nombre || '').trim();
    if (!nombre) throw new Error('El medicamento necesita un nombre.');

    const fila = Object.fromEntries(CAMPOS_MEDICAMENTO.map((k) => [k, String(datos?.[k] ?? '').trim()]));
    fila.nombre = nombre;
    fila.envases = Math.max(1, Number(datos?.envases) || 1);
    fila.busqueda = normalizar(nombre, fila.marca, fila.dosis);

    if (datos?.id) {
      fila.id = datos.id;
      const set = [...CAMPOS_MEDICAMENTO, 'envases', 'busqueda'].map((k) => `${k} = @${k}`).join(', ');
      const r = c.prepare(`UPDATE medicamento SET ${set} WHERE id = @id`).run(fila);
      if (r.changes === 0) throw new Error('Ese medicamento ya no existe.');
    } else {
      fila.id = id();
      fila.creado = ahora();
      const cols = [...CAMPOS_MEDICAMENTO, 'envases', 'busqueda', 'id', 'creado'];
      c.prepare(
        `INSERT INTO medicamento (${cols.join(', ')}) VALUES (${cols.map((k) => '@' + k).join(', ')})`,
      ).run(fila);
    }
    return c.prepare('SELECT * FROM medicamento WHERE id = ?').get(fila.id);
  },

  remove(mid) {
    conexion().prepare('DELETE FROM medicamento WHERE id = ?').run(mid);
    return true;
  },
};

/* ── Recetas ─────────────────────────────────────────────────────────────── */

const CAMPOS_ITEM = ['nombre', 'marca', 'dosis', 'diagnostico', 'indicaciones'];

const recetas = {
  /** Emite una receta: la congela con su instantánea y suma uso al catálogo.
      Todo en una transacción — una receta a medio guardar no puede existir. */
  emitir(datos) {
    const c = conexion();
    const pid = datos?.paciente_id;
    const paciente = pid ? c.prepare('SELECT * FROM paciente WHERE id = ?').get(pid) : null;
    if (!paciente) throw new Error('Elegí un paciente antes de emitir la receta.');

    const items = (Array.isArray(datos?.items) ? datos.items : [])
      .map((it) => {
        const fila = Object.fromEntries(CAMPOS_ITEM.map((k) => [k, String(it?.[k] ?? '').trim()]));
        fila.envases = Math.max(1, Number(it?.envases) || 1);
        return fila;
      })
      .filter((it) => it.nombre);
    if (items.length === 0) throw new Error('La receta necesita al menos un medicamento.');

    const fecha = String(datos?.fecha || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new Error('La fecha de la receta es inválida.');

    const prof = medico.get();
    const rid = id();
    const creado = ahora();
    const snapshot = JSON.stringify({ paciente, medico: prof, items, fecha });

    const guardar = c.transaction(() => {
      c.prepare(
        `INSERT INTO receta (id, paciente_id, fecha, plantilla, numero, snapshot, creado)
         VALUES (@id, @paciente_id, @fecha, @plantilla, @numero, @snapshot, @creado)`,
      ).run({
        id: rid, paciente_id: pid, fecha, snapshot, creado,
        plantilla: datos?.plantilla === 'rpe' ? 'rpe' : 'clasica',
        numero: String(datos?.numero ?? '').trim(),
      });

      const insItem = c.prepare(
        `INSERT INTO receta_item (receta_id, orden, nombre, marca, dosis, envases, diagnostico, indicaciones)
         VALUES (@receta_id, @orden, @nombre, @marca, @dosis, @envases, @diagnostico, @indicaciones)`,
      );
      items.forEach((it, i) => insItem.run({ ...it, receta_id: rid, orden: i }));

      /* Sube el contador de uso de los del catálogo que se recetaron, para que
         los frecuentes floten arriba solos en vez de tener que ordenarlos. */
      const subirUso = c.prepare('UPDATE medicamento SET usos = usos + 1 WHERE id = ?');
      for (const mid of new Set((datos?.desdeCatalogo || []).filter(Boolean))) subirUso.run(mid);
    });
    guardar();

    return recetas.get(rid);
  },

  get(rid) {
    const c = conexion();
    const r = c.prepare('SELECT * FROM receta WHERE id = ?').get(rid);
    if (!r) return null;
    r.items = c.prepare('SELECT * FROM receta_item WHERE receta_id = ? ORDER BY orden').all(rid);
    try { r.snapshot = JSON.parse(r.snapshot); } catch { r.snapshot = null; }
    return r;
  },

  list({ pacienteId = null, limite = 200 } = {}) {
    const c = conexion();
    const cond = pacienteId ? 'WHERE r.paciente_id = @pacienteId' : '';
    return c.prepare(
      `SELECT r.id, r.fecha, r.plantilla, r.numero, r.paciente_id,
              p.apellido_nombre AS paciente,
              (SELECT count(*) FROM receta_item i WHERE i.receta_id = r.id) AS items,
              (SELECT group_concat(i.nombre, ' · ') FROM
                 (SELECT nombre FROM receta_item WHERE receta_id = r.id ORDER BY orden) i) AS detalle
         FROM receta r LEFT JOIN paciente p ON p.id = r.paciente_id
         ${cond} ORDER BY r.fecha DESC, r.creado DESC LIMIT @limite`,
    ).all({ pacienteId, limite });
  },

  remove(rid) {
    conexion().prepare('DELETE FROM receta WHERE id = ?').run(rid);
    return true;
  },
};

/* ── Catálogo de estudios ────────────────────────────────────────────────── */

const CAMPOS_ESTUDIO = ['nombre', 'aclaracion'];

const estudios = {
  list({ busqueda = '' } = {}) {
    const q = normalizar(busqueda);
    const cond = q ? `WHERE busqueda LIKE '%' || @q || '%'` : '';
    return conexion().prepare(
      `SELECT * FROM estudio ${cond} ORDER BY usos DESC, nombre COLLATE NOCASE`).all({ q });
  },

  save(datos) {
    const c = conexion();
    const nombre = String(datos?.nombre || '').trim();
    if (!nombre) throw new Error('El estudio necesita un nombre.');

    const fila = Object.fromEntries(CAMPOS_ESTUDIO.map((k) => [k, String(datos?.[k] ?? '').trim()]));
    fila.nombre = nombre;
    fila.busqueda = normalizar(nombre, fila.aclaracion);

    if (datos?.id) {
      fila.id = datos.id;
      const set = [...CAMPOS_ESTUDIO, 'busqueda'].map((k) => `${k} = @${k}`).join(', ');
      const r = c.prepare(`UPDATE estudio SET ${set} WHERE id = @id`).run(fila);
      if (r.changes === 0) throw new Error('Ese estudio ya no existe.');
    } else {
      fila.id = id();
      fila.creado = ahora();
      const cols = [...CAMPOS_ESTUDIO, 'busqueda', 'id', 'creado'];
      c.prepare(
        `INSERT INTO estudio (${cols.join(', ')}) VALUES (${cols.map((k) => '@' + k).join(', ')})`,
      ).run(fila);
    }
    return c.prepare('SELECT * FROM estudio WHERE id = ?').get(fila.id);
  },

  remove(eid) {
    conexion().prepare('DELETE FROM estudio WHERE id = ?').run(eid);
    return true;
  },
};

/* ── Órdenes de estudios ─────────────────────────────────────────────────── */

const ordenes = {
  /** Emite una orden. Misma regla que la receta: se congela con su instantánea
      y todo entra en una transacción — una orden a medio guardar no existe.

      El diagnóstico es UNO para toda la orden y no uno por estudio: en el
      papel, "Dx: dolor abdominal" encabeza el pedido entero, y repetirlo en
      cada renglón sería ruido en una hoja donde el lugar escasea. */
  emitir(datos) {
    const c = conexion();
    const pid = datos?.paciente_id;
    const paciente = pid ? c.prepare('SELECT * FROM paciente WHERE id = ?').get(pid) : null;
    if (!paciente) throw new Error('Elegí un paciente antes de emitir la orden.');

    const items = (Array.isArray(datos?.items) ? datos.items : [])
      .map((it) => ({
        nombre: String(it?.nombre ?? '').trim(),
        aclaracion: String(it?.aclaracion ?? '').trim(),
      }))
      .filter((it) => it.nombre);
    if (items.length === 0) throw new Error('La orden necesita al menos un estudio.');

    const fecha = String(datos?.fecha || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new Error('La fecha de la orden es inválida.');

    const diagnostico = String(datos?.diagnostico ?? '').trim();
    const observaciones = String(datos?.observaciones ?? '').trim();
    const prof = medico.get();
    const oid = id();
    const creado = ahora();
    const snapshot = JSON.stringify({
      paciente, medico: prof, items, fecha, diagnostico, observaciones,
    });

    const guardar = c.transaction(() => {
      c.prepare(
        `INSERT INTO orden (id, paciente_id, fecha, diagnostico, observaciones, snapshot, creado)
         VALUES (@id, @paciente_id, @fecha, @diagnostico, @observaciones, @snapshot, @creado)`,
      ).run({ id: oid, paciente_id: pid, fecha, diagnostico, observaciones, snapshot, creado });

      const insItem = c.prepare(
        `INSERT INTO orden_item (orden_id, posicion, nombre, aclaracion)
         VALUES (@orden_id, @posicion, @nombre, @aclaracion)`,
      );
      items.forEach((it, i) => insItem.run({ ...it, orden_id: oid, posicion: i }));

      /* Igual que con los medicamentos: los estudios que se piden seguido
         flotan solos arriba del catálogo en vez de haber que ordenarlos. */
      const subirUso = c.prepare('UPDATE estudio SET usos = usos + 1 WHERE id = ?');
      for (const eid of new Set((datos?.desdeCatalogo || []).filter(Boolean))) subirUso.run(eid);
    });
    guardar();

    return ordenes.get(oid);
  },

  get(oid) {
    const c = conexion();
    const o = c.prepare('SELECT * FROM orden WHERE id = ?').get(oid);
    if (!o) return null;
    o.items = c.prepare('SELECT * FROM orden_item WHERE orden_id = ? ORDER BY posicion').all(oid);
    try { o.snapshot = JSON.parse(o.snapshot); } catch { o.snapshot = null; }
    return o;
  },

  list({ pacienteId = null, limite = 200 } = {}) {
    const c = conexion();
    const cond = pacienteId ? 'WHERE o.paciente_id = @pacienteId' : '';
    return c.prepare(
      `SELECT o.id, o.fecha, o.diagnostico, o.paciente_id,
              p.apellido_nombre AS paciente,
              (SELECT count(*) FROM orden_item i WHERE i.orden_id = o.id) AS items,
              (SELECT group_concat(i.nombre, ' · ') FROM
                 (SELECT nombre FROM orden_item WHERE orden_id = o.id ORDER BY posicion) i) AS detalle
         FROM orden o LEFT JOIN paciente p ON p.id = o.paciente_id
         ${cond} ORDER BY o.fecha DESC, o.creado DESC LIMIT @limite`,
    ).all({ pacienteId, limite });
  },

  remove(oid) {
    conexion().prepare('DELETE FROM orden WHERE id = ?').run(oid);
    return true;
  },
};

/* ── Resumen para el tablero ─────────────────────────────────────────────── */

function resumen() {
  const c = conexion();
  const hoy = new Date().toISOString().slice(0, 10);
  return {
    pacientes: c.prepare('SELECT count(*) AS n FROM paciente WHERE archivado = 0').get().n,
    recetas: c.prepare('SELECT count(*) AS n FROM receta').get().n,
    recetasHoy: c.prepare('SELECT count(*) AS n FROM receta WHERE fecha = ?').get(hoy).n,
    ordenes: c.prepare('SELECT count(*) AS n FROM orden').get().n,
    evoluciones: c.prepare('SELECT count(*) AS n FROM evolucion').get().n,
    ultimasRecetas: recetas.list({ limite: 6 }),
  };
}

module.exports = {
  abrir, cerrar, abierta, recifrar, respaldar, normalizar,
  medico, pacientes, evoluciones, medicamentos, recetas, estudios, ordenes, resumen,
  ESQUEMA,
};
