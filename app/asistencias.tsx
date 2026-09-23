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

const obtenerDiasSemanaActual = () => {
  const hoy = new Date();

  const lunes = new Date(
    hoy.getFullYear(),
    hoy.getMonth(),
    hoy.getDate(),
    12,
    0,
    0,
    0,
  );

  const diaActual = lunes.getDay();

  const diasDesdeLunes = diaActual === 0 ? 6 : diaActual - 1;

  lunes.setDate(lunes.getDate() - diasDesdeLunes);

  return Array.from({ length: 7 }, (_, indice) => {
    return new Date(
      lunes.getFullYear(),
      lunes.getMonth(),
      lunes.getDate() + indice,
      12,
      0,
      0,
      0,
    );
  });
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

  const diasSemana = useMemo(() => {
    return obtenerDiasSemanaActual();
  }, []);

  const fechaInicial = useMemo(() => {
    return formatearFechaBaseDatos(diasSemana[0]);
  }, [diasSemana]);

  const fechaFinal = useMemo(() => {
    return formatearFechaBaseDatos(diasSemana[diasSemana.length - 1]);
  }, [diasSemana]);

  /*
   * Carga los alumnos de la clase y las asistencias
   * correspondientes a la semana actual.
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
         * Se mantiene CREATE TABLE IF NOT EXISTS para que la pantalla
         * también funcione si se abre antes de entrar a Alumnos.
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
         * Compatibilidad con bases de datos antiguas
         * que todavía no tengan la columna posicion.
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
              Asistencias
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
