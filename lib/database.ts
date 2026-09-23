// lib/database.ts

import * as SQLite from "expo-sqlite";

export type ColumnaTablaSQLite = {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: unknown;
  pk: number;
};

export type TablaDiagnosticoSQLite = {
  nombre: string;
  sql: string;
  totalRegistros: number;
  columnas: ColumnaTablaSQLite[];
  filas: Record<string, unknown>[];
};

type TablaMaestraSQLite = {
  name: string;
  sql: string | null;
};

type ConteoSQLite = {
  total: number;
};

let promesaBaseDatos: Promise<SQLite.SQLiteDatabase> | null = null;
let conexionBaseDatos: SQLite.SQLiteDatabase | null = null;

let promesaEsquema: Promise<SQLite.SQLiteDatabase> | null = null;

/*
 * Devuelve de forma segura el texto de cualquier error.
 */
const obtenerMensajeError = (error: unknown) => {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error ?? "");
};

/*
 * Solamente considera como error de conexión aquellos casos
 * en los que la instancia nativa de SQLite realmente dejó
 * de ser utilizable.
 *
 * IMPORTANTE:
 * "database is locked" y "database is busy" NO reinician
 * automáticamente la conexión, porque abrir otra conexión
 * mientras la anterior sigue trabajando puede empeorar
 * el bloqueo.
 */
const esErrorConexionSQLite = (error: unknown) => {
  const mensaje = obtenerMensajeError(error).toLowerCase();

  return (
    mensaje.includes("nullexception") ||
    mensaje.includes("shared object") ||
    mensaje.includes("already released") ||
    mensaje.includes("database object has been closed") ||
    mensaje.includes("database is closed") ||
    mensaje.includes("connection is closed")
  );
};

/*
 * Limpia las referencias solamente cuando la conexión
 * nativa realmente quedó inválida.
 */
const limpiarReferenciasBaseDatos = () => {
  conexionBaseDatos = null;
  promesaBaseDatos = null;
  promesaEsquema = null;
};

/*
 * Abre UNA sola conexión compartida.
 *
 * Antes se utilizaba useNewConnection: true. Eso podía
 * producir varias conexiones a dory_teacher.db cuando
 * una consulta tardaba demasiado o cuando había recargas
 * rápidas de React Native.
 */
const abrirBaseDatos = async () => {
  const db = await SQLite.openDatabaseAsync("dory_teacher.db");

  /*
   * No cambiamos journal_mode aquí.
   *
   * Si la base existente ya utiliza WAL seguirá utilizándolo.
   * Evitamos ejecutar PRAGMA journal_mode = WAL repetidamente
   * cada vez que una pantalla solicita la base.
   */
  await db.execAsync(`
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
  `);

  /*
   * Verifica que la conexión se encuentra operativa.
   */
  await db.getFirstAsync<{ comprobacion: number }>("SELECT 1 AS comprobacion;");

  conexionBaseDatos = db;

  return db;
};

/*
 * Devuelve siempre la misma conexión SQLite mientras
 * la aplicación continúe ejecutándose.
 */
export const obtenerBaseDatos = async () => {
  if (conexionBaseDatos) {
    return conexionBaseDatos;
  }

  if (!promesaBaseDatos) {
    promesaBaseDatos = abrirBaseDatos().catch((error) => {
      promesaBaseDatos = null;
      conexionBaseDatos = null;

      throw error;
    });
  }

  return promesaBaseDatos;
};

/*
 * Añade la columna posicion a instalaciones antiguas
 * que todavía tengan una versión previa de la tabla alumnos.
 */
const asegurarColumnaPosicion = async (db: SQLite.SQLiteDatabase) => {
  const columnas = await db.getAllAsync<{ name: string }>(
    "PRAGMA table_info(alumnos);",
  );

  const existePosicion = columnas.some(
    (columna) => columna.name === "posicion",
  );

  if (existePosicion) {
    return;
  }

  try {
    await db.execAsync(`
      ALTER TABLE alumnos
      ADD COLUMN posicion INTEGER NOT NULL DEFAULT 0;
    `);
  } catch (error) {
    /*
     * Si otra ejecución alcanzó a agregarla antes,
     * no consideramos eso un error.
     */
    const mensaje = obtenerMensajeError(error).toLowerCase();

    if (!mensaje.includes("duplicate column")) {
      throw error;
    }
  }
};

/*
 * Comprueba si alguna clase tiene posiciones antiguas,
 * duplicadas, faltantes o fuera de secuencia.
 *
 * Si todo está correcto NO se realizan UPDATE.
 */
