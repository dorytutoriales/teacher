import * as SQLite from "expo-sqlite";

let promesaBaseDatos: Promise<SQLite.SQLiteDatabase> | null = null;

/**
 * Devuelve una única conexión SQLite compartida por toda la aplicación.
 * No usa SQLiteProvider para que la apertura de la base de datos no envuelva
 * ni bloquee el árbol de navegación.
 */
export function obtenerBaseDatos() {
  if (!promesaBaseDatos) {
    promesaBaseDatos = SQLite.openDatabaseAsync("dory_teacher.db", {
      useNewConnection: true,
    }).catch((error) => {
      // Permite volver a intentar si Android rechazó la conexión anterior.
      promesaBaseDatos = null;
      throw error;
    });
  }

  return promesaBaseDatos;
}

/**
 * Evita que una operación nativa pendiente deje una pantalla mostrando
 * "Cargando" indefinidamente.
 */
export async function ejecutarConTiempoMaximo<T>(
  operacion: Promise<T>,
  tiempoMaximoMs = 5000,
): Promise<T> {
  let temporizador: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      operacion,
      new Promise<T>((_, reject) => {
        temporizador = setTimeout(() => {
          reject(
            new Error("La operación de SQLite tardó demasiado en responder."),
          );
        }, tiempoMaximoMs);
      }),
    ]);
  } finally {
    if (temporizador) {
      clearTimeout(temporizador);
    }
  }
}
