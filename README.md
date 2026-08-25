# Rx

Historia clínica, recetas y órdenes de estudios para consultorio. App de
escritorio, un solo profesional, datos **cifrados en disco**, y lo que sale
impreso se firma **a mano** sobre el papel: no hay firma electrónica ni nada
que dependa de un servicio de nadie.

Construida sobre [Onyx](../../..\tools\Onyx). Todo lo que dice el README de Onyx
sobre el shell, los tokens y el anti-flash vale acá; esto documenta lo que Rx
agrega encima.

```
npm run dev            # con la consola del renderer saliendo por la terminal
npm test               # tokens, almacenamiento y formato (node pelado)
npm run test:datos     # la base cifrada de punta a punta (necesita Electron)
npm run humo           # monta la app, la desbloquea y la recorre entera

npm run icon           # regenera build/icon.png desde la marca
npm run build          # instalador NSIS en dist/
npm run test:paquete   # verifica el build: el .exe de verdad, no el fuente
```

---

## Lo que protege, y lo que no

La base entera está cifrada con **SQLCipher**: página por página, no "los
campos sensibles". En una historia clínica el nombre del paciente al lado de un
diagnóstico ya *es* el dato sensible, así que se cifra todo o no sirve de nada.

La clave sale de la contraseña por **scrypt** (N=2¹⁷), no de la derivación
propia de SQLCipher: scrypt es duro de memoria, así que una placa de video no
puede paralelizar barato. A SQLCipher se le pasa la clave ya derivada, cruda.

**No se guarda ningún hash de la contraseña.** La verificación es abrir la
base: si la clave está mal, SQLCipher no descifra ni la primera página. Un
verificador guardado sería un blanco contra el cual probar contraseñas sin
tocar los datos; no habiéndolo, no hay nada más barato que atacar.

La clave en claro vive **solo en el proceso principal**. Al renderer no se le
manda nunca: puede pedir "abrí" y "bloqueá", no la clave. Un XSS en una vista
no se puede llevar con qué descifrar.

Qué **no** cubre, dicho claro:

- Si alguien tiene la sesión de Windows abierta y "recordar en esta PC" está
  marcado, entra. Eso es exactamente lo que esa opción compra: comodidad a
  cambio de dejar la llave atada a la cuenta de Windows.
- Si se pierde la contraseña, se perdieron los datos. No hay recuperación y no
  puede haberla: es lo que significa que esté cifrado. La cerradura lo dice con
  todas las letras al crearla.
- La app no defiende contra alguien con acceso físico y tiempo mientras está
  desbloqueada. Para eso está el bloqueo por inactividad (15 min por defecto).

`llave.json` guarda la sal y los parámetros de derivación. **No es secreto** —
la sal es pública por diseño, existe para que dos instalaciones con la misma
contraseña no den la misma clave.

---

## El mapa

```
src/
  rutas.cjs       Dónde viven los datos: data/ en dev, userData empaquetada.
  llave.cjs       scrypt, safeStorage, cambio de contraseña.
  db.cjs          La base cifrada: esquema, migraciones y consultas.
  impresion.cjs   printToPDF y la impresora, sobre una ventana oculta.
  ipc.cjs         Qué puede pedir el renderer. TODO pasa por conBase().
  store.cjs       JSON en claro: SOLO preferencias de la interfaz.
renderer/
  index.html      Shell + la cerradura.
  imprimir.html   El documento que se imprime. Sin nada inline (ver CSP).
  css/hoja.css    Las hojas. Las cargan la app Y la impresión.
  js/
    hoja.js       Las plantillas: clásica, RPE y orden. Las usan las dos.
    desbloqueo.js La cerradura.
    campo-fecha.js Campo de fecha propio, sin el <input type=date> de Chromium.
    tienda.js     Estado compartido y validadores (DNI, CUIL).
    vistas/       Tablero, pacientes, recetas, órdenes, medicamentos,
                  estudios, ajustes.
```

---

## Las decisiones que no son obvias

### La receta emitida se congela

`receta.snapshot` guarda los datos del paciente y del profesional **tal como se
imprimieron**. Si mañana la paciente se muda o la doctora renueva la matrícula,
la receta de marzo tiene que seguir diciendo lo que decía en marzo — es un
documento que ya salió por la impresora. Las claves foráneas quedan solo para
poder listar "las recetas de esta paciente"; borrar al paciente no se lleva sus
recetas, que siguen siendo consultables.

### Una sola plantilla, dos consumidores