const normalizarPosicionesSiHaceFalta = async (db: SQLite.SQLiteDatabase) => {
  const necesitaNormalizacion = await db.getFirstAsync<{
    necesita: number;
  }>(`
    SELECT
      1 AS necesita
    FROM (
      SELECT
        clase,
        COUNT(*) AS total,
        COUNT(
          DISTINCT CASE
            WHEN COALESCE(posicion, 0) > 0
            THEN posicion
            ELSE NULL
          END
        ) AS posiciones_distintas,
        MIN(
          CASE
            WHEN COALESCE(posicion, 0) > 0
            THEN posicion
            ELSE NULL
          END
        ) AS posicion_minima,
        MAX(
          CASE
            WHEN COALESCE(posicion, 0) > 0
            THEN posicion
            ELSE NULL
          END
        ) AS posicion_maxima,
        SUM(
          CASE
            WHEN COALESCE(posicion, 0) <= 0
            THEN 1
            ELSE 0
          END
        ) AS posiciones_invalidas
      FROM alumnos
      GROUP BY clase
    )
    WHERE
      posiciones_invalidas > 0
      OR posiciones_distintas <> total
      OR posicion_minima <> 1
      OR posicion_maxima <> total
    LIMIT 1;
  `);

  if (!necesitaNormalizacion) {
    return;
  }

  /*
   * Corrige todas las posiciones en UNA sola operación.
   *
   * No hacemos UPDATE alumno por alumno.
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
};

/*
 * Garantiza que las tablas necesarias existen.
 *
 * Esta función se ejecuta una sola vez por sesión.
 */
export const asegurarEsquemaBaseDatos = async () => {
  if (!promesaEsquema) {
    promesaEsquema = (async () => {
      const db = await obtenerBaseDatos();

      /*
       * La tabla clase debe existir antes de crear alumnos
       * porque alumnos.clase hace referencia a clase.id.
       */
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS clase (
          id TEXT PRIMARY KEY NOT NULL,
          clase TEXT NOT NULL,
          escuela TEXT NOT NULL,
          grupo TEXT NOT NULL DEFAULT '',
          descripcion TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS alumnos (
          id TEXT PRIMARY KEY NOT NULL,
          nombre TEXT NOT NULL,
          clase TEXT NOT NULL,
          posicion INTEGER NOT NULL DEFAULT 0,
          FOREIGN KEY (clase)
            REFERENCES clase(id)
            ON DELETE CASCADE
        );
      `);

      await asegurarColumnaPosicion(db);

      await db.execAsync(`
        CREATE INDEX IF NOT EXISTS indice_alumnos_clase
        ON alumnos(clase);
      `);

      /*
       * Solo hace UPDATE si realmente encuentra
       * posiciones que necesitan corregirse.
       */
      await normalizarPosicionesSiHaceFalta(db);

      return db;
    })().catch((error) => {
      promesaEsquema = null;

      throw error;
    });
  }

  return promesaEsquema;
};

/*
 * Ejecuta una operación con límite de tiempo.
 *
 * MUY IMPORTANTE:
 *
 * Promise.race no cancela una operación SQLite nativa
 * cuando vence el tiempo. Por eso NO abrimos automáticamente
 * otra conexión cuando simplemente se alcanza el timeout.
 */
export const ejecutarConTiempoMaximo = async <T>(
  promesa: Promise<T>,
  milisegundos = 8000,
): Promise<T> => {
  let temporizador: ReturnType<typeof setTimeout> | null = null;

  const tiempoMaximo = new Promise<never>((_, rechazar) => {
    temporizador = setTimeout(() => {
      rechazar(
        new Error(`La operación de SQLite tardó más de ${milisegundos} ms.`),
      );
    }, milisegundos);
  });

  try {
    return await Promise.race([promesa, tiempoMaximo]);
  } catch (error) {
    /*
     * Solamente reiniciamos la referencia si la conexión
     * realmente dejó de existir.
     *
     * Un timeout, busy o locked no crea una conexión nueva.
     */
    if (esErrorConexionSQLite(error)) {
      limpiarReferenciasBaseDatos();
    }

    throw error;
  } finally {
    if (temporizador) {
      clearTimeout(temporizador);
    }
  }
};

/*
 * Escapa correctamente nombres de tablas obtenidos
 * desde sqlite_master.
 */
const escaparIdentificadorSQLite = (nombre: string) => {
  return `"${nombre.replace(/"/g, '""')}"`;
};

/*
 * Obtiene:
 *
 * - Todas las tablas de la aplicación.
 * - SQL utilizado para crearlas.
 * - Columnas.
 * - Tipos.
 * - NOT NULL.
 * - Primary Key.
 * - Valores predeterminados.
 * - Número total de registros.
 * - TODOS los registros almacenados.
 *
 * Esta información es utilizada por app/base-datos.tsx.
 */
export const obtenerDiagnosticoBaseDatos = async (): Promise<
  TablaDiagnosticoSQLite[]
> => {
  const db = await ejecutarConTiempoMaximo(asegurarEsquemaBaseDatos(), 12000);

  const tablas = await ejecutarConTiempoMaximo(
    db.getAllAsync<TablaMaestraSQLite>(`
      SELECT
        name,
        sql
      FROM sqlite_master
      WHERE
        type = 'table'
        AND name NOT LIKE 'sqlite_%'
      ORDER BY name COLLATE NOCASE ASC;
    `),
    10000,
  );

  const resultado: TablaDiagnosticoSQLite[] = [];

  for (const tabla of tablas) {
    const identificador = escaparIdentificadorSQLite(tabla.name);

    const columnas = await ejecutarConTiempoMaximo(
      db.getAllAsync<ColumnaTablaSQLite>(
        `PRAGMA table_info(${identificador});`,
      ),
      10000,
    );

    const conteo = await ejecutarConTiempoMaximo(
      db.getFirstAsync<ConteoSQLite>(
        `SELECT COUNT(*) AS total FROM ${identificador};`,
      ),
      10000,
    );

    /*
     * El usuario pidió poder ver los datos de sus tablas,
     * por lo que no usamos datos simulados ni solamente
     * mostramos un conteo.
     */
    const filas = await ejecutarConTiempoMaximo(
      db.getAllAsync<Record<string, unknown>>(
        `SELECT * FROM ${identificador};`,
      ),
      15000,
    );

    resultado.push({
      nombre: tabla.name,
      sql: tabla.sql ?? "",
      totalRegistros: Number(conteo?.total ?? 0),
      columnas,
      filas,
    });
  }

  return resultado;
};
