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

type TipoEvaluacion = "numerica" | "rubrica" | "verdadero_falso";

type RubroEvaluacion = {
  id: string;
  nombre: string;
  puntaje: number;
};

type RubroConfiguracion = {
  id: string;
  nombre: string;
  puntaje: string;
};

type TrabajoCalificacion = {
  id: string;
  clase: string;
  nombre: string;
  posicion: number;
  valor: number;
  calificacion_minima: number;
  calificacion_maxima: number;
  tipo_evaluacion: TipoEvaluacion;
  rubrica_json: string;
};

type RegistroCalificacion = {
  alumno: string;
  trabajo: string;
  calificacion: string;
};

type SeleccionCalificacion = {
  alumno: Alumno;
  trabajo: TrabajoCalificacion;
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

const normalizarTipoEvaluacion = (tipo: unknown): TipoEvaluacion => {
  if (tipo === "rubrica" || tipo === "verdadero_falso") {
    return tipo;
  }

  return "numerica";
};

const crearRubricaPredeterminada = (
  calificacionMinima: number,
  calificacionMaxima: number,
): RubroEvaluacion[] => {
  const minimo = Number.isFinite(calificacionMinima) ? calificacionMinima : 0;
  const maximo =
    Number.isFinite(calificacionMaxima) && calificacionMaxima > minimo
      ? calificacionMaxima
      : 10;

  const rango = maximo - minimo;

  const insuficiente = minimo + rango * 0.5;
  const suficiente = minimo + rango * 0.7;

  return [
    {
      id: "insuficiente",
      nombre: "Insuficiente",
      puntaje: Number(insuficiente.toFixed(2)),
    },
    {
      id: "suficiente",
      nombre: "Suficiente",
      puntaje: Number(suficiente.toFixed(2)),
    },
    {
      id: "excelente",
      nombre: "Excelente",
      puntaje: Number(maximo.toFixed(2)),
    },
  ];
};

const obtenerRubricaTrabajo = (trabajo: TrabajoCalificacion) => {
  try {
    const rubrica = JSON.parse(trabajo.rubrica_json || "[]") as unknown;

    if (Array.isArray(rubrica)) {
      const rubrosValidos = rubrica
        .map((rubro) => {
          if (!rubro || typeof rubro !== "object") {
            return null;
          }

          const rubroObjeto = rubro as Record<string, unknown>;
          const id = String(rubroObjeto.id ?? "").trim();
          const nombre = String(rubroObjeto.nombre ?? "").trim();
          const puntaje = Number(rubroObjeto.puntaje);

          if (!id || !nombre || !Number.isFinite(puntaje)) {
            return null;
          }

          return {
            id,
            nombre,
            puntaje,
          } satisfies RubroEvaluacion;
        })
        .filter((rubro): rubro is RubroEvaluacion => rubro !== null);

      if (rubrosValidos.length > 0) {
        return rubrosValidos;
      }
    }
  } catch (error) {
    console.error("Error al leer la rúbrica del trabajo:", error);
  }

  return crearRubricaPredeterminada(
    Number(trabajo.calificacion_minima ?? 0),
    Number(trabajo.calificacion_maxima ?? 10),
  );
};

const obtenerPuntajeCalificacion = (
  trabajo: TrabajoCalificacion,
  calificacionGuardada: string,
) => {
  const valor = calificacionGuardada.trim();

  if (!valor) {
    return null;
  }

  if (valor === "verdadero") {
    return Number(trabajo.calificacion_maxima ?? 10);
  }

  if (valor === "falso") {
    return Number(trabajo.calificacion_minima ?? 0);
  }

  if (valor.startsWith("rubrica:")) {
    const idRubro = valor.slice("rubrica:".length);
    const rubro = obtenerRubricaTrabajo(trabajo).find(
      (elemento) => elemento.id === idRubro,
    );

    if (rubro) {
      return rubro.puntaje;
    }

    return null;
  }

  return convertirTextoANumero(valor);
};

const obtenerTextoEntradaNumerica = (
  trabajo: TrabajoCalificacion,
  calificacionGuardada: string,
) => {
  const valor = calificacionGuardada.trim();

  if (!valor) {
    return "";
  }

  if (
    valor === "verdadero" ||
    valor === "falso" ||
    valor.startsWith("rubrica:")
  ) {
    const puntaje = obtenerPuntajeCalificacion(trabajo, valor);
    return puntaje === null ? "" : formatearValor(puntaje);
  }

  return valor;
};

const obtenerTextoCalificacion = (
  trabajo: TrabajoCalificacion,
  calificacionGuardada: string,
) => {
  const valor = calificacionGuardada.trim();

  if (!valor) {
    return "";
  }

  if (trabajo.tipo_evaluacion === "verdadero_falso") {
    if (valor === "verdadero") {
      return "Verdadero";
    }

    if (valor === "falso") {
      return "Falso";
    }
  }

  if (trabajo.tipo_evaluacion === "rubrica" && valor.startsWith("rubrica:")) {
    const idRubro = valor.slice("rubrica:".length);
    const rubro = obtenerRubricaTrabajo(trabajo).find(
      (elemento) => elemento.id === idRubro,
    );

    if (rubro) {
      return `${rubro.nombre}\n${formatearValor(rubro.puntaje)}`;
    }
  }

  return valor;
};

const obtenerDescripcionTipoEvaluacion = (trabajo: TrabajoCalificacion) => {
  const minimo = formatearValor(Number(trabajo.calificacion_minima ?? 0));
  const maximo = formatearValor(Number(trabajo.calificacion_maxima ?? 10));

  if (trabajo.tipo_evaluacion === "rubrica") {
    return `Rúbrica · ${minimo}-${maximo}`;
  }

  if (trabajo.tipo_evaluacion === "verdadero_falso") {
    return `V/F · ${minimo}-${maximo}`;
  }

  return `${minimo}-${maximo}`;
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

  const [calificacionMinimaConfigurando, setCalificacionMinimaConfigurando] =
    useState("0");

  const [calificacionMaximaConfigurando, setCalificacionMaximaConfigurando] =
    useState("10");

  const [tipoEvaluacionConfigurando, setTipoEvaluacionConfigurando] =
    useState<TipoEvaluacion>("numerica");

  const [rubrosTrabajoConfigurando, setRubrosTrabajoConfigurando] = useState<
    RubroConfiguracion[]
  >([]);

  const [seleccionCalificacion, setSeleccionCalificacion] =
    useState<SeleccionCalificacion | null>(null);

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
              calificacion_minima REAL NOT NULL DEFAULT 0,
              calificacion_maxima REAL NOT NULL DEFAULT 10,
              tipo_evaluacion TEXT NOT NULL DEFAULT 'numerica',
              rubrica_json TEXT NOT NULL DEFAULT '[]',
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
         * Migraciones para instalaciones que ya tenían creada
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

        const existeColumnaCalificacionMinima = columnasTrabajos.some(
          (columna) => columna.name === "calificacion_minima",
        );

        if (!existeColumnaCalificacionMinima) {
          await ejecutarConTiempoMaximo(
            db.execAsync(`
              ALTER TABLE trabajos_calificaciones
              ADD COLUMN calificacion_minima REAL NOT NULL DEFAULT 0;
            `),
          );
        }

        const existeColumnaCalificacionMaxima = columnasTrabajos.some(
          (columna) => columna.name === "calificacion_maxima",
        );

        if (!existeColumnaCalificacionMaxima) {
          await ejecutarConTiempoMaximo(
            db.execAsync(`
              ALTER TABLE trabajos_calificaciones
              ADD COLUMN calificacion_maxima REAL NOT NULL DEFAULT 10;
            `),
          );
        }

        const existeColumnaTipoEvaluacion = columnasTrabajos.some(
          (columna) => columna.name === "tipo_evaluacion",
        );

        if (!existeColumnaTipoEvaluacion) {
          await ejecutarConTiempoMaximo(
            db.execAsync(`
              ALTER TABLE trabajos_calificaciones
              ADD COLUMN tipo_evaluacion TEXT NOT NULL DEFAULT 'numerica';
            `),
          );
        }

        const existeColumnaRubricaJson = columnasTrabajos.some(
          (columna) => columna.name === "rubrica_json",
        );

        if (!existeColumnaRubricaJson) {
          await ejecutarConTiempoMaximo(
            db.execAsync(`
              ALTER TABLE trabajos_calificaciones
              ADD COLUMN rubrica_json TEXT NOT NULL DEFAULT '[]';
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
                valor,
                calificacion_minima,
                calificacion_maxima,
                tipo_evaluacion,
                rubrica_json
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
              calificacion_minima: Number(trabajo.calificacion_minima ?? 0),
              calificacion_maxima: Number(trabajo.calificacion_maxima ?? 10),
              tipo_evaluacion: normalizarTipoEvaluacion(
                trabajo.tipo_evaluacion,
              ),
              rubrica_json:
                typeof trabajo.rubrica_json === "string"
                  ? trabajo.rubrica_json
                  : "[]",
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
   * Calcula el Total como promedio de los trabajos evaluados.
   * Cada trabajo se convierte proporcionalmente a escala 0-10
   * usando la calificación máxima configurada para ese trabajo.
   */
  const totalesPorAlumno = useMemo(() => {
    const totales = new Map<string, number>();

    alumnos.forEach((alumno) => {
      let suma = 0;
      let trabajosEvaluados = 0;

      trabajos.forEach((trabajo) => {
        const clave = crearClaveCalificacion(alumno.id, trabajo.id);
        const calificacionGuardada = calificaciones[clave] ?? "";
        const puntaje = obtenerPuntajeCalificacion(
          trabajo,
          calificacionGuardada,
        );

        const calificacionMaxima = Number(trabajo.calificacion_maxima ?? 10);

        if (
          puntaje === null ||
          !Number.isFinite(puntaje) ||
          !Number.isFinite(calificacionMaxima) ||
          calificacionMaxima <= 0
        ) {
          return;
        }

        suma += (puntaje / calificacionMaxima) * 10;
        trabajosEvaluados += 1;
      });

      totales.set(
        alumno.id,
        trabajosEvaluados > 0 ? suma / trabajosEvaluados : 0,
      );
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

    const rubricaPredeterminada = crearRubricaPredeterminada(0, 10);

    const nuevoTrabajo: TrabajoCalificacion = {
      id: Crypto.randomUUID(),
      clase: idClase,
      nombre: `Trabajo ${posicionNueva}`,
      posicion: posicionNueva,
      valor: 0,
      calificacion_minima: 0,
      calificacion_maxima: 10,
      tipo_evaluacion: "numerica",
      rubrica_json: JSON.stringify(rubricaPredeterminada),
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
              valor,
              calificacion_minima,
              calificacion_maxima,
              tipo_evaluacion,
              rubrica_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
          `,
          [
            nuevoTrabajo.id,
            nuevoTrabajo.clase,
            nuevoTrabajo.nombre,
            nuevoTrabajo.posicion,
            nuevoTrabajo.valor,
            nuevoTrabajo.calificacion_minima,
            nuevoTrabajo.calificacion_maxima,
            nuevoTrabajo.tipo_evaluacion,
            nuevoTrabajo.rubrica_json,
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
    setCalificacionMinimaConfigurando(
      formatearValor(Number(trabajo.calificacion_minima ?? 0)),
    );
    setCalificacionMaximaConfigurando(
      formatearValor(Number(trabajo.calificacion_maxima ?? 10)),
    );
    setTipoEvaluacionConfigurando(
      normalizarTipoEvaluacion(trabajo.tipo_evaluacion),
    );
    setRubrosTrabajoConfigurando(
      obtenerRubricaTrabajo(trabajo).map((rubro) => ({
        id: rubro.id,
        nombre: rubro.nombre,
        puntaje: formatearValor(rubro.puntaje),
      })),
    );
  };

  const limpiarConfiguracionTrabajo = () => {
    setTrabajoConfigurando(null);
    setNombreTrabajoConfigurando("");
    setCalificacionMinimaConfigurando("0");
    setCalificacionMaximaConfigurando("10");
    setTipoEvaluacionConfigurando("numerica");
    setRubrosTrabajoConfigurando([]);
  };

  const cerrarConfiguracionTrabajo = () => {
    if (guardandoConfiguracion || eliminandoTrabajo) {
      return;
    }

    limpiarConfiguracionTrabajo();
  };

  const agregarRubro = () => {
    if (guardandoConfiguracion || eliminandoTrabajo) {
      return;
    }

    setRubrosTrabajoConfigurando((rubrosActuales) => [
      ...rubrosActuales,
      {
        id: Crypto.randomUUID(),
        nombre: `Rubro ${rubrosActuales.length + 1}`,
        puntaje: calificacionMaximaConfigurando || "10",
      },
    ]);
  };

  const editarNombreRubro = (idRubro: string, nombre: string) => {
    setRubrosTrabajoConfigurando((rubrosActuales) =>
      rubrosActuales.map((rubro) =>
        rubro.id === idRubro
          ? {
              ...rubro,
              nombre,
            }
          : rubro,
      ),
    );
  };

  const editarPuntajeRubro = (idRubro: string, puntaje: string) => {
    setRubrosTrabajoConfigurando((rubrosActuales) =>
      rubrosActuales.map((rubro) =>
        rubro.id === idRubro
          ? {
              ...rubro,
              puntaje,
            }
          : rubro,
      ),
    );
  };

  const eliminarRubro = (idRubro: string) => {
    if (guardandoConfiguracion || eliminandoTrabajo) {
      return;
    }

    setRubrosTrabajoConfigurando((rubrosActuales) =>
      rubrosActuales.filter((rubro) => rubro.id !== idRubro),
    );
  };

  const guardarConfiguracionTrabajo = async () => {
    if (!trabajoConfigurando || guardandoConfiguracion || eliminandoTrabajo) {
      return;
    }

    const nombreLimpio = nombreTrabajoConfigurando.trim();

    const nombreFinal =
      nombreLimpio || `Trabajo ${trabajoConfigurando.posicion}`;

    const minima = convertirTextoANumero(calificacionMinimaConfigurando);
    const maxima = convertirTextoANumero(calificacionMaximaConfigurando);

    if (minima === null || maxima === null) {
      Alert.alert(
        "Escala no válida",
        "Escribe números válidos para la calificación mínima y máxima.",
      );

      return;
    }

    if (minima < 0) {
      Alert.alert(
        "Escala no válida",
        "La calificación mínima no puede ser menor que 0.",
      );

      return;
    }

    if (maxima <= minima) {
      Alert.alert(
        "Escala no válida",
        "La calificación máxima debe ser mayor que la calificación mínima.",
      );

      return;
    }

    const rubrosFinales: RubroEvaluacion[] = [];

    for (
      let indice = 0;
      indice < rubrosTrabajoConfigurando.length;
      indice += 1
    ) {
      const rubro = rubrosTrabajoConfigurando[indice];
      const nombreRubro = rubro.nombre.trim();
      const puntajeRubro = convertirTextoANumero(rubro.puntaje);

      if (!nombreRubro) {
        Alert.alert(
          "Rúbrica no válida",
          `Escribe un nombre para el rubro ${indice + 1}.`,
        );

        return;
      }

      if (puntajeRubro === null) {
        Alert.alert(
          "Rúbrica no válida",
          `Escribe un puntaje válido para el rubro "${nombreRubro}".`,
        );

        return;
      }

      if (puntajeRubro < minima || puntajeRubro > maxima) {
        Alert.alert(
          "Rúbrica no válida",
          `El puntaje de "${nombreRubro}" debe estar entre ${formatearValor(
            minima,
          )} y ${formatearValor(maxima)}.`,
        );

        return;
      }

      rubrosFinales.push({
        id: rubro.id || Crypto.randomUUID(),
        nombre: nombreRubro,
        puntaje: puntajeRubro,
      });
    }

    if (
      tipoEvaluacionConfigurando === "rubrica" &&
      rubrosFinales.length === 0
    ) {
      Alert.alert(
        "Rúbrica vacía",
        "Agrega al menos un rubro para poder evaluar mediante rúbrica.",
      );

      return;
    }

    const rubricaJson = JSON.stringify(rubrosFinales);

    setGuardandoConfiguracion(true);

    try {
      const db = await ejecutarConTiempoMaximo(obtenerBaseDatos());

      await ejecutarConTiempoMaximo(
        db.runAsync(
          `
            UPDATE trabajos_calificaciones
            SET
              nombre = ?,
              calificacion_minima = ?,
              calificacion_maxima = ?,
              tipo_evaluacion = ?,
              rubrica_json = ?
            WHERE id = ?
              AND clase = ?;
          `,
          [
            nombreFinal,
            minima,
            maxima,
            tipoEvaluacionConfigurando,
            rubricaJson,
            trabajoConfigurando.id,
            idClase,
          ],
        ),
      );

      setTrabajos((trabajosActuales) =>
        trabajosActuales.map((trabajo) =>
          trabajo.id === trabajoConfigurando.id
            ? {
                ...trabajo,
                nombre: nombreFinal,
                calificacion_minima: minima,
                calificacion_maxima: maxima,
                tipo_evaluacion: tipoEvaluacionConfigurando,
                rubrica_json: rubricaJson,
              }
            : trabajo,
        ),
      );

      limpiarConfiguracionTrabajo();
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

      limpiarConfiguracionTrabajo();
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

  const guardarCalificacionNumerica = async (
    alumno: Alumno,
    trabajo: TrabajoCalificacion,
  ) => {
    const clave = crearClaveCalificacion(alumno.id, trabajo.id);
    const texto = calificaciones[clave] ?? "";
    const textoLimpio = texto.trim();

    if (!textoLimpio) {
      await guardarCalificacion(alumno.id, trabajo.id, "");
      return;
    }

    const numero = obtenerPuntajeCalificacion(trabajo, textoLimpio);
    const minima = Number(trabajo.calificacion_minima ?? 0);
    const maxima = Number(trabajo.calificacion_maxima ?? 10);

    if (numero === null) {
      Alert.alert(
        "Calificación no válida",
        `Escribe un número entre ${formatearValor(minima)} y ${formatearValor(
          maxima,
        )}.`,
      );
      return;
    }

    if (numero < minima || numero > maxima) {
      Alert.alert(
        "Calificación fuera de rango",
        `La calificación debe estar entre ${formatearValor(
          minima,
        )} y ${formatearValor(maxima)}.`,
      );
      return;
    }

    await guardarCalificacion(alumno.id, trabajo.id, formatearValor(numero));
  };

  const seleccionarRubro = async (rubro: RubroEvaluacion) => {
    if (!seleccionCalificacion) {
      return;
    }

    const { alumno, trabajo } = seleccionCalificacion;
    setSeleccionCalificacion(null);

    await guardarCalificacion(alumno.id, trabajo.id, `rubrica:${rubro.id}`);
  };

  const seleccionarVerdaderoFalso = async (valor: "verdadero" | "falso") => {
    if (!seleccionCalificacion) {
      return;
    }

    const { alumno, trabajo } = seleccionCalificacion;
    setSeleccionCalificacion(null);

    await guardarCalificacion(alumno.id, trabajo.id, valor);
  };

  const limpiarCalificacionSeleccionada = async () => {
    if (!seleccionCalificacion) {
      return;
    }

    const { alumno, trabajo } = seleccionCalificacion;
    setSeleccionCalificacion(null);

    await guardarCalificacion(alumno.id, trabajo.id, "");
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
                            {obtenerDescripcionTipoEvaluacion(trabajo)}
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

                            const calificacionGuardada =
                              calificaciones[clave] ?? "";

                            return (
                              <View
                                key={clave}
                                style={{
                                  width: ANCHO_TRABAJO,
                                  minHeight: 64,
                                }}
                                className="items-center justify-center border-r border-slate-200 px-2 py-2 dark:border-slate-700"
                              >
                                {trabajo.tipo_evaluacion === "numerica" ? (
                                  <View className="w-full flex-row items-center">
                                    <TextInput
                                      value={obtenerTextoEntradaNumerica(
                                        trabajo,
                                        calificacionGuardada,
                                      )}
                                      onChangeText={(texto) =>
                                        cambiarCalificacionLocal(
                                          alumno.id,
                                          trabajo.id,
                                          texto,
                                        )
                                      }
                                      onBlur={() =>
                                        void guardarCalificacionNumerica(
                                          alumno,
                                          trabajo,
                                        )
                                      }
                                      placeholder={`${formatearValor(
                                        Number(
                                          trabajo.calificacion_minima ?? 0,
                                        ),
                                      )}-${formatearValor(
                                        Number(
                                          trabajo.calificacion_maxima ?? 10,
                                        ),
                                      )}`}
                                      placeholderTextColor={
                                        modoOscuro ? "#64748b" : "#94a3b8"
                                      }
                                      keyboardType="decimal-pad"
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
                                        color={
                                          modoOscuro ? "#60a5fa" : "#2563eb"
                                        }
                                      />
                                    ) : null}
                                  </View>
                                ) : (
                                  <View className="w-full flex-row items-center">
                                    <Pressable
                                      onPress={() =>
                                        setSeleccionCalificacion({
                                          alumno,
                                          trabajo,
                                        })
                                      }
                                      accessibilityRole="button"
                                      accessibilityLabel={`Seleccionar calificación de ${alumno.nombre} en ${trabajo.nombre}`}
                                      className="min-h-11 flex-1 items-center justify-center rounded-lg border border-slate-300 bg-white px-2 py-2 active:opacity-70 dark:border-slate-600 dark:bg-slate-800"
                                    >
                                      <Text
                                        numberOfLines={2}
                                        className="text-center text-sm font-semibold text-black dark:text-white"
                                      >
                                        {obtenerTextoCalificacion(
                                          trabajo,
                                          calificacionGuardada,
                                        ) || "Seleccionar"}
                                      </Text>
                                    </Pressable>

                                    {celdasGuardando[clave] ? (
                                      <ActivityIndicator
                                        style={{
                                          marginLeft: 5,
                                        }}
                                        size="small"
                                        color={
                                          modoOscuro ? "#60a5fa" : "#2563eb"
                                        }
                                      />
                                    ) : null}
                                  </View>
                                )}
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
              maxHeight: "90%",
              backgroundColor: modoOscuro ? "#0f172a" : "#ffffff",
              borderRadius: 20,
            }}
          >
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{
                padding: 20,
              }}
              showsVerticalScrollIndicator
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
                Escala de calificación
              </Text>

              <View
                style={{
                  flexDirection: "row",
                }}
              >
                <View style={{ flex: 1, marginRight: 7 }}>
                  <Text
                    style={{
                      marginBottom: 6,
                      color: modoOscuro ? "#94a3b8" : "#64748b",
                      fontSize: 12,
                      fontWeight: "600",
                    }}
                  >
                    Calificación más baja
                  </Text>

                  <TextInput
                    value={calificacionMinimaConfigurando}
                    onChangeText={setCalificacionMinimaConfigurando}
                    placeholder="0"
                    placeholderTextColor={modoOscuro ? "#64748b" : "#94a3b8"}
                    keyboardType="decimal-pad"
                    autoCorrect={false}
                    editable={!guardandoConfiguracion && !eliminandoTrabajo}
                    selectTextOnFocus
                    maxLength={10}
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
                </View>

                <View style={{ flex: 1, marginLeft: 7 }}>
                  <Text
                    style={{
                      marginBottom: 6,
                      color: modoOscuro ? "#94a3b8" : "#64748b",
                      fontSize: 12,
                      fontWeight: "600",
                    }}
                  >
                    Calificación más alta
                  </Text>

                  <TextInput
                    value={calificacionMaximaConfigurando}
                    onChangeText={setCalificacionMaximaConfigurando}
                    placeholder="10"
                    placeholderTextColor={modoOscuro ? "#64748b" : "#94a3b8"}
                    keyboardType="decimal-pad"
                    autoCorrect={false}
                    editable={!guardandoConfiguracion && !eliminandoTrabajo}
                    selectTextOnFocus
                    maxLength={10}
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
                </View>
              </View>

              <Text
                style={{
                  marginTop: 17,
                  marginBottom: 8,
                  color: modoOscuro ? "#e2e8f0" : "#334155",
                  fontSize: 14,
                  fontWeight: "600",
                }}
              >
                Tipo de evaluación
              </Text>

              <View>
                <Pressable
                  onPress={() => setTipoEvaluacionConfigurando("numerica")}
                  disabled={guardandoConfiguracion || eliminandoTrabajo}
                  style={{
                    minHeight: 48,
                    borderWidth: 1,
                    borderColor:
                      tipoEvaluacionConfigurando === "numerica"
                        ? "#2563eb"
                        : modoOscuro
                          ? "#475569"
                          : "#cbd5e1",
                    backgroundColor:
                      tipoEvaluacionConfigurando === "numerica"
                        ? modoOscuro
                          ? "#172554"
                          : "#eff6ff"
                        : modoOscuro
                          ? "#1e293b"
                          : "#ffffff",
                    borderRadius: 12,
                    justifyContent: "center",
                    paddingHorizontal: 13,
                  }}
                >
                  <Text
                    style={{
                      color:
                        tipoEvaluacionConfigurando === "numerica"
                          ? modoOscuro
                            ? "#93c5fd"
                            : "#1d4ed8"
                          : modoOscuro
                            ? "#e2e8f0"
                            : "#334155",
                      fontSize: 15,
                      fontWeight: "700",
                    }}
                  >
                    Números
                  </Text>
                  <Text
                    style={{
                      marginTop: 2,
                      color: modoOscuro ? "#94a3b8" : "#64748b",
                      fontSize: 12,
                    }}
                  >
                    Ejemplo: de 0 a 10, de 0 a 100, etc.
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() => setTipoEvaluacionConfigurando("rubrica")}
                  disabled={guardandoConfiguracion || eliminandoTrabajo}
                  style={{
                    marginTop: 8,
                    minHeight: 48,
                    borderWidth: 1,
                    borderColor:
                      tipoEvaluacionConfigurando === "rubrica"
                        ? "#2563eb"
                        : modoOscuro
                          ? "#475569"
                          : "#cbd5e1",
                    backgroundColor:
                      tipoEvaluacionConfigurando === "rubrica"
                        ? modoOscuro
                          ? "#172554"
                          : "#eff6ff"
                        : modoOscuro
                          ? "#1e293b"
                          : "#ffffff",
                    borderRadius: 12,
                    justifyContent: "center",
                    paddingHorizontal: 13,
                  }}
                >
                  <Text
                    style={{
                      color:
                        tipoEvaluacionConfigurando === "rubrica"
                          ? modoOscuro
                            ? "#93c5fd"
                            : "#1d4ed8"
                          : modoOscuro
                            ? "#e2e8f0"
                            : "#334155",
                      fontSize: 15,
                      fontWeight: "700",
                    }}
                  >
                    Rúbrica
                  </Text>
                  <Text
                    style={{
                      marginTop: 2,
                      color: modoOscuro ? "#94a3b8" : "#64748b",
                      fontSize: 12,
                    }}
                  >
                    Insuficiente, suficiente, excelente o los rubros que tú
                    definas.
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() =>
                    setTipoEvaluacionConfigurando("verdadero_falso")
                  }
                  disabled={guardandoConfiguracion || eliminandoTrabajo}
                  style={{
                    marginTop: 8,
                    minHeight: 48,
                    borderWidth: 1,
                    borderColor:
                      tipoEvaluacionConfigurando === "verdadero_falso"
                        ? "#2563eb"
                        : modoOscuro
                          ? "#475569"
                          : "#cbd5e1",
                    backgroundColor:
                      tipoEvaluacionConfigurando === "verdadero_falso"
                        ? modoOscuro
                          ? "#172554"
                          : "#eff6ff"
                        : modoOscuro
                          ? "#1e293b"
                          : "#ffffff",
                    borderRadius: 12,
                    justifyContent: "center",
                    paddingHorizontal: 13,
                  }}
                >
                  <Text
                    style={{
                      color:
                        tipoEvaluacionConfigurando === "verdadero_falso"
                          ? modoOscuro
                            ? "#93c5fd"
                            : "#1d4ed8"
                          : modoOscuro
                            ? "#e2e8f0"
                            : "#334155",
                      fontSize: 15,
                      fontWeight: "700",
                    }}
                  >
                    Verdadero / Falso
                  </Text>
                  <Text
                    style={{
                      marginTop: 2,
                      color: modoOscuro ? "#94a3b8" : "#64748b",
                      fontSize: 12,
                    }}
                  >
                    Verdadero = entregó el trabajo. Falso = no lo entregó.
                  </Text>
                </Pressable>
              </View>

              {tipoEvaluacionConfigurando === "numerica" ? (
                <Text
                  style={{
                    marginTop: 10,
                    color: modoOscuro ? "#94a3b8" : "#64748b",
                    fontSize: 12,
                    lineHeight: 17,
                  }}
                >
                  En cada alumno podrás escribir únicamente una calificación
                  comprendida entre la mínima y la máxima configuradas.
                </Text>
              ) : null}

              {tipoEvaluacionConfigurando === "verdadero_falso" ? (
                <Text
                  style={{
                    marginTop: 10,
                    color: modoOscuro ? "#94a3b8" : "#64748b",
                    fontSize: 12,
                    lineHeight: 17,
                  }}
                >
                  Verdadero asignará la calificación más alta configurada y
                  Falso asignará la calificación más baja.
                </Text>
              ) : null}

              {tipoEvaluacionConfigurando === "rubrica" ? (
                <View style={{ marginTop: 16 }}>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <Text
                      style={{
                        color: modoOscuro ? "#e2e8f0" : "#334155",
                        fontSize: 14,
                        fontWeight: "700",
                      }}
                    >
                      Rubros de evaluación
                    </Text>

                    <Pressable
                      onPress={agregarRubro}
                      disabled={guardandoConfiguracion || eliminandoTrabajo}
                      style={{
                        minHeight: 38,
                        borderRadius: 10,
                        backgroundColor: "#2563eb",
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "center",
                        paddingHorizontal: 12,
                        opacity:
                          guardandoConfiguracion || eliminandoTrabajo ? 0.6 : 1,
                      }}
                    >
                      <FontAwesomeIcon
                        icon={faPlus}
                        size={13}
                        color="#ffffff"
                      />
                      <Text
                        style={{
                          marginLeft: 6,
                          color: "#ffffff",
                          fontSize: 13,
                          fontWeight: "700",
                        }}
                      >
                        Agregar rubro
                      </Text>
                    </Pressable>
                  </View>

                  <Text
                    style={{
                      marginTop: 7,
                      color: modoOscuro ? "#94a3b8" : "#64748b",
                      fontSize: 12,
                      lineHeight: 17,
                    }}
                  >
                    Puedes cambiar el nombre y puntaje de cada rubro, agregar
                    nuevos o eliminar los que no necesites.
                  </Text>

                  {rubrosTrabajoConfigurando.map((rubro, indice) => (
                    <View
                      key={rubro.id}
                      style={{
                        marginTop: 10,
                        borderWidth: 1,
                        borderColor: modoOscuro ? "#334155" : "#e2e8f0",
                        borderRadius: 12,
                        padding: 10,
                        backgroundColor: modoOscuro ? "#1e293b" : "#f8fafc",
                      }}
                    >
                      <Text
                        style={{
                          marginBottom: 7,
                          color: modoOscuro ? "#94a3b8" : "#64748b",
                          fontSize: 12,
                          fontWeight: "700",
                        }}
                      >
                        Rubro {indice + 1}
                      </Text>

                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                        }}
                      >
                        <TextInput
                          value={rubro.nombre}
                          onChangeText={(texto) =>
                            editarNombreRubro(rubro.id, texto)
                          }
                          placeholder="Nombre del rubro"
                          placeholderTextColor={
                            modoOscuro ? "#64748b" : "#94a3b8"
                          }
                          editable={
                            !guardandoConfiguracion && !eliminandoTrabajo
                          }
                          style={{
                            flex: 1,
                            minHeight: 44,
                            borderWidth: 1,
                            borderColor: modoOscuro ? "#475569" : "#cbd5e1",
                            borderRadius: 10,
                            paddingHorizontal: 10,
                            color: modoOscuro ? "#ffffff" : "#000000",
                            backgroundColor: modoOscuro ? "#0f172a" : "#ffffff",
                            fontSize: 14,
                          }}
                        />

                        <TextInput
                          value={rubro.puntaje}
                          onChangeText={(texto) =>
                            editarPuntajeRubro(rubro.id, texto)
                          }
                          placeholder="Puntos"
                          placeholderTextColor={
                            modoOscuro ? "#64748b" : "#94a3b8"
                          }
                          keyboardType="decimal-pad"
                          autoCorrect={false}
                          editable={
                            !guardandoConfiguracion && !eliminandoTrabajo
                          }
                          selectTextOnFocus
                          maxLength={10}
                          style={{
                            width: 82,
                            minHeight: 44,
                            marginLeft: 7,
                            borderWidth: 1,
                            borderColor: modoOscuro ? "#475569" : "#cbd5e1",
                            borderRadius: 10,
                            paddingHorizontal: 8,
                            textAlign: "center",
                            color: modoOscuro ? "#ffffff" : "#000000",
                            backgroundColor: modoOscuro ? "#0f172a" : "#ffffff",
                            fontSize: 14,
                          }}
                        />

                        <Pressable
                          onPress={() => eliminarRubro(rubro.id)}
                          disabled={guardandoConfiguracion || eliminandoTrabajo}
                          accessibilityRole="button"
                          accessibilityLabel={`Eliminar rubro ${rubro.nombre}`}
                          style={{
                            width: 42,
                            height: 42,
                            marginLeft: 7,
                            borderRadius: 10,
                            borderWidth: 1,
                            borderColor: modoOscuro ? "#7f1d1d" : "#fecaca",
                            backgroundColor: modoOscuro ? "#450a0a" : "#fef2f2",
                            alignItems: "center",
                            justifyContent: "center",
                            opacity:
                              guardandoConfiguracion || eliminandoTrabajo
                                ? 0.6
                                : 1,
                          }}
                        >
                          <FontAwesomeIcon
                            icon={faTrash}
                            size={15}
                            color="#dc2626"
                          />
                        </Pressable>
                      </View>
                    </View>
                  ))}

                  {rubrosTrabajoConfigurando.length === 0 ? (
                    <Text
                      style={{
                        marginTop: 10,
                        color: modoOscuro ? "#94a3b8" : "#64748b",
                        fontSize: 12,
                        textAlign: "center",
                      }}
                    >
                      No hay rubros. Presiona “Agregar rubro”.
                    </Text>
                  ) : null}
                </View>
              ) : null}

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
                  opacity:
                    guardandoConfiguracion || eliminandoTrabajo ? 0.6 : 1,
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
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Selector de calificación para rúbrica o Verdadero/Falso */}
      <Modal
        visible={seleccionCalificacion !== null}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setSeleccionCalificacion(null)}
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
              maxHeight: "85%",
              backgroundColor: modoOscuro ? "#0f172a" : "#ffffff",
              borderRadius: 20,
              padding: 20,
            }}
          >
            <Text
              style={{
                color: modoOscuro ? "#ffffff" : "#0f172a",
                fontSize: 20,
                fontWeight: "700",
                textAlign: "center",
              }}
            >
              {seleccionCalificacion?.trabajo.nombre ?? "Calificación"}
            </Text>

            <Text
              style={{
                marginTop: 5,
                color: modoOscuro ? "#94a3b8" : "#64748b",
                fontSize: 13,
                textAlign: "center",
              }}
            >
              {seleccionCalificacion?.alumno.nombre ?? ""}
            </Text>

            {seleccionCalificacion?.trabajo.tipo_evaluacion === "rubrica" ? (
              <ScrollView
                style={{ marginTop: 16 }}
                showsVerticalScrollIndicator
                keyboardShouldPersistTaps="handled"
              >
                {obtenerRubricaTrabajo(seleccionCalificacion.trabajo).map(
                  (rubro) => (
                    <Pressable
                      key={rubro.id}
                      onPress={() => void seleccionarRubro(rubro)}
                      style={{
                        minHeight: 52,
                        marginBottom: 9,
                        borderWidth: 1,
                        borderColor: modoOscuro ? "#475569" : "#cbd5e1",
                        borderRadius: 12,
                        backgroundColor: modoOscuro ? "#1e293b" : "#ffffff",
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                        paddingHorizontal: 14,
                      }}
                    >
                      <Text
                        style={{
                          flex: 1,
                          color: modoOscuro ? "#ffffff" : "#0f172a",
                          fontSize: 15,
                          fontWeight: "700",
                        }}
                      >
                        {rubro.nombre}
                      </Text>

                      <Text
                        style={{
                          marginLeft: 12,
                          color: modoOscuro ? "#93c5fd" : "#2563eb",
                          fontSize: 15,
                          fontWeight: "700",
                        }}
                      >
                        {formatearValor(rubro.puntaje)}
                      </Text>
                    </Pressable>
                  ),
                )}
              </ScrollView>
            ) : null}

            {seleccionCalificacion?.trabajo.tipo_evaluacion ===
            "verdadero_falso" ? (
              <View style={{ marginTop: 16 }}>
                <Pressable
                  onPress={() => void seleccionarVerdaderoFalso("verdadero")}
                  style={{
                    minHeight: 54,
                    borderWidth: 1,
                    borderColor: modoOscuro ? "#166534" : "#bbf7d0",
                    borderRadius: 12,
                    backgroundColor: modoOscuro ? "#052e16" : "#f0fdf4",
                    justifyContent: "center",
                    paddingHorizontal: 14,
                  }}
                >
                  <Text
                    style={{
                      color: modoOscuro ? "#86efac" : "#15803d",
                      fontSize: 16,
                      fontWeight: "700",
                    }}
                  >
                    Verdadero · Entregó
                  </Text>
                  <Text
                    style={{
                      marginTop: 2,
                      color: modoOscuro ? "#86efac" : "#166534",
                      fontSize: 12,
                    }}
                  >
                    Puntaje:{" "}
                    {formatearValor(
                      Number(
                        seleccionCalificacion.trabajo.calificacion_maxima ?? 10,
                      ),
                    )}
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() => void seleccionarVerdaderoFalso("falso")}
                  style={{
                    marginTop: 10,
                    minHeight: 54,
                    borderWidth: 1,
                    borderColor: modoOscuro ? "#7f1d1d" : "#fecaca",
                    borderRadius: 12,
                    backgroundColor: modoOscuro ? "#450a0a" : "#fef2f2",
                    justifyContent: "center",
                    paddingHorizontal: 14,
                  }}
                >
                  <Text
                    style={{
                      color: modoOscuro ? "#fca5a5" : "#dc2626",
                      fontSize: 16,
                      fontWeight: "700",
                    }}
                  >
                    Falso · No entregó
                  </Text>
                  <Text
                    style={{
                      marginTop: 2,
                      color: modoOscuro ? "#fca5a5" : "#991b1b",
                      fontSize: 12,
                    }}
                  >
                    Puntaje:{" "}
                    {formatearValor(
                      Number(
                        seleccionCalificacion.trabajo.calificacion_minima ?? 0,
                      ),
                    )}
                  </Text>
                </Pressable>
              </View>
            ) : null}

            <Pressable
              onPress={() => void limpiarCalificacionSeleccionada()}
              style={{
                marginTop: 14,
                minHeight: 44,
                borderWidth: 1,
                borderColor: modoOscuro ? "#475569" : "#cbd5e1",
                borderRadius: 12,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text
                style={{
                  color: modoOscuro ? "#e2e8f0" : "#334155",
                  fontSize: 14,
                  fontWeight: "700",
                }}
              >
                Quitar calificación
              </Text>
            </Pressable>

            <Pressable
              onPress={() => setSeleccionCalificacion(null)}
              style={{
                marginTop: 10,
                minHeight: 44,
                borderRadius: 12,
                backgroundColor: "#2563eb",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text
                style={{
                  color: "#ffffff",
                  fontSize: 14,
                  fontWeight: "700",
                }}
              >
                Cerrar
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}
