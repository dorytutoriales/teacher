const fs = require("fs");
const path = require("path");

/*
 * Dory Teacher
 *
 * Corrección temporal para:
 *
 * NativeWind 4.x
 * react-native-css-interop 0.2.x
 * Expo Router
 * React Navigation
 *
 * Corrige el error:
 *
 * "Couldn't find a navigation context.
 * Have you wrapped your app with 'NavigationContainer'?"
 *
 * cuando en realidad el error se origina en:
 *
 * react-native-css-interop
 * -> render-component.js
 * -> printUpgradeWarning
 * -> stringify
 *
 * No modifica la navegación de Dory Teacher.
 * No agrega NavigationContainer.
 */

const proyecto = process.cwd();

const posiblesArchivos = [
  path.join(
    proyecto,
    "node_modules",
    "react-native-css-interop",
    "dist",
    "runtime",
    "native",
    "render-component.js",
  ),

  path.join(
    proyecto,
    "node_modules",
    "react-native-css-interop",
    "dist",
    "runtime",
    "native",
    "render-component.cjs",
  ),
];

const MARCADOR = "DORY_TEACHER_SAFE_OBJECT_ENTRIES";

/*
 * Busca el archivo render-component en caso de que
 * la estructura interna del paquete sea ligeramente distinta.
 */
const buscarArchivoRecursivamente = (directorio) => {
  if (!fs.existsSync(directorio)) {
    return null;
  }

  const elementos = fs.readdirSync(directorio, {
    withFileTypes: true,
  });

  for (const elemento of elementos) {
    const ruta = path.join(directorio, elemento.name);

    if (elemento.isDirectory()) {
      const resultado = buscarArchivoRecursivamente(ruta);

      if (resultado) {
        return resultado;
      }

      continue;
    }

    if (
      elemento.isFile() &&
      (elemento.name === "render-component.js" ||
        elemento.name === "render-component.cjs")
    ) {
      const contenido = fs.readFileSync(ruta, "utf8");

      if (
        contenido.includes("printUpgradeWarning") ||
        contenido.includes("Object.entries(value)")
      ) {
        return ruta;
      }
    }
  }

  return null;
};

let archivoObjetivo = posiblesArchivos.find((archivo) =>
  fs.existsSync(archivo),
);

if (!archivoObjetivo) {
  archivoObjetivo = buscarArchivoRecursivamente(
    path.join(proyecto, "node_modules", "react-native-css-interop"),
  );
}

if (!archivoObjetivo) {
  console.error("");
  console.error("==============================================");
  console.error(" DORY TEACHER - CORRECCIÓN DE NATIVEWIND");
  console.error("==============================================");
  console.error("");
  console.error("No se encontró react-native-css-interop en node_modules.");
  console.error("");
  console.error("Ejecuta primero:");
  console.error("");
  console.error("npm install");
  console.error("");
  console.error("y después:");
  console.error("");
  console.error("npm run fix:nativewind");
  console.error("");

  process.exit(1);
}

let contenido = fs.readFileSync(archivoObjetivo, "utf8");

/*
 * Si ya fue corregido anteriormente, no vuelve
 * a modificar el archivo.
 */
if (contenido.includes(MARCADOR)) {
  console.log("");
  console.log("==============================================");
  console.log(" DORY TEACHER - NATIVEWIND");
  console.log("==============================================");
  console.log("");
  console.log("La corrección ya está aplicada.");
  console.log("");
  console.log(`Archivo: ${archivoObjetivo}`);
  console.log("");

  process.exit(0);
}

/*
 * Esta es la llamada problemática de react-native-css-interop.
 *
 * Object.entries() ejecuta getters de objetos de React Navigation.
 *
 * NavigationStateContext contiene getters que lanzan el mensaje:
 *
 * "Couldn't find a navigation context"
 *
 * aunque NavigationContainer sí exista internamente mediante Expo Router.
 */
const patron = /Object\.entries\s*\(\s*value\s*\)/g;

const coincidencias = contenido.match(patron);

if (!coincidencias || coincidencias.length === 0) {
  console.log("");
  console.log("==============================================");
  console.log(" DORY TEACHER - NATIVEWIND");
  console.log("==============================================");
  console.log("");
  console.log("No se encontró el código vulnerable Object.entries(value).");
  console.log("");
  console.log(
    "Es posible que react-native-css-interop ya haya sido actualizado.",
  );
  console.log("");
  console.log(`Archivo revisado: ${archivoObjetivo}`);
  console.log("");

  process.exit(0);
}

/*
 * Guardamos una copia del archivo original.
 */
const archivoRespaldo = `${archivoObjetivo}.doryteacher-backup`;

if (!fs.existsSync(archivoRespaldo)) {
  fs.copyFileSync(archivoObjetivo, archivoRespaldo);
}

/*
 * En lugar de ejecutar directamente:
 *
 * Object.entries(value)
 *
 * utilizamos una operación protegida.
 *
 * Si el objeto contiene getters que lanzan errores,
 * simplemente devolvemos un arreglo vacío para que
 * la función de diagnóstico de NativeWind continúe.
 *
 * Esto solamente afecta al serializador utilizado
 * para advertencias internas de desarrollo.
 */
const reemplazo = `(
  /* ${MARCADOR} */
  (() => {
    try {
      return Object.entries(value);
    } catch (error) {
      return [];
    }
  })()
)`;

contenido = contenido.replace(patron, reemplazo);

fs.writeFileSync(archivoObjetivo, contenido, "utf8");

console.log("");
console.log("==============================================");
console.log(" DORY TEACHER - CORRECCIÓN COMPLETADA");
console.log("==============================================");
console.log("");
console.log("Se corrigió react-native-css-interop.");
console.log("");
console.log(`Archivo modificado:`);
console.log(archivoObjetivo);
console.log("");
console.log(`Respaldo:`);
console.log(archivoRespaldo);
console.log("");
console.log(`Reemplazos realizados: ${coincidencias.length}`);
console.log("");
console.log("Ya puedes iniciar nuevamente Expo con la caché limpia.");
console.log("");
