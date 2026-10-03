import { ejecutarConTiempoMaximo, obtenerBaseDatos } from "@/lib/database";
import {
  faArrowLeft,
  faMoon,
  faPlus,
  faSun,
  faTrash,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-native-fontawesome";
import * as Crypto from "expo-crypto";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useColorScheme } from "nativewind";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type ParametrosCalificaciones = {
  id?: string | string[];
  nombreClase?: string | string[];
  escuela?: string | string[];
  grupo?: string | string[];
  descripcion?: string | string[];
};

type Alumno = {
  id: string;
  nombre: string;
  clase: string;
  posicion: number;
};

type TrabajoCalificacion = {
  id: string;
  clase: string;
  nombre: string;
  posicion: number;
  valor: number;
};

type RegistroCalificacion = {
  alumno: string;
  trabajo: string;
  calificacion: string;
};

const ANCHO_NUMERO = 55;
const ANCHO_NOMBRE = 200;
const ANCHO_TRABAJO = 145;
const ANCHO_TOTAL = 120;

const normalizarTexto = (texto: string) => {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
};

const crearClaveCalificacion = (idAlumno: string, idTrabajo: string) => {
  return `${idAlumno}__${idTrabajo}`;
};

const convertirTextoANumero = (texto: string) => {
  const textoLimpio = texto.trim().replace(",", ".");

  if (!textoLimpio) {
    return null;
  }

  const numero = Number(textoLimpio);

  if (!Number.isFinite(numero)) {
    return null;
  }

  return numero;
};

const formatearValor = (valor: number) => {
  if (!Number.isFinite(valor)) {
    return "0";
  }

  if (Number.isInteger(valor)) {
    return String(valor);
  }

  return valor.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
};