`renderer/js/hoja.js` y `renderer/css/hoja.css` los cargan la vista previa y la
ventana de impresión. A propósito: que la previa y el papel se vean distinto es
*el* bug clásico de estas apps, y la única forma segura de evitarlo es que no
existan dos hojas que puedan desincronizarse. `.rx-hoja` mide exactamente el
área imprimible de una A5 con 8 mm de margen (132 × 194 mm), y hay un test que
lo verifica en píxeles.

### La orden de estudios es la receta con otro cuerpo

Mismo circuito completo: paciente, hoja en vivo al lado, emitir, congelar la
instantánea, salir a papel o a PDF, y quedar en el historial y en la ficha. Lo
que cambia es el medio de la hoja —el listado numerado de estudios en vez del
`Rp./`— y que sale en **una** sola hoja: el duplicado de la receta existe
porque se lo queda la farmacia, y la orden se la queda el laboratorio y listo.

Por eso comparte de verdad, no "parecido": el encabezado del paciente y el pie
de firma son las mismas funciones de `hoja.js`, y las reglas de CSS que hereda
llevan el selector duplicado en vez del valor copiado. Dos copias del mismo
milímetro se desincronizan el día que una se toca — y acá eso significa dos
papeles que se ven distinto.

El diagnóstico va **uno** para toda la orden y no uno por estudio: en el papel
encabeza el pedido entero, y repetirlo en cada renglón sería ruido en una hoja
donde el lugar escasea.

### Un pedido largo no entra, y la previa lo dice

La A5 aguanta unos catorce estudios. Pasado eso la hoja sigue en una segunda
página, y eso es lo único que la vista previa **no** muestra sola: el papel
simplemente se dibuja más alto y no se nota hasta que ya salió por la
impresora. El rótulo del panel lo avisa, midiendo el alto contra el ancho del
mismo elemento (132 × 194 mm) para que el zoom de la previa se cancele solo en
vez de tener que compensarlo a mano.

No va en rojo: que un pedido largo ocupe dos hojas es un dato, no una falla. El
rojo de esta app está reservado al fallo y a la advertencia clínica.

### El recifrado tiene que bajar el WAL

