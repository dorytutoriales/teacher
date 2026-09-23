import { ejecutarConTiempoMaximo, obtenerBaseDatos } from "@/lib/database";
import {
    faArrowLeft,
    faCheck,
    faMoon,
    faSun,
    faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-native-fontawesome";
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

type ParametrosAsistencias = {
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

type EstadoAsistencia = "presente" | "falta";

type RegistroAsistencia = {
  alumno: string;
  fecha: string;
  estado: string;
};

const DIAS_SEMANA = [
  "Domingo",
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
];

const MESES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

const MESES_CORTOS = [
  "Ene",
  "Feb",
  "Mar",
  "Abr",
  "May",
  "Jun",
  "Jul",
  "Ago",
  "Sep",
  "Oct",
  "Nov",
  "Dic",
];

const ANCHO_NUMERO = 55;
const ANCHO_NOMBRE = 200;
const ANCHO_FECHA = 96;

const normalizarTexto = (texto: string) => {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
};

const formatearFechaBaseDatos = (fecha: Date) => {
  const anio = fecha.getFullYear();
  const mes = String(fecha.getMonth() + 1).padStart(2, "0");
  const dia = String(fecha.getDate()).padStart(2, "0");

  return `${anio}-${mes}-${dia}`;
};

/*
 * Devuelve el lunes correspondiente a cualquier fecha.
 *
 * Se utiliza mediodía para evitar cambios inesperados
 * provocados por horario de verano o zona horaria.
 */
const obtenerLunesSemana = (fecha: Date) => {
  const lunes = new Date(
    fecha.getFullYear(),
    fecha.getMonth(),
    fecha.getDate(),
    12,
    0,
    0,
    0,
  );

  const diaActual = lunes.getDay();
  const diasDesdeLunes = diaActual === 0 ? 6 : diaActual - 1;

  lunes.setDate(lunes.getDate() - diasDesdeLunes);
  return lunes;
};

/*
 * Obtiene los siete días de una semana iniciando
 * siempre en lunes.
 */
const obtenerDiasSemana = (lunesSemana: Date) => {
  return Array.from({ length: 7 }, (_, indice) => {
    return new Date(
      lunesSemana.getFullYear(),
      lunesSemana.getMonth(),
      lunesSemana.getDate() + indice,
      12,
      0,
      0,
      0,
    );
  });
};

const obtenerDiasSemanaActual = () => {
  return obtenerDiasSemana(obtenerLunesSemana(new Date()));
};

/*
 * Suma o resta semanas completas.
 */
const sumarSemanas = (fecha: Date, cantidadSemanas: number) => {
  return new Date(
    fecha.getFullYear(),
    fecha.getMonth(),
    fecha.getDate() + cantidadSemanas * 7,
    12,
    0,
    0,
    0,
  );
};

/*
 * Obtiene todas las semanas que tienen por lo menos
 * un día dentro del año seleccionado.
 *
 * De esta manera también se muestran correctamente
 * semanas que comienzan a finales de diciembre o
 * terminan a principios de enero.
 */
const obtenerSemanasAnio = (anio: number) => {
  const primerDiaAnio = new Date(anio, 0, 1, 12, 0, 0, 0);
  const ultimoDiaAnio = new Date(anio, 11, 31, 12, 0, 0, 0);

  let lunes = obtenerLunesSemana(primerDiaAnio);
  const semanas: Date[] = [];

  while (lunes <= ultimoDiaAnio) {
    semanas.push(
      new Date(
        lunes.getFullYear(),
        lunes.getMonth(),
        lunes.getDate(),
        12,
        0,
        0,
        0,
      ),
    );

    lunes = sumarSemanas(lunes, 1);
  }

  return semanas;
};

/*
 * Texto completo mostrado dentro del selector.
 */
const formatearRangoSemana = (lunes: Date) => {
  const dias = obtenerDiasSemana(lunes);
  const domingo = dias[6];

  if (
    lunes.getFullYear() === domingo.getFullYear() &&
    lunes.getMonth() === domingo.getMonth()
  ) {
    return `${lunes.getDate()} al ${domingo.getDate()} de ${
      MESES[lunes.getMonth()]
    } de ${lunes.getFullYear()}`;
  }

  if (lunes.getFullYear() === domingo.getFullYear()) {
    return `${lunes.getDate()} de ${MESES[lunes.getMonth()]} al ${domingo.getDate()} de ${MESES[domingo.getMonth()]} de ${domingo.getFullYear()}`;
  }

  return `${lunes.getDate()} de ${
    MESES[lunes.getMonth()]
  } de ${lunes.getFullYear()} al ${domingo.getDate()} de ${
    MESES[domingo.getMonth()]
  } de ${domingo.getFullYear()}`;
};

/*
 * Texto corto mostrado junto al botón Semanas.
 */
const formatearRangoSemanaCorto = (lunes: Date) => {
  const domingo = obtenerDiasSemana(lunes)[6];

  return `${lunes.getDate()} ${
    MESES_CORTOS[lunes.getMonth()]
  } - ${domingo.getDate()} ${MESES_CORTOS[domingo.getMonth()]}`;
};

const crearClaveAsistencia = (idAlumno: string, fecha: string) => {
  return `${idAlumno}__${fecha}`;
};

export default function PantallaAsistencias() {
  const router = useRouter();
  const parametros = useLocalSearchParams<ParametrosAsistencias>();
  const { colorScheme, toggleColorScheme } = useColorScheme();
  const modoOscuro = colorScheme === "dark";

  const [alumnos, setAlumnos] = useState<Alumno[]>([]);
  const [busquedaAlumno, setBusquedaAlumno] = useState("");
  const [cargando, setCargando] = useState(true);
  const [asistencias, setAsistencias] = useState<
    Record<string, EstadoAsistencia>
  >({});
  const [celdasGuardando, setCeldasGuardando] = useState<
    Record<string, boolean>
  >({});

  /*
   * Semana que se está mostrando actualmente.
   *
   * Al abrir la pantalla comienza siempre con
   * la semana actual.
   */
  const [lunesSemanaSeleccionada, setLunesSemanaSeleccionada] = useState<Date>(
    () => obtenerLunesSemana(new Date()),
  );

  const [selectorSemanasVisible, setSelectorSemanasVisible] = useState(false);

  /*
   * Año mostrado dentro del selector de semanas.
   */
  const [anioSelectorSemanas, setAnioSelectorSemanas] = useState(() => {
    const semanaActual = obtenerDiasSemanaActual();
    return semanaActual[3].getFullYear();
  });

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

  /*
   * Los días cambian automáticamente cuando el usuario
   * selecciona otra semana.
   */
  const diasSemana = useMemo(() => {
    return obtenerDiasSemana(lunesSemanaSeleccionada);
  }, [lunesSemanaSeleccionada]);

  const fechaInicial = useMemo(() => {
    return formatearFechaBaseDatos(diasSemana[0]);
  }, [diasSemana]);

  const fechaFinal = useMemo(() => {
    return formatearFechaBaseDatos(diasSemana[diasSemana.length - 1]);
  }, [diasSemana]);

  /*
   * Semanas disponibles dentro del año mostrado
   * en el selector.
   */
  const semanasSelector = useMemo(() => {
    return obtenerSemanasAnio(anioSelectorSemanas);
  }, [anioSelectorSemanas]);

  /*
   * Abre el selector mostrando el año correspondiente
   * a la semana que actualmente está seleccionada.
   */
  const abrirSelectorSemanas = () => {
    const dias = obtenerDiasSemana(lunesSemanaSeleccionada);

    /*
     * Se utiliza el jueves de la semana para identificar
     * correctamente el año cuando la semana está entre
     * diciembre y enero.
     */
    setAnioSelectorSemanas(dias[3].getFullYear());
    setSelectorSemanasVisible(true);
  };

  /*
   * Cambia la semana de asistencia.
   *
   * El useEffect que carga los datos detectará automáticamente
   * el nuevo intervalo fechaInicial / fechaFinal y recuperará
   * de SQLite las asistencias guardadas para esa semana.
   */
  const seleccionarSemana = (lunes: Date) => {
    setLunesSemanaSeleccionada(
      new Date(
        lunes.getFullYear(),
        lunes.getMonth(),
        lunes.getDate(),
        12,
        0,
        0,
        0,
      ),
    );
    setSelectorSemanasVisible(false);
  };

  /*
   * Carga los alumnos de la clase y las asistencias
   * correspondientes a la semana seleccionada.
   */
  useEffect(() => {
    let componenteActivo = true;

    const cargarDatos = async () => {
      setCargando(true);

      try {
        if (!idClase) {
          if (componenteActivo) {
            setAlumnos([]);
            setAsistencias({});
          }

          return;
        }

        const db = await ejecutarConTiempoMaximo(obtenerBaseDatos());

        /*
         * La tabla alumnos ya existe normalmente.
         *
         * Se mantiene CREATE TABLE IF NOT EXISTS para que
         * esta pantalla también pueda funcionar si se abre
         * antes de entrar a la pantalla de Alumnos.
         *
         * La tabla asistencias almacena:
         *
         * - alumno
         * - clase
         * - fecha
         * - estado
         *
         * La combinación alumno + clase + fecha es única.
         * Esto permite recuperar cualquier semana posteriormente.
         */
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

            CREATE TABLE IF NOT EXISTS asistencias (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              alumno TEXT NOT NULL,
              clase TEXT NOT NULL,
              fecha TEXT NOT NULL,
              estado TEXT NOT NULL,
              UNIQUE(alumno, clase, fecha),
              FOREIGN KEY (alumno)
                REFERENCES alumnos(id)
                ON DELETE CASCADE,
              FOREIGN KEY (clase)
                REFERENCES clase(id)
                ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS indice_asistencias_clase_fecha
            ON asistencias(clase, fecha);

            CREATE INDEX IF NOT EXISTS indice_asistencias_alumno
            ON asistencias(alumno);
          `),
        );

        /*
         * Compatibilidad con bases de datos antiguas que
         * todavía no tengan la columna posicion.
         */
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

        /*
         * Solamente se recuperan las asistencias correspondientes
         * a la semana seleccionada.
         */
        const registrosGuardados = await ejecutarConTiempoMaximo(
          db.getAllAsync<RegistroAsistencia>(
            `
              SELECT
                alumno,
                fecha,
                estado
              FROM asistencias
              WHERE clase = ?
                AND fecha >= ?
                AND fecha <= ?;
            `,
            [idClase, fechaInicial, fechaFinal],
          ),
        );

        const asistenciasCargadas: Record<string, EstadoAsistencia> = {};

        registrosGuardados.forEach((registro) => {
          if (registro.estado === "presente" || registro.estado === "falta") {
            const clave = crearClaveAsistencia(registro.alumno, registro.fecha);
            asistenciasCargadas[clave] = registro.estado;
          }
        });

        if (componenteActivo) {
          setAlumnos(alumnosGuardados);
          setAsistencias(asistenciasCargadas);
        }
      } catch (error) {
        console.error("Error al cargar asistencias:", error);

        if (componenteActivo) {
          setAlumnos([]);
          setAsistencias({});
        }

        Alert.alert(
          "Error",
          "No fue posible cargar los alumnos y las asistencias.",
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
  }, [fechaFinal, fechaInicial, idClase]);

  /*
   * Conserva el número progresivo original del alumno
   * incluso cuando se utiliza el buscador.
   */
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

  /*
   * Motor de búsqueda.
   */
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

  const actualizarAsistenciaLocal = (
    clave: string,
    estado: EstadoAsistencia | undefined,
  ) => {
    setAsistencias((asistenciasActuales) => {
      const nuevasAsistencias = {
        ...asistenciasActuales,
      };

      if (estado) {
        nuevasAsistencias[clave] = estado;
      } else {
        delete nuevasAsistencias[clave];
      }

      return nuevasAsistencias;
    });
  };

  /*
   * Cada toque cambia:
   *
   * vacío -> presente
   * presente -> falta
   * falta -> vacío
   *
   * Cada modificación se guarda inmediatamente en SQLite.
   */
  const cambiarAsistencia = async (alumno: Alumno, fecha: Date) => {
    const fechaTexto = formatearFechaBaseDatos(fecha);
    const clave = crearClaveAsistencia(alumno.id, fechaTexto);

    if (celdasGuardando[clave]) {
      return;
    }

    const estadoAnterior = asistencias[clave];
    let estadoNuevo: EstadoAsistencia | undefined;

    if (!estadoAnterior) {
      estadoNuevo = "presente";
    } else if (estadoAnterior === "presente") {
      estadoNuevo = "falta";
    } else {
      estadoNuevo = undefined;
    }

    setCeldasGuardando((celdasActuales) => ({
      ...celdasActuales,
      [clave]: true,
    }));

    /*
     * Actualización visual inmediata.
     */
    actualizarAsistenciaLocal(clave, estadoNuevo);

    try {
      const db = await ejecutarConTiempoMaximo(obtenerBaseDatos());

      /*
       * Si vuelve a estado vacío se elimina el registro.
       */
      if (!estadoNuevo) {
        await ejecutarConTiempoMaximo(
          db.runAsync(
            `
              DELETE FROM asistencias
              WHERE alumno = ?
                AND clase = ?
                AND fecha = ?;
            `,
            [alumno.id, idClase, fechaTexto],
          ),
        );
      } else {
        /*
         * INSERT ... ON CONFLICT garantiza persistencia
         * y permite modificar una asistencia ya existente
         * sin crear registros duplicados.
         */
        await ejecutarConTiempoMaximo(
          db.runAsync(
            `
              INSERT INTO asistencias (
                alumno,
                clase,
                fecha,
                estado
              )
              VALUES (?, ?, ?, ?)
              ON CONFLICT(alumno, clase, fecha)
              DO UPDATE SET
                estado = excluded.estado;
            `,
            [alumno.id, idClase, fechaTexto, estadoNuevo],
          ),
        );
      }
    } catch (error) {
      console.error("Error al guardar asistencia:", error);

      /*
       * Si SQLite falla, se recupera el estado anterior
       * para que la pantalla nunca muestre un dato que no
       * haya sido guardado.
       */
      actualizarAsistenciaLocal(clave, estadoAnterior);

      Alert.alert(
        "Error",
        "No fue posible guardar la asistencia. Inténtalo nuevamente.",
      );
    } finally {
      setCeldasGuardando((celdasActuales) => {
        const nuevasCeldas = {
          ...celdasActuales,
        };

        delete nuevasCeldas[clave];
        return nuevasCeldas;
      });
    }
  };

  const anchoTabla =
    ANCHO_NUMERO + ANCHO_NOMBRE + ANCHO_FECHA * diasSemana.length;

  const claveSemanaSeleccionada = formatearFechaBaseDatos(
    lunesSemanaSeleccionada,
  );

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: false,
        }}
      />

      {/* Selector de semanas */}
      <Modal
        visible={selectorSemanasVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectorSemanasVisible(false)}
      >
        <View
          style={{
            flex: 1,
            justifyContent: "center",
            paddingHorizontal: 20,
            backgroundColor: "rgba(0, 0, 0, 0.50)",
          }}
        >
          <View
            style={{
              maxHeight: "82%",
            }}
            className="overflow-hidden rounded-3xl bg-white dark:bg-slate-900"
          >
            {/* Encabezado del selector */}
            <View className="border-b border-slate-200 px-5 pb-4 pt-5 dark:border-slate-700">
              <Text className="text-center text-xl font-bold text-black dark:text-white">
                Seleccionar semana
              </Text>
              <Text className="mt-1 text-center text-sm text-slate-500 dark:text-slate-400">
                Elige la semana en la que deseas tomar asistencia
              </Text>
            </View>

            {/* Selector de año */}
            <View className="flex-row items-center justify-between border-b border-slate-200 px-5 py-3 dark:border-slate-700">
              <Pressable
                onPress={() =>
                  setAnioSelectorSemanas((anioActual) => anioActual - 1)
                }
                accessibilityRole="button"
                accessibilityLabel="Año anterior"
                className="h-10 w-10 items-center justify-center rounded-full bg-blue-100 active:opacity-70 dark:bg-slate-800"
              >
                <Text className="text-3xl font-bold leading-8 text-blue-600 dark:text-blue-400">
                  ‹
                </Text>
              </Pressable>

              <Text className="text-lg font-bold text-black dark:text-white">
                {anioSelectorSemanas}
              </Text>

              <Pressable
                onPress={() =>
                  setAnioSelectorSemanas((anioActual) => anioActual + 1)
                }
                accessibilityRole="button"
                accessibilityLabel="Año siguiente"
                className="h-10 w-10 items-center justify-center rounded-full bg-blue-100 active:opacity-70 dark:bg-slate-800"
              >
                <Text className="text-3xl font-bold leading-8 text-blue-600 dark:text-blue-400">
                  ›
                </Text>
              </Pressable>
            </View>

            {/* Lista de semanas */}
            <ScrollView
              showsVerticalScrollIndicator
              contentContainerStyle={{
                paddingHorizontal: 16,
                paddingBottom: 8,
                paddingTop: 12,
              }}
            >
              {semanasSelector.map((lunes, indice) => {
                const clave = formatearFechaBaseDatos(lunes);
                const seleccionada = clave === claveSemanaSeleccionada;
                const dias = obtenerDiasSemana(lunes);

                const perteneceAlAnio = dias.some(
                  (fecha) => fecha.getFullYear() === anioSelectorSemanas,
                );

                if (!perteneceAlAnio) {
                  return null;
                }

                return (
                  <Pressable
                    key={`${anioSelectorSemanas}-${clave}`}
                    onPress={() => seleccionarSemana(lunes)}
                    accessibilityRole="button"
                    accessibilityLabel={`Seleccionar semana del ${formatearRangoSemana(
                      lunes,
                    )}`}
                    className={`mb-2 rounded-2xl border px-4 py-3 active:opacity-70 ${
                      seleccionada
                        ? "border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-950"
                        : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800"
                    }`}
                  >
                    <View className="flex-row items-center justify-between">
                      <View className="flex-1 pr-3">
                        <Text
                          className={`text-sm font-bold ${
                            seleccionada
                              ? "text-blue-600 dark:text-blue-400"
                              : "text-black dark:text-white"
                          }`}
                        >
                          Semana {indice + 1}
                        </Text>
                        <Text className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                          {formatearRangoSemana(lunes)}
                        </Text>
                      </View>

                      {seleccionada ? (
                        <View className="h-8 w-8 items-center justify-center rounded-full bg-blue-600">
                          <FontAwesomeIcon
                            icon={faCheck}
                            size={16}
                            color="#ffffff"
                          />
                        </View>
                      ) : null}
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>

            {/* Semana actual */}
            <View className="border-t border-slate-200 px-4 py-3 dark:border-slate-700">
              <Pressable
                onPress={() =>
                  seleccionarSemana(obtenerLunesSemana(new Date()))
                }
                accessibilityRole="button"
                accessibilityLabel="Ir a la semana actual"
                className="min-h-11 items-center justify-center rounded-xl bg-blue-600 px-4 active:opacity-70"
              >
                <Text className="font-bold text-white">Semana actual</Text>
              </Pressable>

              <Pressable
                onPress={() => setSelectorSemanasVisible(false)}
                accessibilityRole="button"
                accessibilityLabel="Cerrar selector de semanas"
                className="mt-2 min-h-11 items-center justify-center rounded-xl bg-slate-100 px-4 active:opacity-70 dark:bg-slate-800"
              >
                <Text className="font-semibold text-slate-700 dark:text-slate-200">
                  Cerrar
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

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
              Asistencias
            </Text>
          </View>

          {/* Selector de semana colocado fuera de la tabla */}
          <View className="mt-4 flex-row items-center justify-center">
            <Pressable
              onPress={abrirSelectorSemanas}
              accessibilityRole="button"
              accessibilityLabel="Seleccionar semana de asistencia"
              className="min-h-11 items-center justify-center rounded-xl bg-blue-600 px-5 active:opacity-70 dark:bg-blue-500"
            >
              <Text className="text-center text-sm font-bold text-white">
                Semanas
              </Text>
            </Pressable>

            <View className="ml-3 min-h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 dark:border-slate-700 dark:bg-slate-900">
              <Text className="text-center text-sm font-semibold text-slate-700 dark:text-slate-200">
                {formatearRangoSemanaCorto(lunesSemanaSeleccionada)}
              </Text>
            </View>
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
            className="mt-4 min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base text-black dark:border-slate-700 dark:bg-slate-900 dark:text-white"
          />

          {/* Explicación de las casillas */}
          <View className="mt-3 rounded-xl bg-blue-50 px-4 py-3 dark:bg-slate-900">
            <Text className="text-center text-sm text-slate-600 dark:text-slate-300">
              Toca una casilla: vacío → ✓ presente → ✕ falta → vacío
            </Text>
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
                  Agrega alumnos desde la pantalla Alumnos para tomar
                  asistencia.
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
                    {/* Número */}
                    <View
                      style={{
                        width: ANCHO_NUMERO,
                      }}
                      className="items-center justify-center border-r border-slate-200 px-1 py-3 dark:border-slate-700"
                    >
                      <Text className="text-center text-sm font-bold text-slate-700 dark:text-slate-200">
                        N.º
                      </Text>
                    </View>

                    {/* Alumno */}
                    <View
                      style={{
                        width: ANCHO_NOMBRE,
                      }}
                      className="justify-center border-r border-slate-200 px-3 py-3 dark:border-slate-700"
                    >
                      <Text className="text-center text-sm font-bold text-slate-700 dark:text-slate-200">
                        Alumno
                      </Text>
                    </View>

                    {/* Días de la semana */}
                    {diasSemana.map((fecha) => {
                      const fechaTexto = formatearFechaBaseDatos(fecha);

                      return (
                        <View
                          key={fechaTexto}
                          style={{
                            width: ANCHO_FECHA,
                          }}
                          className="items-center justify-center border-r border-slate-200 px-2 py-3 dark:border-slate-700"
                        >
                          <Text className="text-center text-xs font-bold text-blue-600 dark:text-blue-400">
                            {DIAS_SEMANA[fecha.getDay()]}
                          </Text>
                          <Text className="mt-1 text-center text-lg font-bold text-black dark:text-white">
                            {fecha.getDate()}
                          </Text>

                          <Text className="text-center text-xs text-slate-600 dark:text-slate-300">
                            {MESES[fecha.getMonth()]}
                          </Text>
                          <Text className="text-center text-xs text-slate-500 dark:text-slate-400">
                            {fecha.getFullYear()}
                          </Text>
                        </View>
                      );
                    })}
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

                      return (
                        <View
                          key={alumno.id}
                          className="flex-row border-t border-slate-200 dark:border-slate-700"
                        >
                          {/* Número progresivo */}
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

                          {/* Nombre */}
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

                          {/* Casillas de asistencia */}
                          {diasSemana.map((fecha) => {
                            const fechaTexto = formatearFechaBaseDatos(fecha);
                            const clave = crearClaveAsistencia(
                              alumno.id,
                              fechaTexto,
                            );
                            const estado = asistencias[clave];
                            const guardando = Boolean(celdasGuardando[clave]);

                            return (
                              <View
                                key={clave}
                                style={{
                                  width: ANCHO_FECHA,
                                  minHeight: 64,
                                }}
                                className="items-center justify-center border-r border-slate-200 dark:border-slate-700"
                              >
                                <Pressable
                                  onPress={() =>
                                    void cambiarAsistencia(alumno, fecha)
                                  }
                                  disabled={guardando}
                                  accessibilityRole="button"
                                  accessibilityLabel={
                                    estado === "presente"
                                      ? `${alumno.nombre}, presente el ${fechaTexto}`
                                      : estado === "falta"
                                        ? `${alumno.nombre}, falta el ${fechaTexto}`
                                        : `${alumno.nombre}, sin asistencia registrada el ${fechaTexto}`
                                  }
                                  className={`h-10 w-10 items-center justify-center rounded-lg border-2 active:opacity-60 ${
                                    estado === "presente"
                                      ? "border-green-500 bg-green-50 dark:bg-green-950"
                                      : estado === "falta"
                                        ? "border-red-500 bg-red-50 dark:bg-red-950"
                                        : "border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-800"
                                  }`}
                                >
                                  {guardando ? (
                                    <ActivityIndicator
                                      size="small"
                                      color={modoOscuro ? "#60a5fa" : "#2563eb"}
                                    />
                                  ) : estado === "presente" ? (
                                    <FontAwesomeIcon
                                      icon={faCheck}
                                      size={21}
                                      color="#16a34a"
                                    />
                                  ) : estado === "falta" ? (
                                    <FontAwesomeIcon
                                      icon={faXmark}
                                      size={22}
                                      color="#dc2626"
                                    />
                                  ) : null}
                                </Pressable>
                              </View>
                            );
                          })}
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
    </>
  );
}