export default function PantallaCalificaciones() {
  const router = useRouter();
  const parametros = useLocalSearchParams<ParametrosCalificaciones>();
  const { colorScheme, toggleColorScheme } = useColorScheme();
  const modoOscuro = colorScheme === "dark";

  const obtenerParametro = (
    parametro: string | string[] | undefined,
    valorPredeterminado: string,
  ) => {
    if (Array.isArray(parametro)) {
      return parametro[0] ?? valorPredeterminado;
    }

    return parametro ?? valorPredeterminado;
  };

  const idClase = obtenerParametro(parametros.id, "");
  const nombreClase = obtenerParametro(parametros.nombreClase, "Clase");

  const [alumnos, setAlumnos] = useState<Alumno[]>([]);
  const [trabajos, setTrabajos] = useState<TrabajoCalificacion[]>([]);
  const [calificaciones, setCalificaciones] = useState<Record<string, string>>(
    {},
  );

  const [busquedaAlumno, setBusquedaAlumno] = useState("");
  const [cargando, setCargando] = useState(true);
  const [agregandoTrabajo, setAgregandoTrabajo] = useState(false);

  const [celdasGuardando, setCeldasGuardando] = useState<
    Record<string, boolean>
  >({});

  const [trabajoConfigurando, setTrabajoConfigurando] =
    useState<TrabajoCalificacion | null>(null);

  const [nombreTrabajoConfigurando, setNombreTrabajoConfigurando] =
    useState("");

  const [valorTrabajoConfigurando, setValorTrabajoConfigurando] = useState("");

  const [guardandoConfiguracion, setGuardandoConfiguracion] = useState(false);
  const [eliminandoTrabajo, setEliminandoTrabajo] = useState(false);

  useEffect(() => {
    let componenteActivo = true;

    const cargarDatos = async () => {
      setCargando(true);

      try {
        if (!idClase) {
          if (componenteActivo) {
            setAlumnos([]);
            setTrabajos([]);
            setCalificaciones({});
          }

          return;
        }

        const db = await ejecutarConTiempoMaximo(obtenerBaseDatos());

        await ejecutarConTiempoMaximo(
          db.execAsync(`
            CREATE TABLE IF NOT EXISTS alumnos (
              id TEXT PRIMARY KEY NOT NULL,
              nombre TEXT NOT NULL,
              clase TEXT NOT NULL,
              posicion INTEGER NOT NULL DEFAULT 0,
              FOREIGN KEY (clase)
                REFERENCES clase(id)
                ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS indice_alumnos_clase
            ON alumnos(clase);

            CREATE TABLE IF NOT EXISTS trabajos_calificaciones (
              id TEXT PRIMARY KEY NOT NULL,
              clase TEXT NOT NULL,
              nombre TEXT NOT NULL,
              posicion INTEGER NOT NULL DEFAULT 0,
              valor REAL NOT NULL DEFAULT 0,
              FOREIGN KEY (clase)
                REFERENCES clase(id)
                ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS indice_trabajos_calificaciones_clase
            ON trabajos_calificaciones(clase, posicion);

            CREATE TABLE IF NOT EXISTS calificaciones (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              alumno TEXT NOT NULL,
              clase TEXT NOT NULL,
              trabajo TEXT NOT NULL,
              calificacion TEXT NOT NULL DEFAULT '',
              UNIQUE(alumno, trabajo),
              FOREIGN KEY (alumno)
                REFERENCES alumnos(id)
                ON DELETE CASCADE,
              FOREIGN KEY (clase)
                REFERENCES clase(id)
                ON DELETE CASCADE,
              FOREIGN KEY (trabajo)
                REFERENCES trabajos_calificaciones(id)
                ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS indice_calificaciones_clase
            ON calificaciones(clase);

            CREATE INDEX IF NOT EXISTS indice_calificaciones_alumno
            ON calificaciones(alumno);

            CREATE INDEX IF NOT EXISTS indice_calificaciones_trabajo
            ON calificaciones(trabajo);
          `),
        );

        const columnasAlumnos = await ejecutarConTiempoMaximo(
          db.getAllAsync<{ name: string }>("PRAGMA table_info(alumnos);"),
        );

        const existeColumnaPosicion = columnasAlumnos.some(
          (columna) => columna.name === "posicion",
        );

        if (!existeColumnaPosicion) {
          await ejecutarConTiempoMaximo(
            db.execAsync(`
              ALTER TABLE alumnos
              ADD COLUMN posicion INTEGER NOT NULL DEFAULT 0;
            `),
          );
        }

        /*
         * Migración para instalaciones que ya tenían creada
         * la tabla trabajos_calificaciones.
         */
        const columnasTrabajos = await ejecutarConTiempoMaximo(
          db.getAllAsync<{ name: string }>(
            "PRAGMA table_info(trabajos_calificaciones);",
          ),
        );

        const existeColumnaValor = columnasTrabajos.some(
          (columna) => columna.name === "valor",
        );

        if (!existeColumnaValor) {
          await ejecutarConTiempoMaximo(
            db.execAsync(`
              ALTER TABLE trabajos_calificaciones
              ADD COLUMN valor REAL NOT NULL DEFAULT 0;
            `),
          );
        }

        const alumnosGuardados = await ejecutarConTiempoMaximo(
          db.getAllAsync<Alumno>(
            `
              SELECT
                id,
                nombre,
                clase,
                posicion
              FROM alumnos
              WHERE clase = ?
              ORDER BY
                CASE
                  WHEN posicion > 0 THEN 0
                  ELSE 1
                END ASC,
                CASE
                  WHEN posicion > 0 THEN posicion
                  ELSE NULL
                END ASC,
                nombre COLLATE NOCASE ASC
              LIMIT 2000;
            `,
            [idClase],
          ),
        );

        const trabajosGuardados = await ejecutarConTiempoMaximo(
          db.getAllAsync<TrabajoCalificacion>(
            `
              SELECT
                id,
                clase,
                nombre,
                posicion,
                valor
              FROM trabajos_calificaciones
              WHERE clase = ?
              ORDER BY posicion ASC, rowid ASC;
            `,
            [idClase],
          ),
        );

        const registrosGuardados = await ejecutarConTiempoMaximo(
          db.getAllAsync<RegistroCalificacion>(
            `
              SELECT
                alumno,
                trabajo,
                calificacion
              FROM calificaciones
              WHERE clase = ?;
            `,
            [idClase],
          ),
        );

        const calificacionesCargadas: Record<string, string> = {};

        registrosGuardados.forEach((registro) => {
          const clave = crearClaveCalificacion(
            registro.alumno,
            registro.trabajo,
          );

          calificacionesCargadas[clave] = registro.calificacion;
        });

        if (componenteActivo) {
          setAlumnos(alumnosGuardados);

          setTrabajos(
            trabajosGuardados.map((trabajo) => ({
              ...trabajo,
              valor: Number(trabajo.valor ?? 0),
            })),
          );

          setCalificaciones(calificacionesCargadas);
        }
      } catch (error) {
        console.error("Error al cargar calificaciones:", error);

        if (componenteActivo) {
          setAlumnos([]);
          setTrabajos([]);
          setCalificaciones({});
        }

        Alert.alert(
          "Error",
          "No fue posible cargar los alumnos y las calificaciones.",
        );
      } finally {
        if (componenteActivo) {
          setCargando(false);
        }
      }
    };

    void cargarDatos();

    return () => {
      componenteActivo = false;
    };
  }, [idClase]);

  const numeroPorAlumno = useMemo(() => {
    const numeros = new Map<string, number>();

    alumnos.forEach((alumno, indice) => {
      numeros.set(
        alumno.id,
        alumno.posicion > 0 ? alumno.posicion : indice + 1,
      );
    });

    return numeros;
  }, [alumnos]);

  const alumnosFiltrados = useMemo(() => {
    const texto = normalizarTexto(busquedaAlumno);

    if (!texto) {
      return alumnos;
    }

    return alumnos.filter((alumno) => {
      const numeroAlumno = numeroPorAlumno.get(alumno.id) ?? 0;

      return (
        normalizarTexto(alumno.nombre).includes(texto) ||
        String(numeroAlumno).includes(texto)
      );
    });
  }, [alumnos, busquedaAlumno, numeroPorAlumno]);

  /*
   * Calcula el total ponderado.
   *
   * Ejemplo:
   * Calificación = 8
   * Valor del trabajo = 25 %
   * Aporta 2 puntos al Total.
   *
   * Si todos los valores suman 100 %, el resultado final
   * permanece en la misma escala de las calificaciones.
   */
  const totalesPorAlumno = useMemo(() => {
    const totales = new Map<string, number>();

    alumnos.forEach((alumno) => {
      let total = 0;

      trabajos.forEach((trabajo) => {
        const valorTrabajo = Number(trabajo.valor ?? 0);

        if (!Number.isFinite(valorTrabajo) || valorTrabajo <= 0) {
          return;
        }

        const clave = crearClaveCalificacion(alumno.id, trabajo.id);
        const textoCalificacion = calificaciones[clave] ?? "";
        const numeroCalificacion = convertirTextoANumero(textoCalificacion);

        if (numeroCalificacion === null) {
          return;
        }

        total += numeroCalificacion * (valorTrabajo / 100);
      });

      totales.set(alumno.id, total);
    });

    return totales;
  }, [alumnos, trabajos, calificaciones]);

  const agregarTrabajo = async () => {
    if (!idClase || agregandoTrabajo) {
      return;
    }

    setAgregandoTrabajo(true);

    const posicionNueva =
      trabajos.reduce(
        (posicionMayor, trabajo) =>
          Math.max(posicionMayor, trabajo.posicion || 0),
        0,
      ) + 1;

    const nuevoTrabajo: TrabajoCalificacion = {
      id: Crypto.randomUUID(),
      clase: idClase,
      nombre: `Trabajo ${posicionNueva}`,
      posicion: posicionNueva,
      valor: 0,
    };

    try {
      const db = await ejecutarConTiempoMaximo(obtenerBaseDatos());

      await ejecutarConTiempoMaximo(
        db.runAsync(
          `
            INSERT INTO trabajos_calificaciones (
              id,
              clase,
              nombre,
              posicion,
              valor
            )
            VALUES (?, ?, ?, ?, ?);
          `,
          [
            nuevoTrabajo.id,
            nuevoTrabajo.clase,
            nuevoTrabajo.nombre,
            nuevoTrabajo.posicion,
            nuevoTrabajo.valor,
          ],
        ),
      );

      setTrabajos((trabajosActuales) => [...trabajosActuales, nuevoTrabajo]);
    } catch (error) {
      console.error("Error al agregar trabajo o proyecto:", error);

      Alert.alert(
        "Error",
        "No fue posible agregar una nueva columna de calificación.",
      );
    } finally {
      setAgregandoTrabajo(false);
    }
  };

  const abrirConfiguracionTrabajo = (trabajo: TrabajoCalificacion) => {
    if (guardandoConfiguracion || eliminandoTrabajo) {
      return;
    }

    setTrabajoConfigurando(trabajo);
    setNombreTrabajoConfigurando(trabajo.nombre);
    setValorTrabajoConfigurando(formatearValor(Number(trabajo.valor ?? 0)));
  };

  const cerrarConfiguracionTrabajo = () => {
    if (guardandoConfiguracion || eliminandoTrabajo) {
      return;
    }

    setTrabajoConfigurando(null);
    setNombreTrabajoConfigurando("");
    setValorTrabajoConfigurando("");
  };

  const guardarConfiguracionTrabajo = async () => {
    if (!trabajoConfigurando || guardandoConfiguracion || eliminandoTrabajo) {
      return;
    }

    const nombreLimpio = nombreTrabajoConfigurando.trim();

    const nombreFinal =
      nombreLimpio || `Trabajo ${trabajoConfigurando.posicion}`;

    const valorTexto = valorTrabajoConfigurando.trim().replace(",", ".");

    const valorNumerico = valorTexto === "" ? 0 : Number(valorTexto);

    if (!Number.isFinite(valorNumerico)) {
      Alert.alert(
        "Valor no válido",
        "Escribe un número válido para el valor del trabajo.",
      );

      return;
    }

    if (valorNumerico < 0 || valorNumerico > 100) {
      Alert.alert(
        "Valor no válido",
        "El valor del trabajo debe estar entre 0 y 100 por ciento.",
      );

      return;
    }

    setGuardandoConfiguracion(true);

    try {
      const db = await ejecutarConTiempoMaximo(obtenerBaseDatos());

      await ejecutarConTiempoMaximo(
        db.runAsync(
          `
            UPDATE trabajos_calificaciones
            SET
              nombre = ?,
              valor = ?
            WHERE id = ?
              AND clase = ?;
          `,
          [nombreFinal, valorNumerico, trabajoConfigurando.id, idClase],
        ),
      );

      setTrabajos((trabajosActuales) =>
        trabajosActuales.map((trabajo) =>
          trabajo.id === trabajoConfigurando.id
            ? {
                ...trabajo,
                nombre: nombreFinal,
                valor: valorNumerico,
              }
            : trabajo,
        ),
      );

      setTrabajoConfigurando(null);
      setNombreTrabajoConfigurando("");
      setValorTrabajoConfigurando("");
    } catch (error) {
      console.error("Error al guardar la configuración del trabajo:", error);

      Alert.alert(
        "Error",
        "No fue posible guardar la configuración del trabajo o proyecto.",
      );
    } finally {
      setGuardandoConfiguracion(false);
    }
  };

  const eliminarTrabajo = async (trabajo: TrabajoCalificacion) => {
    if (eliminandoTrabajo || guardandoConfiguracion) {
      return;
    }

    setEliminandoTrabajo(true);

    try {
      const db = await ejecutarConTiempoMaximo(obtenerBaseDatos());

      /*
       * Las calificaciones relacionadas se eliminan automáticamente
       * mediante ON DELETE CASCADE.
       */
      await ejecutarConTiempoMaximo(
        db.runAsync(
          `
            DELETE FROM trabajos_calificaciones
            WHERE id = ?
              AND clase = ?;
          `,
          [trabajo.id, idClase],
        ),
      );

      setTrabajos((trabajosActuales) =>
        trabajosActuales.filter(
          (trabajoActual) => trabajoActual.id !== trabajo.id,
        ),
      );

      setCalificaciones((calificacionesActuales) => {
        const nuevasCalificaciones = {
          ...calificacionesActuales,
        };

        const terminacionClave = `__${trabajo.id}`;

        Object.keys(nuevasCalificaciones).forEach((clave) => {
          if (clave.endsWith(terminacionClave)) {
            delete nuevasCalificaciones[clave];
          }
        });

        return nuevasCalificaciones;
      });

      setTrabajoConfigurando(null);
      setNombreTrabajoConfigurando("");
      setValorTrabajoConfigurando("");
    } catch (error) {
      console.error("Error al eliminar trabajo o proyecto:", error);

      Alert.alert("Error", "No fue posible eliminar el trabajo o proyecto.");
    } finally {
      setEliminandoTrabajo(false);
    }
  };

  const confirmarEliminarTrabajo = () => {
    if (!trabajoConfigurando || eliminandoTrabajo || guardandoConfiguracion) {
      return;
    }

    const trabajo = trabajoConfigurando;

    Alert.alert(
      "Eliminar trabajo",
      `¿Seguro que deseas eliminar "${trabajo.nombre}"? También se eliminarán las calificaciones capturadas en este trabajo.`,
      [
        {
          text: "Cancelar",
          style: "cancel",
        },
        {
          text: "Eliminar",
          style: "destructive",
          onPress: () => {
            void eliminarTrabajo(trabajo);
          },
        },
      ],
    );
  };

  const cambiarCalificacionLocal = (
    idAlumno: string,
    idTrabajo: string,
    calificacion: string,
  ) => {
    const clave = crearClaveCalificacion(idAlumno, idTrabajo);

    setCalificaciones((calificacionesActuales) => ({
      ...calificacionesActuales,
      [clave]: calificacion,
    }));
  };

  const guardarCalificacion = async (
    idAlumno: string,
    idTrabajo: string,
    calificacion: string,
  ) => {
    const clave = crearClaveCalificacion(idAlumno, idTrabajo);

    if (celdasGuardando[clave]) {
      return;
    }

    const calificacionLimpia = calificacion.trim();

    setCeldasGuardando((estadoActual) => ({
      ...estadoActual,
      [clave]: true,
    }));

    try {
      const db = await ejecutarConTiempoMaximo(obtenerBaseDatos());

      if (!calificacionLimpia) {
        await ejecutarConTiempoMaximo(
          db.runAsync(
            `
              DELETE FROM calificaciones
              WHERE alumno = ?
                AND clase = ?
                AND trabajo = ?;
            `,
            [idAlumno, idClase, idTrabajo],
          ),
        );

        setCalificaciones((calificacionesActuales) => {
          const nuevasCalificaciones = {
            ...calificacionesActuales,
          };

          delete nuevasCalificaciones[clave];

          return nuevasCalificaciones;
        });
      } else {
        await ejecutarConTiempoMaximo(
          db.runAsync(
            `
              INSERT INTO calificaciones (
                alumno,
                clase,
                trabajo,
                calificacion
              )
              VALUES (?, ?, ?, ?)
              ON CONFLICT(alumno, trabajo)
              DO UPDATE SET
                clase = excluded.clase,
                calificacion = excluded.calificacion;
            `,
            [idAlumno, idClase, idTrabajo, calificacionLimpia],
          ),
        );

        setCalificaciones((calificacionesActuales) => ({
          ...calificacionesActuales,
          [clave]: calificacionLimpia,
        }));
      }
    } catch (error) {
      console.error("Error al guardar calificación:", error);

      Alert.alert(
        "Error",
        "No fue posible guardar la calificación. Inténtalo nuevamente.",
      );
    } finally {
      setCeldasGuardando((estadoActual) => {
        const nuevoEstado = {
          ...estadoActual,
        };

        delete nuevoEstado[clave];

        return nuevoEstado;
      });
    }
  };

  const anchoTabla =
    ANCHO_NUMERO + ANCHO_NOMBRE + ANCHO_TRABAJO * trabajos.length + ANCHO_TOTAL;

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: false,
        }}
      />

      <SafeAreaView
        edges={["top", "left", "right", "bottom"]}
        style={{
          flex: 1,
          backgroundColor: modoOscuro ? "#020617" : "#f8fafc",
        }}
      >
        <StatusBar
          style={modoOscuro ? "light" : "dark"}
          backgroundColor={modoOscuro ? "#020617" : "#f8fafc"}
          translucent={false}
        />

        <View className="flex-1 px-5 pb-4 pt-2">
          {/* Botón regresar y modo claro / oscuro */}
          <View className="flex-row items-center justify-between">
            <Pressable
              onPress={() => router.back()}
              accessibilityRole="button"
              accessibilityLabel="Regresar a la clase"
              className="h-11 w-11 items-center justify-center rounded-full bg-blue-100 active:opacity-70 dark:bg-slate-800"
            >
              <FontAwesomeIcon
                icon={faArrowLeft}
                size={20}
                color={modoOscuro ? "#60a5fa" : "#2563eb"}
              />
            </Pressable>

            <Pressable
              onPress={toggleColorScheme}
              accessibilityRole="button"
              accessibilityLabel="Cambiar modo de color"
              className="h-11 w-11 items-center justify-center rounded-full bg-blue-100 active:opacity-70 dark:bg-slate-800"
            >
              <FontAwesomeIcon
                icon={modoOscuro ? faSun : faMoon}
                size={20}
                color={modoOscuro ? "#facc15" : "#2563eb"}
              />
            </Pressable>
          </View>

          {/* Encabezado */}
          <View className="mt-3 items-center">
            <Text className="text-center text-3xl font-bold text-blue-600 dark:text-blue-400">
              Dory Teacher
            </Text>

            <Text className="mt-2 text-center text-xl font-bold text-black dark:text-white">
              {nombreClase}
            </Text>

            <Text className="mt-1 text-center text-base font-semibold text-slate-600 dark:text-slate-300">
              Calificaciones
            </Text>
          </View>

          {/* Motor de búsqueda */}
          <TextInput
            value={busquedaAlumno}
            onChangeText={setBusquedaAlumno}
            placeholder="Buscar alumno..."
            placeholderTextColor={modoOscuro ? "#94a3b8" : "#64748b"}
            autoCapitalize="words"
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Buscar alumnos"
            className="mt-5 min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base text-black dark:border-slate-700 dark:bg-slate-900 dark:text-white"
          />

          {/* Agregar trabajo o proyecto */}
          <View className="mt-3 items-end">
            <Pressable
              onPress={() => void agregarTrabajo()}
              disabled={agregandoTrabajo}
              accessibilityRole="button"
              accessibilityLabel="Agregar trabajo o proyecto"
              className="min-h-11 flex-row items-center justify-center rounded-xl bg-blue-600 px-4 active:opacity-70 disabled:opacity-60 dark:bg-blue-500"
            >
              {agregandoTrabajo ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <FontAwesomeIcon icon={faPlus} size={16} color="#ffffff" />
              )}

              <Text className="ml-2 font-bold text-white">
                Agregar trabajo/proyecto
              </Text>
            </Pressable>
          </View>

          {/* Contenido */}
          <View className="mt-4 flex-1">
            {cargando ? (
              <View className="flex-1 items-center justify-center">
                <ActivityIndicator
                  size="large"
                  color={modoOscuro ? "#60a5fa" : "#2563eb"}
                />
              </View>
            ) : alumnos.length === 0 ? (
              <View className="flex-1 items-center justify-center px-5">
                <Text className="text-center text-lg font-bold text-black dark:text-white">
                  No hay alumnos registrados
                </Text>

                <Text className="mt-2 text-center text-sm text-slate-500 dark:text-slate-400">
                  Agrega alumnos desde la pantalla Alumnos para capturar sus
                  calificaciones.
                </Text>
              </View>
            ) : alumnosFiltrados.length === 0 ? (
              <View className="flex-1 items-center justify-center px-5">
                <Text className="text-center text-lg font-bold text-black dark:text-white">
                  Sin resultados
                </Text>

                <Text className="mt-2 text-center text-sm text-slate-500 dark:text-slate-400">
                  No se encontraron alumnos con esa búsqueda.
                </Text>
              </View>
            ) : (
              <ScrollView
                horizontal
                nestedScrollEnabled
                showsHorizontalScrollIndicator
                style={{
                  flex: 1,
                }}
              >
                <View
                  style={{
                    width: anchoTabla,
                    flex: 1,
                  }}
                  className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"
                >
                  {/* Encabezados */}
                  <View className="flex-row bg-blue-50 dark:bg-slate-800">
                    <View
                      style={{
                        width: ANCHO_NUMERO,
                        minHeight: 74,
                      }}
                      className="items-center justify-center border-r border-slate-200 px-1 py-3 dark:border-slate-700"
                    >
                      <Text className="text-center text-sm font-bold text-slate-700 dark:text-slate-200">
                        N.º
                      </Text>
                    </View>

                    <View
                      style={{
                        width: ANCHO_NOMBRE,
                        minHeight: 74,
                      }}
                      className="items-center justify-center border-r border-slate-200 px-3 py-3 dark:border-slate-700"
                    >
                      <Text className="text-center text-sm font-bold text-slate-700 dark:text-slate-200">
                        Alumno
                      </Text>
                    </View>

                    {trabajos.map((trabajo) => (
                      <View
                        key={trabajo.id}
                        style={{
                          width: ANCHO_TRABAJO,
                          minHeight: 74,
                        }}
                        className="border-r border-slate-200 px-2 py-2 dark:border-slate-700"
                      >
                        <Pressable
                          onPress={() => abrirConfiguracionTrabajo(trabajo)}
                          accessibilityRole="button"
                          accessibilityLabel={`Configurar ${trabajo.nombre}`}
                          className="min-h-14 flex-1 items-center justify-center rounded-lg border border-blue-200 bg-white px-2 py-2 active:opacity-70 dark:border-slate-600 dark:bg-slate-900"
                        >
                          <Text
                            numberOfLines={2}
                            className="text-center text-sm font-bold text-black dark:text-white"
                          >
                            {trabajo.nombre}
                          </Text>

                          <Text className="mt-1 text-center text-xs font-semibold text-blue-600 dark:text-blue-400">
                            {formatearValor(Number(trabajo.valor ?? 0))}%
                          </Text>
                        </Pressable>
                      </View>
                    ))}

                    {/* Encabezado TOTAL permanente */}
                    <View
                      style={{
                        width: ANCHO_TOTAL,
                        minHeight: 74,
                      }}
                      className="items-center justify-center px-2 py-2"
                    >
                      <Text className="text-center text-base font-bold text-blue-700 dark:text-blue-300">
                        Total
                      </Text>
                    </View>
                  </View>

                  {/* Filas de alumnos */}
                  <ScrollView
                    nestedScrollEnabled
                    showsVerticalScrollIndicator
                    style={{
                      flex: 1,
                    }}
                  >
                    {alumnosFiltrados.map((alumno, indiceFiltrado) => {
                      const numeroAlumno =
                        numeroPorAlumno.get(alumno.id) ?? indiceFiltrado + 1;

                      const totalAlumno = totalesPorAlumno.get(alumno.id) ?? 0;

                      return (
                        <View
                          key={alumno.id}
                          className="flex-row border-t border-slate-200 dark:border-slate-700"
                        >
                          <View
                            style={{
                              width: ANCHO_NUMERO,
                              minHeight: 64,
                            }}
                            className="items-center justify-center border-r border-slate-200 px-1 dark:border-slate-700"
                          >
                            <View className="h-9 w-9 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-950">
                              <Text className="font-bold text-blue-600 dark:text-blue-400">
                                {numeroAlumno}
                              </Text>
                            </View>
                          </View>

                          <View
                            style={{
                              width: ANCHO_NOMBRE,
                              minHeight: 64,
                            }}
                            className="justify-center border-r border-slate-200 px-3 py-2 dark:border-slate-700"
                          >
                            <Text
                              numberOfLines={2}
                              className="text-sm font-medium text-black dark:text-white"
                            >
                              {alumno.nombre}
                            </Text>
                          </View>

                          {trabajos.map((trabajo) => {
                            const clave = crearClaveCalificacion(
                              alumno.id,
                              trabajo.id,
                            );

                            return (
                              <View
                                key={clave}
                                style={{
                                  width: ANCHO_TRABAJO,
                                  minHeight: 64,
                                }}
                                className="items-center justify-center border-r border-slate-200 px-2 py-2 dark:border-slate-700"
                              >
                                <View className="w-full flex-row items-center">
                                  <TextInput
                                    value={calificaciones[clave] ?? ""}
                                    onChangeText={(texto) =>
                                      cambiarCalificacionLocal(
                                        alumno.id,
                                        trabajo.id,
                                        texto,
                                      )
                                    }
                                    onBlur={() =>
                                      void guardarCalificacion(
                                        alumno.id,
                                        trabajo.id,
                                        calificaciones[clave] ?? "",
                                      )
                                    }
                                    placeholder="Calificación"
                                    placeholderTextColor={
                                      modoOscuro ? "#64748b" : "#94a3b8"
                                    }
                                    autoCorrect={false}
                                    maxLength={12}
                                    accessibilityLabel={`Calificación de ${alumno.nombre} en ${trabajo.nombre}`}
                                    className="min-h-11 flex-1 rounded-lg border border-slate-300 bg-white px-2 py-2 text-center text-base font-semibold text-black dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                                  />

                                  {celdasGuardando[clave] ? (
                                    <ActivityIndicator
                                      style={{
                                        marginLeft: 5,
                                      }}
                                      size="small"
                                      color={modoOscuro ? "#60a5fa" : "#2563eb"}
                                    />
                                  ) : null}
                                </View>
                              </View>
                            );
                          })}

                          {/* Total del alumno */}
                          <View
                            style={{
                              width: ANCHO_TOTAL,
                              minHeight: 64,
                            }}
                            className="items-center justify-center bg-blue-50 px-2 py-2 dark:bg-slate-800"
                          >
                            <Text className="text-center text-base font-bold text-blue-700 dark:text-blue-300">
                              {totalAlumno.toFixed(2)}
                            </Text>
                          </View>
                        </View>
                      );
                    })}
                  </ScrollView>
                </View>
              </ScrollView>
            )}
          </View>
        </View>
      </SafeAreaView>

      {/* Ventana para editar/configurar/eliminar trabajo */}
      <Modal
        visible={trabajoConfigurando !== null}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={cerrarConfiguracionTrabajo}
      >
        <View
          style={{
            flex: 1,
            justifyContent: "center",
            paddingHorizontal: 22,
            backgroundColor: "rgba(0, 0, 0, 0.55)",
          }}
        >
          <View
            style={{
              backgroundColor: modoOscuro ? "#0f172a" : "#ffffff",
              borderRadius: 20,
              padding: 20,
            }}
          >
            <Text
              style={{
                color: modoOscuro ? "#ffffff" : "#0f172a",
                fontSize: 21,
                fontWeight: "700",
                textAlign: "center",
              }}
            >
              Configurar trabajo
            </Text>

            <Text
              style={{
                marginTop: 20,
                marginBottom: 7,
                color: modoOscuro ? "#e2e8f0" : "#334155",
                fontSize: 14,
                fontWeight: "600",
              }}
            >
              Nombre del trabajo
            </Text>

            <TextInput
              value={nombreTrabajoConfigurando}
              onChangeText={setNombreTrabajoConfigurando}
              placeholder="Nombre del trabajo o proyecto"
              placeholderTextColor={modoOscuro ? "#64748b" : "#94a3b8"}
              autoCapitalize="sentences"
              autoCorrect
              editable={!guardandoConfiguracion && !eliminandoTrabajo}
              selectTextOnFocus
              style={{
                minHeight: 48,
                borderWidth: 1,
                borderColor: modoOscuro ? "#475569" : "#cbd5e1",
                borderRadius: 12,
                paddingHorizontal: 13,
                paddingVertical: 10,
                color: modoOscuro ? "#ffffff" : "#000000",
                backgroundColor: modoOscuro ? "#1e293b" : "#ffffff",
                fontSize: 16,
              }}
            />

            <Text
              style={{
                marginTop: 17,
                marginBottom: 7,
                color: modoOscuro ? "#e2e8f0" : "#334155",
                fontSize: 14,
                fontWeight: "600",
              }}
            >
              Valor del trabajo (%)
            </Text>

            <TextInput
              value={valorTrabajoConfigurando}
              onChangeText={setValorTrabajoConfigurando}
              placeholder="Ejemplo: 20"
              placeholderTextColor={modoOscuro ? "#64748b" : "#94a3b8"}
              keyboardType="decimal-pad"
              autoCorrect={false}
              editable={!guardandoConfiguracion && !eliminandoTrabajo}
              selectTextOnFocus
              maxLength={6}
              style={{
                minHeight: 48,
                borderWidth: 1,
                borderColor: modoOscuro ? "#475569" : "#cbd5e1",
                borderRadius: 12,
                paddingHorizontal: 13,
                paddingVertical: 10,
                color: modoOscuro ? "#ffffff" : "#000000",
                backgroundColor: modoOscuro ? "#1e293b" : "#ffffff",
                fontSize: 16,
              }}
            />

            <Text
              style={{
                marginTop: 8,
                color: modoOscuro ? "#94a3b8" : "#64748b",
                fontSize: 12,
                lineHeight: 17,
              }}
            >
              El valor debe estar entre 0 y 100. Este porcentaje se utiliza
              automáticamente para calcular la columna Total.
            </Text>

            {/* Eliminar trabajo */}
            <Pressable
              onPress={confirmarEliminarTrabajo}
              disabled={guardandoConfiguracion || eliminandoTrabajo}
              style={{
                marginTop: 22,
                minHeight: 46,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: modoOscuro ? "#7f1d1d" : "#fecaca",
                backgroundColor: modoOscuro ? "#450a0a" : "#fef2f2",
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                opacity: guardandoConfiguracion || eliminandoTrabajo ? 0.6 : 1,
              }}
            >
              {eliminandoTrabajo ? (
                <ActivityIndicator size="small" color="#dc2626" />
              ) : (
                <FontAwesomeIcon icon={faTrash} size={16} color="#dc2626" />
              )}

              <Text
                style={{
                  marginLeft: 8,
                  color: "#dc2626",
                  fontSize: 15,
                  fontWeight: "700",
                }}
              >
                Eliminar trabajo
              </Text>
            </Pressable>

            <View
              style={{
                marginTop: 18,
                flexDirection: "row",
              }}
            >
              <Pressable
                onPress={cerrarConfiguracionTrabajo}
                disabled={guardandoConfiguracion || eliminandoTrabajo}
                style={{
                  flex: 1,
                  minHeight: 46,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: modoOscuro ? "#475569" : "#cbd5e1",
                  alignItems: "center",
                  justifyContent: "center",
                  marginRight: 7,
                  opacity:
                    guardandoConfiguracion || eliminandoTrabajo ? 0.6 : 1,
                }}
              >
                <Text
                  style={{
                    color: modoOscuro ? "#e2e8f0" : "#334155",
                    fontSize: 15,
                    fontWeight: "700",
                  }}
                >
                  Cancelar
                </Text>
              </Pressable>

              <Pressable
                onPress={() => void guardarConfiguracionTrabajo()}
                disabled={guardandoConfiguracion || eliminandoTrabajo}
                style={{
                  flex: 1,
                  minHeight: 46,
                  borderRadius: 12,
                  backgroundColor: "#2563eb",
                  alignItems: "center",
                  justifyContent: "center",
                  marginLeft: 7,
                  opacity:
                    guardandoConfiguracion || eliminandoTrabajo ? 0.6 : 1,
                }}
              >
                {guardandoConfiguracion ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Text
                    style={{
                      color: "#ffffff",
                      fontSize: 15,
                      fontWeight: "700",
                    }}
                  >
                    Guardar
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}
