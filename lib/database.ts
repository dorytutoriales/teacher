// lib/database.ts

import * as SQLite from "expo-sqlite";

let promesaBaseDatos: Promise<SQLite.SQLiteDatabase> | null = null;
let conexionBaseDatos: SQLite.SQLiteDatabase | null = null;

const obtenerMensajeError = (error: unknown) => {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error ?? "");
};

const esErrorConexionSQLite = (error: unknown) => {
  const mensaje = obtenerMensajeError(error).toLowerCase();

  return (
    mensaje.includes("nullexception") ||
    mensaje.includes("shared object") ||
    mensaje.includes("already released") ||
    mensaje.includes("database is locked") ||
    mensaje.includes("database is busy") ||
    mensaje.includes("closed")
  );
};

async function prepararAlumnosExistentes(db: SQLite.SQLiteDatabase) {
  const tablaAlumnos = await db.getFirstAsync<{ name: string }>(
    `
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name = 'alumnos'
      LIMIT 1;
    `,
  );

  if (!tablaAlumnos) {
    return;
  }

  const columnasAlumnos = await db.getAllAsync<{ name: string }>(
    "PRAGMA table_info(alumnos);",
  );

  const existeColumnaPosicion = columnasAlumnos.some(
    (columna) => columna.name === "posicion",
  );

  if (!existeColumnaPosicion) {
    try {
      await db.execAsync(
        "ALTER TABLE alumnos ADD COLUMN posicion INTEGER NOT NULL DEFAULT 0;",
      );
    } catch (error) {
      const mensaje = obtenerMensajeError(error).toLowerCase();

      if (!mensaje.includes("duplicate column")) {
        throw error;
      }
    }
  }

  await db.execAsync(`
    CREATE INDEX IF NOT EXISTS indice_alumnos_clase
    ON alumnos(clase);
  `);

  /*
   * Corrige las posiciones antiguas en una sola operación SQLite.
   *
   * Antes la pantalla de alumnos realizaba muchos UPDATE uno por uno al
   * abrirse. En Android esa operación puede dejar esperando la pantalla
   * mientras se ejecuta la transacción.
   *
   * Aquí SQLite calcula y guarda todas las posiciones directamente.
   */
  await db.execAsync(`
    WITH alumnos_ordenados AS (
      SELECT
        id,
        ROW_NUMBER() OVER (
          PARTITION BY clase
          ORDER BY
            CASE
              WHEN COALESCE(posicion, 0) > 0 THEN 0
              ELSE 1
            END ASC,
            CASE
              WHEN COALESCE(posicion, 0) > 0 THEN posicion
              ELSE NULL
            END ASC,
            nombre COLLATE NOCASE ASC,
            id ASC
        ) AS nueva_posicion
      FROM alumnos
    )
    UPDATE alumnos
    SET posicion = (
      SELECT nueva_posicion
      FROM alumnos_ordenados
      WHERE alumnos_ordenados.id = alumnos.id
    )
    WHERE id IN (
      SELECT id
      FROM alumnos_ordenados
    );
  `);
}

async function abrirBaseDatos() {
  let ultimoError: unknown = null;

  /*
   * Se realizan hasta dos intentos.
   *
   * useNewConnection evita que Android reutilice una conexión SQLite nativa
   * que haya quedado inválida después de una recarga de la aplicación.
   */
  for (let intento = 0; intento < 2; intento += 1) {
    try {
      const db = await SQLite.openDatabaseAsync("dory_teacher.db", {
        useNewConnection: true,
      });

      /*
       * WAL mejora el acceso concurrente.
       * busy_timeout evita que una consulta quede esperando indefinidamente
       * cuando SQLite encuentra temporalmente la base ocupada.
       */
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;
        PRAGMA busy_timeout = 3000;
      `);

      /*
       * Comprueba que la conexión realmente puede ejecutar consultas antes
       * de entregarla al resto de la aplicación.
       */
      await db.getFirstAsync<{ comprobacion: number }>(
        "SELECT 1 AS comprobacion;",
      );

      /*
       * Si la tabla alumnos ya existía de una versión anterior, se añade
       * automáticamente la columna posicion y se normaliza el orden.
       *
       * Si todavía no existe, alumnos.tsx la creará normalmente cuando se
       * abra la pantalla por primera vez.
       */
      try {
        await prepararAlumnosExistentes(db);
      } catch (errorPreparacion) {
        console.warn(
          "No fue posible normalizar la tabla de alumnos al abrir SQLite:",
          errorPreparacion,
        );
      }

      conexionBaseDatos = db;

      return db;
    } catch (error) {
      ultimoError = error;
      conexionBaseDatos = null;

      if (intento === 1) {
        throw error;
      }
    }
  }

  throw ultimoError instanceof Error
    ? ultimoError
    : new Error("No fue posible abrir la base de datos SQLite.");
}

/**
 * Devuelve una única conexión SQLite compartida por toda la aplicación.
 *
 * No utiliza SQLiteProvider para no bloquear el árbol de navegación.
 */
export function obtenerBaseDatos(): Promise<SQLite.SQLiteDatabase> {
  if (conexionBaseDatos) {
    return Promise.resolve(conexionBaseDatos);
  }

  if (!promesaBaseDatos) {
    promesaBaseDatos = abrirBaseDatos()
      .then((db) => {
        conexionBaseDatos = db;
        return db;
      })
      .catch((error) => {
        conexionBaseDatos = null;
        promesaBaseDatos = null;

        throw error;
      });
  }

  return promesaBaseDatos;
}

/**
 * Evita que una operación nativa pendiente deje una pantalla mostrando
 * "Cargando" indefinidamente.
 *
 * Si Android deja una conexión SQLite inválida, se descarta la referencia.
 * La siguiente operación abrirá una conexión nueva.
 */
export async function ejecutarConTiempoMaximo<T>(
  operacion: Promise<T>,
  tiempoMaximoMs = 5000,
): Promise<T> {
  let temporizador: ReturnType<typeof setTimeout> | null = null;
  let vencioTiempo = false;

  try {
    return await Promise.race([
      operacion,

      new Promise<T>((_, reject) => {
        temporizador = setTimeout(() => {
          vencioTiempo = true;

          reject(
            new Error("La operación de SQLite tardó demasiado en responder."),
          );
        }, tiempoMaximoMs);
      }),
    ]);
  } catch (error) {
    /*
     * No se cierra aquí la conexión porque la operación nativa anterior
     * todavía podría estar terminando.
     *
     * Únicamente se elimina la referencia para que la siguiente petición
     * cree una conexión SQLite nueva.
     */
    if (vencioTiempo || esErrorConexionSQLite(error)) {
      conexionBaseDatos = null;
      promesaBaseDatos = null;
    }

    throw error;
  } finally {
    if (temporizador) {
      clearTimeout(temporizador);
    }
  }
}