SQLCipher se niega a recifrar con WAL activo ("Rekeying is not supported in WAL
journal mode"): el rekey reescribe todas las páginas y las que quedaran en el
diario seguirían con la clave vieja. `recifrar()` baja a journal clásico, hace
el rekey, y vuelve a subir — con `finally`, porque si el rekey falla la base no
puede quedarse en modo DELETE.

### `imprimir.html` no tiene nada inline

Su CSP es `script-src 'self'`, así que un `<script type="module">` inline queda
**bloqueado en silencio**: desde afuera lo único que se ve es que
`window.__pintar` nunca aparece y la hoja sale en blanco. El JS y el CSS de esa
página viven en sus propios archivos. Lo mismo vale para el `<style>`.

### Nada de `<input type="date">`

Abre el calendario nativo de Chromium: tipografía del sistema, colores del
sistema, y un ícono que no se puede teñir. Además es peor para cargar una fecha
de nacimiento — nadie quiere retroceder 46 años a flechazos. `campo-fecha.js`
formatea dd/mm/aaaa mientras se tipea y guarda ISO.

### La cerradura no se saca del DOM

`exit()` de `motion.js` termina con `el.remove()`. La cerradura tiene que
sobrevivir al cierre para poder volver a mostrarse cuando la app se bloquee de
nuevo, así que anima su salida a mano. Con `exit()`, el segundo bloqueo
escribía en un nodo huérfano: la sesión se cerraba de verdad, pero en pantalla
no pasaba nada.

### Los contadores se rehacen en cada navegación

Dejar que los actualice quien muta los datos parece más eficiente y es una
fuente inagotable de cifras viejas: alcanza con que un camino nuevo se olvide
de avisar. Son cuatro `count(*)` sobre una base local.

---

## Los tests

`npm run test:datos` es el que importa. No verifica "que la API no tire error"
sino:

- que el archivo en disco **esté realmente cifrado** (la cabecera no es
  `SQLite format 3`, y ni el apellido ni la alergia aparecen en crudo);
- que una contraseña equivocada **no** abra;
- que la receta y la orden emitidas no cambien cuando cambian los datos vivos;
- que el respaldo salga cifrado y se pueda reabrir;
- que cambiar la contraseña recifre y la vieja deje de servir;
- que el PDF de la receta tenga **dos** páginas (original y duplicado) y el de
  la orden **una** sola;
- que una base del esquema 1 **migre sola** al abrirla, y que respalde antes de
  tocar nada. Es el camino riesgoso de verdad: la base nueva la estrena
  cualquiera que instale hoy, la vieja está en la PC de quien ya venía usando
  la app.

`npm run humo` monta la app de verdad, la desbloquea escribiendo la contraseña
en la cerradura, recorre las vistas, carga un paciente, emite una receta y una
orden, y vuelve a bloquear. Mide **dónde caen** los overlays, no solo si
existen.

`npx electron test/capturas.cjs <carpeta>` no es un test: siembra datos de
muestra y saca capturas para mirar cómo quedó.

---

## Empaquetar

```
npm run build          # → dist/Rx-Setup-0.1.0.exe
npm run test:paquete   # y verificarlo, que no es opcional
```

Instalador NSIS, no `oneClick`: deja elegir carpeta y se instala por usuario
(sin pedir admin).

**El módulo nativo es lo único delicado.** Dos cosas que tienen que estar:

1. `asarUnpack` lo saca del asar. Un `.node` **no se puede cargar desde adentro
   de un asar**: la app abriría bien y moriría recién al intentar descifrar la
   base, o sea al desbloquear.
2. `npmRebuild: false`, porque el binario ya viene compilado contra Electron 40
   por `npm run rebuild:nativos`. Dejar que electron-builder lo reconstruya
   obligaría a tener MSVC instalado para nada.

> **Si subís de versión de Electron:** correr `npm run rebuild:nativos` (con el
> `--target` nuevo) ANTES de empaquetar. Un binario con el ABI viejo falla al
> cargar, y el mensaje no dice "ABI": dice que el módulo no se pudo abrir.

`test:paquete` contesta las dos preguntas que un test del fuente no puede:

- **¿El `.node` que se envía cifra de verdad?** Se carga el módulo desde
  `app.asar.unpacked` y se le hace un ciclo completo. Que el archivo exista no
  prueba nada: podría ser el binario de Node en vez del de Electron.
- **¿El renderer monta, o es pantalla en blanco?** Se arranca el `.exe` con
  `--remote-debugging-port` y se le mira el DOM por CDP: que el splash se haya
  ido, que la cerradura esté dibujada, que los tokens hayan cargado y que los
  `<i data-icon>` sean SVG. El `<title>` **no** alcanza — una pantalla en blanco
  también tiene título.

Los datos de la app instalada van a `%APPDATA%\Rx`, no al lado del ejecutable:
esa carpeta es de solo lectura y además una actualización la reemplaza entera.
`RX_DATA` manda sobre todo, y sirve para correr una copia contra datos falsos.

---

## Lo que falta

- **Auto-update.** No hay `electron-updater`. Si se quiere, es el mismo flujo
  que las otras apps (releases de GitHub), pero implica publicar el binario.
- **Vademécum.** El catálogo es la lista corta de lo que la doctora receta
  seguido, cargada a mano. Importar un vademécum real es otra cosa.
- **La agenda de turnos** quedó descartada, no pendiente.

---

## La marca

El bastón de Asclepio, dibujado sobre la misma grilla de 16 que el resto de los
íconos. El asta se corta donde la serpiente pasa por delante: ese hueco es lo
único que la hace parecer enroscada y no apoyada encima.

Está en **cuatro archivos** que tienen que coincidir:

| Dónde | Archivo |
|---|---|
| Splash de arranque | `renderer/index.html` (`#boot-splash`) |
| Titlebar | `renderer/index.html` (`.ox-brand__mark`) |
| Cerradura | `renderer/js/desbloqueo.js` (`MARCA`) |
| Ícono de Windows | `build/make-icon.cjs` → `npm run icon` |

`npm test` compara los cuatro trazo por trazo y falla si uno se corrió medio
punto. Sin eso, el arranque salta de un dibujo a otro entre el splash y la
titlebar, o el ícono queda con la marca vieja — y no se nota hasta que ya está
empaquetada.

> **La cabeza de la serpiente es un punto macizo** (`fill="currentColor"`), así
> que cada contenedor tiene que declarar `color` además de `stroke`. Si no,
> hereda el color de texto del padre y puede quedar invisible sobre el fondo.
> El test también vigila eso.

Se probaron el bastón, la hoja de receta y la cruz. La decisión salió de mirar
las tres a **tamaño real ampliado por vecino más cercano** (`npx electron
build/logos.cjs`): en grande las tres se ven bien, y a 16 px la primera versión
del bastón —con tres vueltas— se leía como un símbolo de centavos. La que quedó
tiene una sola vuelta y el asta entera.
