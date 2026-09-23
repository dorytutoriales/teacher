import { ejecutarConTiempoMaximo, obtenerBaseDatos } from "@/lib/database";
import {
  faArrowDown,
  faArrowLeft,
  faArrowUp,
  faCamera,
  faFileExcel,
  faFloppyDisk,
  faMicrophone,
  faMoon,
  faPen,
  faPlus,
  faStop,
  faSun,
  faTrash,
  faUsers,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-native-fontawesome";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Crypto from "expo-crypto";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import * as ImageManipulator from "expo-image-manipulator";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";
import { StatusBar } from "expo-status-bar";
import { extractTextFromImage, isSupported } from "expo-text-extractor";
import { useColorScheme } from "nativewind";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { read, utils } from "xlsx";

type ParametrosAlumnos = {
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

type AlumnoDetectado = {
  id: string;
  nombre: string;
};

type HojaExcelVista = {
  nombre: string;
  filas: number[];
  columnas: number[];
  celdas: Record<string, string>;
};

/*
 * Convierte un texto a una forma comparable para evitar
 * nombres duplicados aunque cambien mayúsculas o acentos.
 */
const normalizarTexto = (texto: string) => {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
};

/*
 * Convierte nombres escritos completamente en mayúsculas
 * o minúsculas a formato de nombre.
 */
const capitalizarNombre = (nombre: string) => {
  const conectores = new Set(["de", "del", "la", "las", "los", "y"]);

  return nombre
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((palabra, indice) => {
      if (indice > 0 && conectores.has(palabra)) {
        return palabra;
      }

      return palabra
        .split("-")
        .map((parte) => {
          if (!parte) {
            return parte;
          }

          return parte.charAt(0).toUpperCase() + parte.slice(1);
        })
        .join("-");
    })
    .join(" ");
};

/*
 * Intenta limpiar cada línea reconocida por el OCR.
 *
 * Elimina:
 * - Números de lista.
 * - Viñetas.
 * - Encabezados comunes.
 * - Símbolos que no pertenecen a un nombre.
 */
const limpiarLineaOCR = (linea: string): string | null => {
  let texto = linea
    .replace(/\t/g, " ")
    .replace(/[|[\]{}]/g, " ")
    .replace(/^[\s\d]+[.)\-–—:]*\s*/, "")
    .replace(/\s+\d+\s*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  texto = texto
    .replace(/^[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+/, "")
    .replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ.'´\-\s]+$/, "")
    .trim();

  if (texto.length < 3) {
    return null;
  }

  const textoNormalizado = normalizarTexto(texto);

  const encabezadosIgnorados = [
    "lista",
    "lista de alumnos",
    "lista de asistencia",
    "asistencia",
    "alumno",
    "alumnos",
    "nombre",
    "nombres",
    "nombre del alumno",
    "nombre completo",
    "escuela",
    "grupo",
    "grado",
    "fecha",
    "firma",
    "matricula",
    "numero",
    "num",
    "no",
  ];

  const esEncabezado = encabezadosIgnorados.some((encabezado) => {
    return (
      textoNormalizado === encabezado ||
      textoNormalizado.startsWith(`${encabezado}:`)
    );
  });

  if (esEncabezado) {
    return null;
  }

  const cantidadLetras = texto.match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g)?.length ?? 0;

  if (cantidadLetras < 3) {
    return null;
  }

  const palabras = texto.split(/\s+/).filter(Boolean);

  /*
   * Evita guardar párrafos completos detectados por error.
   */
  if (palabras.length > 7) {
    return null;
  }

  return capitalizarNombre(texto);
};

/*
 * Separa el resultado del OCR por líneas, limpia los nombres
 * y elimina nombres repetidos.
 */
const obtenerNombresDesdeTexto = (textos: string[]) => {
  const nombres: string[] = [];
  const nombresAgregados = new Set<string>();

  const lineas = textos.flatMap((texto) => {
    return texto.split(/\r?\n/);
  });

  lineas.forEach((linea) => {
    const nombre = limpiarLineaOCR(linea);

    if (!nombre) {
      return;
    }

    const clave = normalizarTexto(nombre);

    if (nombresAgregados.has(clave)) {
      return;
    }

    nombresAgregados.add(clave);
    nombres.push(nombre);
  });

  return nombres;
};

/*
 * Convierte el índice numérico de una columna de Excel a su letra.
 * Ejemplos: 0 = A, 25 = Z, 26 = AA.
 */
const obtenerLetraColumnaExcel = (indiceColumna: number) => {
  let numero = indiceColumna + 1;
  let resultado = "";

  while (numero > 0) {
    const residuo = (numero - 1) % 26;
    resultado = String.fromCharCode(65 + residuo) + resultado;
    numero = Math.floor((numero - 1) / 26);
  }

  return resultado;
};

/*
 * Crea una clave única para conservar selecciones incluso al cambiar de hoja.
 */
const crearClaveCeldaExcel = (hoja: string, direccion: string) => {
  return `${hoja}::${direccion}`;
};

type ConversionVirtualExcel = {
  mimeType: string;
  extension: string;
};

/*
 * Obtiene una extensión que SheetJS puede interpretar a partir del MIME
 * anunciado por el proveedor de documentos de Android.
 */
const obtenerExtensionConversionExcel = (mimeType: string) => {
  const mime = mimeType.trim().toLowerCase();

  if (
    mime.includes(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ) ||
    mime.includes("spreadsheetml.sheet")
  ) {
    return "xlsx";
  }

  if (
    mime.includes("application/vnd.ms-excel.sheet.macroenabled.12") ||
    mime.includes("sheet.macroenabled")
  ) {
    return "xlsm";
  }

  if (mime === "application/vnd.ms-excel" || mime.includes("ms-excel")) {
    return "xls";
  }

  if (
    mime.includes("application/vnd.oasis.opendocument.spreadsheet") ||
    mime.includes("opendocument.spreadsheet")
  ) {
    return "ods";
  }

  if (
    mime === "text/csv" ||
    mime === "application/csv" ||
    mime.includes("comma-separated-values") ||
    mime.endsWith("/csv")
  ) {
    return "csv";
  }

  return "";
};

/*
 * @react-native-documents/picker ha utilizado más de una representación para
 * convertibleToMimeTypes según la versión/plataforma. Esta función admite
 * tanto strings MIME como objetos { mimeType, extension }.
 *
 * IMPORTANTE:
 * Nunca inventa una conversión. Solamente devuelve formatos que el proveedor
 * de Android declaró explícitamente como exportables.
 */
const normalizarConversionesVirtualesExcel = (
  conversiones: unknown,
): ConversionVirtualExcel[] => {
  if (!Array.isArray(conversiones)) {
    return [];
  }

  const resultado: ConversionVirtualExcel[] = [];

  conversiones.forEach((conversion) => {
    let mimeType = "";
    let extension = "";

    if (typeof conversion === "string") {
      mimeType = conversion.trim();
      extension = obtenerExtensionConversionExcel(mimeType);
    } else if (conversion && typeof conversion === "object") {
      const datos = conversion as {
        mimeType?: unknown;
        extension?: unknown;
      };

      mimeType =
        typeof datos.mimeType === "string" ? datos.mimeType.trim() : "";

      extension =
        typeof datos.extension === "string"
          ? datos.extension.trim().replace(/^\./, "").toLowerCase()
          : "";

      if (!extension && mimeType) {
        extension = obtenerExtensionConversionExcel(mimeType);
      }
    }

    if (!mimeType || !extension) {
      return;
    }

    if (!["xlsx", "xlsm", "xls", "ods", "csv"].includes(extension)) {
      return;
    }

    const yaExiste = resultado.some(
      (item) =>
        item.mimeType.toLowerCase() === mimeType.toLowerCase() &&
        item.extension === extension,
    );

    if (!yaExiste) {
      resultado.push({
        mimeType,
        extension,
      });
    }
  });

  /*
   * Intenta conservar el libro completo antes de recurrir a formatos de
   * respaldo. CSV queda al final porque representa una sola hoja.
   */
  const prioridad = ["xlsx", "xlsm", "xls", "ods", "csv"];

  return resultado.sort((a, b) => {
    return prioridad.indexOf(a.extension) - prioridad.indexOf(b.extension);
  });
};

/*
 * Reduce la fotografía antes de enviarla al OCR y crea una URI content://
 * en Android. expo-text-extractor recibe de forma segura esa URI mediante
 * ML Kit, evitando que una ruta file:// provoque un fallo nativo.
 */
const prepararImagenParaOCR = async (
  uri: string,
  anchoOriginal?: number,
  altoOriginal?: number,
) => {
  const ladoMaximo = 1400;

  let accionRedimensionar:
    | {
        resize: {
          width?: number;
          height?: number;
        };
      }
    | undefined;

  if (
    typeof anchoOriginal === "number" &&
    anchoOriginal > 0 &&
    typeof altoOriginal === "number" &&
    altoOriginal > 0
  ) {
    const ladoMayor = Math.max(anchoOriginal, altoOriginal);

    if (ladoMayor > ladoMaximo) {
      accionRedimensionar =
        anchoOriginal >= altoOriginal
          ? {
              resize: {
                width: ladoMaximo,
              },
            }
          : {
              resize: {
                height: ladoMaximo,
              },
            };
    }
  } else {
    accionRedimensionar = {
      resize: {
        width: ladoMaximo,
      },
    };
  }

  const imagenPreparada = await ImageManipulator.manipulateAsync(
    uri,
    accionRedimensionar ? [accionRedimensionar] : [],
    {
      compress: 0.72,
      format: ImageManipulator.SaveFormat.JPEG,
      base64: false,
    },
  );

  if (!imagenPreparada.uri) {
    throw new Error("No fue posible preparar la fotografía para el OCR.");
  }

  let uriParaOCR = imagenPreparada.uri;

  if (Platform.OS === "android") {
    const archivo = new File(imagenPreparada.uri);

    if (!archivo.exists) {
      throw new Error("La fotografía preparada no existe.");
    }

    uriParaOCR = archivo.contentUri;
  }

  return {
    uriVisual: imagenPreparada.uri,
    uriParaOCR,
  };
};

export default function PantallaAlumnos() {
  const router = useRouter();

  const parametros = useLocalSearchParams<ParametrosAlumnos>();

  const { colorScheme, toggleColorScheme } = useColorScheme();

  const modoOscuro = colorScheme === "dark";

  const [permisoCamara, solicitarPermisoCamara] = useCameraPermissions();

  const camaraRef = useRef<CameraView | null>(null);

  const [camaraVisible, setCamaraVisible] = useState(false);

  const [camaraLista, setCamaraLista] = useState(false);

  const [tomandoFotografia, setTomandoFotografia] = useState(false);

  const [fotografiaTemporal, setFotografiaTemporal] = useState<{
    uri: string;
    width?: number;
    height?: number;
  } | null>(null);

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

  const escuela = obtenerParametro(
    parametros.escuela,
    "Escuela no especificada",
  );

  const grupo = obtenerParametro(parametros.grupo, "Grupo no especificado");

  const descripcion = obtenerParametro(
    parametros.descripcion,
    "Sin descripción",
  );

  const [alumnos, setAlumnos] = useState<Alumno[]>([]);

  const [busquedaAlumno, setBusquedaAlumno] = useState("");

  const busquedaAlumnoNormalizada = normalizarTexto(busquedaAlumno);

  const alumnosFiltrados = busquedaAlumnoNormalizada
    ? alumnos.filter((alumno) =>
        normalizarTexto(alumno.nombre).includes(busquedaAlumnoNormalizada),
      )
    : alumnos;

  const [cargando, setCargando] = useState(true);

  const [procesandoOCR, setProcesandoOCR] = useState(false);

  const [guardando, setGuardando] = useState(false);

  const [modificandoAlumnos, setModificandoAlumnos] = useState(false);

  const [alumnoEditandoId, setAlumnoEditandoId] = useState<string | null>(null);

  const [nombreAlumnoEditando, setNombreAlumnoEditando] = useState("");

  const [modalVisible, setModalVisible] = useState(false);

  const [modoAgregarAlumnos, setModoAgregarAlumnos] = useState<
    "foto" | "voz" | "manual" | "excel" | null
  >(null);

  const [modalExcelVisible, setModalExcelVisible] = useState(false);

  const [cargandoExcel, setCargandoExcel] = useState(false);

  const [nombreArchivoExcel, setNombreArchivoExcel] = useState("");

  const [hojasExcel, setHojasExcel] = useState<HojaExcelVista[]>([]);

  const [hojaExcelActiva, setHojaExcelActiva] = useState("");

  const [celdasExcelSeleccionadas, setCeldasExcelSeleccionadas] = useState<
    Set<string>
  >(new Set());

  const [imagenUri, setImagenUri] = useState<string | null>(null);

  const [alumnosDetectados, setAlumnosDetectados] = useState<AlumnoDetectado[]>(
    [],
  );

  const [dictadoVozActivo, setDictadoVozActivo] = useState(false);

  const [reconociendoVoz, setReconociendoVoz] = useState(false);

  const [textoVozTemporal, setTextoVozTemporal] = useState("");

  const dictadoVozActivoRef = useRef(false);

  const textoVozConfirmadoRef = useRef("");

  const textoVozTemporalRef = useRef("");

  const indiceInicioDictadoRef = useRef(0);

  const temporizadorReinicioVozRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);

  /*
   * Cancela cualquier reinicio automático pendiente del reconocimiento.
   */
  const limpiarTemporizadorReinicioVoz = useCallback(() => {
    if (temporizadorReinicioVozRef.current) {
      clearTimeout(temporizadorReinicioVozRef.current);
      temporizadorReinicioVozRef.current = null;
    }
  }, []);

  /*
   * Convierte el dictado en campos individuales.
   *
   * La palabra "siguiente" funciona como separador:
   * "Juan Pérez siguiente María López" crea dos alumnos.
   */
  const aplicarTextoDictado = useCallback((textoCompleto: string) => {
    const fragmentos = textoCompleto.split(/\bsiguiente\b/gi);

    const nombres = fragmentos.map((fragmento) => {
      const nombreLimpio = fragmento
        .replace(/[.,;:!?¿¡]+/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim();

      return nombreLimpio ? capitalizarNombre(nombreLimpio) : "";
    });

    const nombresParaMostrar = nombres.length > 0 ? nombres : [""];

    setAlumnosDetectados((alumnosActuales) => {
      const indiceInicio = Math.min(
        indiceInicioDictadoRef.current,
        alumnosActuales.length,
      );
      const alumnosPrevios = alumnosActuales.slice(0, indiceInicio);
      const alumnosDelDictado = alumnosActuales.slice(indiceInicio);

      return [
        ...alumnosPrevios,
        ...nombresParaMostrar.map((nombre, indice) => ({
          id: alumnosDelDictado[indice]?.id ?? Crypto.randomUUID(),
          nombre,
        })),
      ];
    });
  }, []);

  /*
   * Inicia una sesión corta de reconocimiento. Al terminar, si el dictado
   * sigue activo, se inicia automáticamente otra sesión para mantener
   * compatibilidad con versiones de Android que no admiten modo continuo.
   */
  const iniciarSesionReconocimientoVoz = useCallback(() => {
    if (!dictadoVozActivoRef.current) {
      return;
    }

    limpiarTemporizadorReinicioVoz();

    try {
      ExpoSpeechRecognitionModule.start({
        lang: "es-MX",
        interimResults: true,
        maxAlternatives: 1,
        continuous:
          Platform.OS === "android" ? Number(Platform.Version) >= 33 : true,
        contextualStrings: ["siguiente"],
        iosTaskHint: "dictation",
        androidIntentOptions: {
          EXTRA_LANGUAGE_MODEL: "free_form",
          EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: 1800,
          EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS: 1200,
          ...(Platform.OS === "android" && Number(Platform.Version) >= 33
            ? { EXTRA_MASK_OFFENSIVE_WORDS: false }
            : {}),
        },
      });
    } catch (error) {
      console.error("Error al iniciar el reconocimiento de voz:", error);

      dictadoVozActivoRef.current = false;
      setDictadoVozActivo(false);
      setReconociendoVoz(false);

      Alert.alert(
        "Error de voz",
        "No fue posible iniciar el reconocimiento de voz.",
      );
    }
  }, [limpiarTemporizadorReinicioVoz]);

  /*
   * Detiene o cancela el reconocimiento y evita que vuelva a iniciarse.
   */
  const detenerReconocimientoVoz = useCallback(
    (cancelarResultadoPendiente = false) => {
      if (!cancelarResultadoPendiente && textoVozTemporalRef.current.trim()) {
        const textoConfirmado = [
          textoVozConfirmadoRef.current,
          textoVozTemporalRef.current.trim(),
        ]
          .filter(Boolean)
          .join(" ")
          .trim();

        textoVozConfirmadoRef.current = textoConfirmado;
        aplicarTextoDictado(textoConfirmado);
      }

      textoVozTemporalRef.current = "";
      dictadoVozActivoRef.current = false;
      setDictadoVozActivo(false);
      setReconociendoVoz(false);
      setTextoVozTemporal("");
      limpiarTemporizadorReinicioVoz();

      try {
        if (cancelarResultadoPendiente) {
          ExpoSpeechRecognitionModule.abort();
        } else {
          ExpoSpeechRecognitionModule.stop();
        }
      } catch (error) {
        /*
         * Puede ocurrir cuando el reconocimiento ya terminó por sí solo.
         * No es necesario mostrar un error al usuario.
         */
        console.log("El reconocimiento de voz ya estaba detenido:", error);
      }
    },
    [aplicarTextoDictado, limpiarTemporizadorReinicioVoz],
  );

  /*
   * Solicita permisos y activa el dictado.
   */
  const activarReconocimientoVoz = useCallback(async () => {
    try {
      if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
        Alert.alert(
          "Reconocimiento no disponible",
          "Este dispositivo no tiene habilitado un servicio de reconocimiento de voz.",
        );
        return false;
      }

      const permiso =
        await ExpoSpeechRecognitionModule.requestPermissionsAsync();

      if (!permiso.granted) {
        Alert.alert(
          "Permiso requerido",
          "Debes permitir el acceso al micrófono y al reconocimiento de voz para dictar los nombres.",
        );
        return false;
      }

      dictadoVozActivoRef.current = true;
      setDictadoVozActivo(true);
      textoVozTemporalRef.current = "";
      setTextoVozTemporal("");

      /*
       * Se espera un instante para que la pantalla termine de mostrarse.
       */
      temporizadorReinicioVozRef.current = setTimeout(() => {
        iniciarSesionReconocimientoVoz();
      }, 250);

      return true;
    } catch (error) {
      console.error("Error al solicitar permisos de voz:", error);

      Alert.alert(
        "Error de voz",
        "No fue posible solicitar los permisos para usar el reconocimiento de voz.",
      );

      return false;
    }
  }, [iniciarSesionReconocimientoVoz]);

  useSpeechRecognitionEvent("start", () => {
    if (!dictadoVozActivoRef.current) {
      return;
    }

    setReconociendoVoz(true);
  });

  useSpeechRecognitionEvent("result", (evento) => {
    if (!dictadoVozActivoRef.current) {
      return;
    }

    const textoReconocido = evento.results[0]?.transcript?.trim() ?? "";

    if (!textoReconocido) {
      return;
    }

    if (evento.isFinal) {
      const textoConfirmado = [textoVozConfirmadoRef.current, textoReconocido]
        .filter(Boolean)
        .join(" ")
        .trim();

      textoVozConfirmadoRef.current = textoConfirmado;
      textoVozTemporalRef.current = "";
      setTextoVozTemporal("");
      aplicarTextoDictado(textoConfirmado);
      return;
    }

    textoVozTemporalRef.current = textoReconocido;
    setTextoVozTemporal(textoReconocido);

    const textoConVistaPrevia = [textoVozConfirmadoRef.current, textoReconocido]
      .filter(Boolean)
      .join(" ")
      .trim();

    aplicarTextoDictado(textoConVistaPrevia);
  });

  useSpeechRecognitionEvent("end", () => {
    setReconociendoVoz(false);

    if (dictadoVozActivoRef.current && textoVozTemporalRef.current.trim()) {
      const textoConfirmado = [
        textoVozConfirmadoRef.current,
        textoVozTemporalRef.current.trim(),
      ]
        .filter(Boolean)
        .join(" ")
        .trim();

      textoVozConfirmadoRef.current = textoConfirmado;
      aplicarTextoDictado(textoConfirmado);
    }

    textoVozTemporalRef.current = "";
    setTextoVozTemporal("");

    if (!dictadoVozActivoRef.current) {
      return;
    }

    limpiarTemporizadorReinicioVoz();

    temporizadorReinicioVozRef.current = setTimeout(() => {
      iniciarSesionReconocimientoVoz();
    }, 450);
  });

  useSpeechRecognitionEvent("error", (evento) => {
    setReconociendoVoz(false);

    if (!dictadoVozActivoRef.current) {
      return;
    }

    /*
     * "no-speech" solamente significa que hubo silencio.
     * El evento "end" iniciará otra sesión automáticamente.
     */
    if (evento.error === "no-speech") {
      return;
    }

    console.error(
      "Error de reconocimiento de voz:",
      evento.error,
      evento.message,
    );

    dictadoVozActivoRef.current = false;
    setDictadoVozActivo(false);
    limpiarTemporizadorReinicioVoz();

    const mensaje =
      evento.error === "not-allowed"
        ? "No se concedieron los permisos para usar el micrófono."
        : evento.error === "language-not-supported"
          ? "El reconocimiento de voz en español de México no está disponible en este dispositivo."
          : "El reconocimiento de voz se detuvo por un error. Inténtalo nuevamente.";

    Alert.alert("Error de voz", mensaje);
  });

  /*
   * Detiene el reconocimiento si la pantalla se desmonta.
   */
  useEffect(() => {
    return () => {
      dictadoVozActivoRef.current = false;
      limpiarTemporizadorReinicioVoz();

      try {
        ExpoSpeechRecognitionModule.abort();
      } catch {
        /*
         * No hay una sesión activa.
         */
      }
    };
  }, [limpiarTemporizadorReinicioVoz]);

  /*
   * Consulta todos los alumnos de la clase seleccionada.
   * La consulta tiene un tiempo máximo para que Android nunca deje
   * la interfaz bloqueada indefinidamente.
   */
  const cargarAlumnos = useCallback(async () => {
    if (!idClase) {
      setAlumnos([]);
      return;
    }

    const db = await ejecutarConTiempoMaximo(obtenerBaseDatos());

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
          ORDER BY posicion ASC, nombre COLLATE NOCASE ASC
          LIMIT 2000;
        `,
        [idClase],
      ),
    );

    setAlumnos(alumnosGuardados);
  }, [idClase]);

  /*
   * Inicializa únicamente la tabla de alumnos y después carga la lista.
   * No usa InteractionManager ni SQLiteProvider, de modo que la navegación,
   * el botón regresar y el modo claro/oscuro siguen respondiendo aunque
   * SQLite tarde o falle.
   */
  useEffect(() => {
    let componenteActivo = true;

    setCargando(true);

    const temporizadorSeguridad = setTimeout(() => {
      if (componenteActivo) {
        setCargando(false);
      }
    }, 5000);

    const temporizadorInicio = setTimeout(() => {
      void (async () => {
        try {
          if (!idClase) {
            if (componenteActivo) {
              setAlumnos([]);
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
              db.execAsync(
                "ALTER TABLE alumnos ADD COLUMN posicion INTEGER NOT NULL DEFAULT 0;",
              ),
            );
          }

          const alumnosParaOrdenar = await ejecutarConTiempoMaximo(
            db.getAllAsync<{ id: string; posicion: number }>(
              `
                SELECT
                  id,
                  posicion
                FROM alumnos
                WHERE clase = ?
                ORDER BY
                  CASE WHEN posicion > 0 THEN 0 ELSE 1 END ASC,
                  CASE WHEN posicion > 0 THEN posicion ELSE NULL END ASC,
                  nombre COLLATE NOCASE ASC;
              `,
              [idClase],
            ),
          );

          const necesitaNormalizarPosiciones = alumnosParaOrdenar.some(
            (alumno, indice) => alumno.posicion !== indice + 1,
          );
          if (necesitaNormalizarPosiciones) {
            await ejecutarConTiempoMaximo(
              db.withTransactionAsync(async () => {
                for (
                  let indice = 0;
                  indice < alumnosParaOrdenar.length;
                  indice += 1
                ) {
                  await db.runAsync(
                    "UPDATE alumnos SET posicion = ? WHERE id = ? AND clase = ?;",
                    [indice + 1, alumnosParaOrdenar[indice].id, idClase],
                  );
                }
              }),
              10000,
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
                ORDER BY posicion ASC, nombre COLLATE NOCASE ASC
                LIMIT 2000;
              `,
              [idClase],
            ),
          );

          if (componenteActivo) {
            setAlumnos(alumnosGuardados);
          }
        } catch (error) {
          console.error("Error al cargar alumnos:", error);

          if (componenteActivo) {
            setAlumnos([]);
          }
        } finally {
          clearTimeout(temporizadorSeguridad);

          if (componenteActivo) {
            setCargando(false);
          }
        }
      })();
    }, 0);

    return () => {
      componenteActivo = false;
      clearTimeout(temporizadorInicio);
      clearTimeout(temporizadorSeguridad);
    };
  }, [idClase]);

  const procesandoOCRRef = useRef(false);

  /*
   * Procesa una fotografía después de que la cámara o el editor
   * hayan terminado de cerrarse completamente.
   */
  const procesarFotografia = useCallback(
    async (uri: string, anchoOriginal?: number, altoOriginal?: number) => {
      if (procesandoOCRRef.current) {
        return;
      }

      if (!isSupported) {
        Alert.alert(
          "OCR no compatible",
          "El reconocimiento de texto no es compatible con este dispositivo.",
        );
        return;
      }

      procesandoOCRRef.current = true;
      setImagenUri(null);
      setProcesandoOCR(true);

      try {
        /*
         * La cámara está dentro de la propia aplicación, por lo que Android
         * no abre ni destruye otra actividad. Después se genera una copia
         * ligera y una URI content:// segura para ML Kit.
         */
        const imagenPreparada = await prepararImagenParaOCR(
          uri,
          anchoOriginal,
          altoOriginal,
        );

        const textosReconocidos = await extractTextFromImage(
          imagenPreparada.uriParaOCR,
        );

        const nombresDetectados = obtenerNombresDesdeTexto(textosReconocidos);

        if (nombresDetectados.length === 0) {
          setImagenUri(null);

          Alert.alert(
            "Sin nombres detectados",
            "No fue posible encontrar nombres en la imagen. Procura que la lista tenga buena iluminación y que el texto sea legible.",
          );
          return;
        }

        setImagenUri(imagenPreparada.uriVisual);
        setAlumnosDetectados((alumnosActuales) => [
          ...alumnosActuales,
          ...nombresDetectados.map((nombre) => ({
            id: Crypto.randomUUID(),
            nombre,
          })),
        ]);

        /*
         * Abre la pantalla para que el usuario revise,
         * corrija, agregue o elimine nombres antes de guardar.
         */
        setModoAgregarAlumnos("foto");
        setModalVisible(true);
      } catch (error) {
        console.error("Error al procesar la fotografía:", error);

        setImagenUri(null);

        const mensajeError =
          error instanceof Error ? error.message : "Error desconocido";

        Alert.alert(
          "Error de reconocimiento",
          `No fue posible extraer el texto de la fotografía. ${mensajeError}`,
        );
      } finally {
        procesandoOCRRef.current = false;
        setProcesandoOCR(false);
      }
    },
    [],
  );

  /*
   * Abre una cámara propia dentro de la aplicación. De esta forma no se usa
   * la actividad de cámara externa de Android que estaba cerrando DoryTeacher
   * al aceptar la fotografía.
   */
  const tomarFotoLista = async () => {
    if (!idClase) {
      Alert.alert(
        "Clase no válida",
        "No se encontró el identificador de la clase.",
      );
      return;
    }

    if (!isSupported) {
      Alert.alert(
        "OCR no compatible",
        "El reconocimiento de texto no es compatible con este dispositivo.",
      );
      return;
    }

    try {
      let permisoActual = permisoCamara;

      if (!permisoActual?.granted) {
        permisoActual = await solicitarPermisoCamara();
      }

      if (!permisoActual.granted) {
        Alert.alert(
          "Permiso requerido",
          "Debes permitir el acceso a la cámara para fotografiar la lista de asistencia.",
        );
        return;
      }

      setCamaraLista(false);
      setFotografiaTemporal(null);
      setCamaraVisible(true);
    } catch (error) {
      console.error("Error al solicitar permiso de cámara:", error);

      Alert.alert(
        "Error de cámara",
        "No fue posible abrir la cámara. Inténtalo nuevamente.",
      );
    }
  };

  /*
   * Abre la pantalla de revisión e inicia el reconocimiento de voz.
   * Cada vez que el usuario diga "siguiente", se crea un campo nuevo.
   */
  const agregarAlumnosConVoz = async () => {
    if (!idClase) {
      Alert.alert(
        "Clase no válida",
        "No se encontró el identificador de la clase.",
      );
      return;
    }

    if (procesandoOCR || guardando) {
      return;
    }

    const revisionYaVisible = modalVisible;
    const modoAnterior = modoAgregarAlumnos;
    const indiceInicioDictado = alumnosDetectados.length;

    detenerReconocimientoVoz(false);
    textoVozConfirmadoRef.current = "";
    textoVozTemporalRef.current = "";
    indiceInicioDictadoRef.current = indiceInicioDictado;
    setTextoVozTemporal("");
    setImagenUri(null);
    setAlumnosDetectados((alumnosActuales) => [
      ...alumnosActuales,
      {
        id: Crypto.randomUUID(),
        nombre: "",
      },
    ]);
    setModoAgregarAlumnos("voz");
    setModalVisible(true);

    const reconocimientoActivado = await activarReconocimientoVoz();

    if (!reconocimientoActivado) {
      setAlumnosDetectados((alumnosActuales) =>
        alumnosActuales.slice(0, indiceInicioDictado),
      );
      setModalVisible(revisionYaVisible || indiceInicioDictado > 0);
      setModoAgregarAlumnos(modoAnterior);
    }
  };

  /*
   * Permite terminar el dictado para revisar los nombres
   * y volver a activarlo sin borrar lo ya reconocido.
   */
  const alternarDictadoVoz = async () => {
    if (dictadoVozActivoRef.current) {
      detenerReconocimientoVoz(false);
      return;
    }

    await activarReconocimientoVoz();
  };

  /*
   * Permite seleccionar un archivo de Excel y lo abre en una vista interna
   * para que el usuario elija únicamente las celdas que contienen nombres.
   */
  const agregarAlumnosConExcel = async () => {
    if (!idClase) {
      Alert.alert(
        "Clase no válida",
        "No se encontró el identificador de la clase.",
      );
      return;
    }

    if (procesandoOCR || guardando || cargandoExcel) {
      return;
    }

    if (dictadoVozActivoRef.current) {
      detenerReconocimientoVoz(false);
    }

    try {
      setCargandoExcel(true);

      /*
       * El selector de Expo realiza la copia al caché dentro del propio flujo
       * nativo del selector de documentos. En Android esto evita intentar leer
       * después un content:// de Google Drive sin el permiso temporal que lo
       * acompaña. También funciona con almacenamiento interno, Descargas y SD.
       *
       * No se filtra por MIME en el selector porque algunos proveedores de
       * Android reportan archivos Excel con tipos genéricos. La validación se
       * hace inmediatamente después por nombre/MIME y finalmente por contenido
       * con SheetJS.
       */
      const seleccion = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (seleccion.canceled || !seleccion.assets?.length) {
        return;
      }

      const archivoSeleccionado = seleccion.assets[0];

      const nombreArchivo =
        archivoSeleccionado.name?.trim() || "Archivo de Excel";

      const nombreArchivoMinusculas = nombreArchivo.toLowerCase();
      const mimeArchivo = (archivoSeleccionado.mimeType ?? "").toLowerCase();

      const extensionArchivo = nombreArchivoMinusculas.includes(".")
        ? (nombreArchivoMinusculas.split(".").pop() ?? "")
        : "";

      const esExcelPorExtension = ["xlsx", "xls", "xlsm"].includes(
        extensionArchivo,
      );

      const esHojaCalculoPorMime =
        mimeArchivo.includes(
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ) ||
        mimeArchivo.includes("application/vnd.ms-excel") ||
        mimeArchivo.includes("sheet.macroenabled") ||
        mimeArchivo.includes("spreadsheet");

      const nombreTieneExtension =
        Boolean(nombreArchivo) && nombreArchivo.includes(".");

      const mimeEsGenerico =
        !mimeArchivo ||
        mimeArchivo === "application/octet-stream" ||
        mimeArchivo === "application/binary" ||
        mimeArchivo === "*/*";

      if (
        nombreTieneExtension &&
        !esExcelPorExtension &&
        !esHojaCalculoPorMime &&
        !mimeEsGenerico
      ) {
        Alert.alert(
          "Archivo no compatible",
          "Selecciona un archivo de Excel con extensión .xlsx, .xls o .xlsm.",
        );
        return;
      }

      const uriArchivoLocal = archivoSeleccionado.uri;

      if (!uriArchivoLocal) {
        throw new Error(
          "El selector no pudo crear una copia local del archivo de Excel.",
        );
      }

      const archivoLocal = new File(uriArchivoLocal);

      if (!archivoLocal.exists) {
        throw new Error(
          "La copia local del archivo de Excel no está disponible.",
        );
      }

      let libro;

      try {
        const contenido = await archivoLocal.arrayBuffer();

        /*
         * SheetJS realiza la validación final por contenido.
         * Esto es más confiable que depender solamente del MIME reportado por
         * Android.
         */
        libro = read(new Uint8Array(contenido), {
          type: "array",
          cellText: true,
          cellDates: false,
        });
      } catch (errorLecturaExcel) {
        console.error(
          "El archivo seleccionado no pudo abrirse como Excel:",
          errorLecturaExcel,
        );

        Alert.alert(
          "Archivo no compatible",
          "El archivo seleccionado no pudo interpretarse como una hoja de cálculo válida. Selecciona un archivo .xlsx, .xls o .xlsm.",
        );
        return;
      }

      if (!libro.SheetNames || libro.SheetNames.length === 0) {
        Alert.alert(
          "Excel sin hojas",
          "El archivo seleccionado no contiene hojas de cálculo que puedan leerse.",
        );
        return;
      }

      const hojasPreparadas: HojaExcelVista[] = libro.SheetNames.map(
        (nombreHoja) => {
          const hoja = libro.Sheets[nombreHoja];

          if (!hoja) {
            return {
              nombre: nombreHoja,
              filas: [],
              columnas: [],
              celdas: {},
            };
          }

          const celdas: Record<string, string> = {};
          const filas = new Set<number>();
          const columnas = new Set<number>();

          Object.keys(hoja).forEach((direccion) => {
            if (direccion.startsWith("!")) {
              return;
            }

            const celda = hoja[direccion];

            if (!celda || celda.t === "e") {
              return;
            }

            const valorFormateado =
              typeof celda.w === "string" && celda.w.trim().length > 0
                ? celda.w
                : celda.v !== undefined && celda.v !== null
                  ? String(celda.v)
                  : "";

            const valor = valorFormateado.replace(/\r\n/g, "\n").trim();

            if (!valor) {
              return;
            }

            const posicion = utils.decode_cell(direccion);

            celdas[direccion] = valor;
            filas.add(posicion.r);
            columnas.add(posicion.c);
          });

          return {
            nombre: nombreHoja,
            filas: Array.from(filas).sort((a, b) => a - b),
            columnas: Array.from(columnas).sort((a, b) => a - b),
            celdas,
          };
        },
      );

      const hojasConContenido = hojasPreparadas.filter(
        (hoja) => Object.keys(hoja.celdas).length > 0,
      );

      if (hojasConContenido.length === 0) {
        Alert.alert(
          "Excel vacío",
          "No se encontraron celdas con contenido en el archivo seleccionado.",
        );
        return;
      }

      detenerReconocimientoVoz(true);
      textoVozConfirmadoRef.current = "";
      textoVozTemporalRef.current = "";
      setTextoVozTemporal("");
      setImagenUri(null);
      setNombreArchivoExcel(nombreArchivo);
      setHojasExcel(hojasPreparadas);
      setHojaExcelActiva(hojasConContenido[0].nombre);
      setCeldasExcelSeleccionadas(new Set());
      setModalExcelVisible(true);
    } catch (error) {
      console.error("Error al abrir el archivo de Excel:", error);

      const mensajeError =
        error instanceof Error ? error.message : "Error desconocido";

      Alert.alert(
        "Error de Excel",
        `No fue posible abrir el archivo seleccionado. ${mensajeError}`,
      );
    } finally {
      setCargandoExcel(false);
    }
  };

  const cerrarModalExcel = () => {
    if (cargandoExcel) {
      return;
    }

    setModalExcelVisible(false);
    setNombreArchivoExcel("");
    setHojasExcel([]);
    setHojaExcelActiva("");
    setCeldasExcelSeleccionadas(new Set());
  };

  /*
   * Selecciona o deselecciona una celda individual de Excel.
   */
  const alternarCeldaExcel = (nombreHoja: string, direccion: string) => {
    const clave = crearClaveCeldaExcel(nombreHoja, direccion);

    setCeldasExcelSeleccionadas((seleccionActual) => {
      const nuevaSeleccion = new Set(seleccionActual);

      if (nuevaSeleccion.has(clave)) {
        nuevaSeleccion.delete(clave);
      } else {
        nuevaSeleccion.add(clave);
      }

      return nuevaSeleccion;
    });
  };

  /*
   * Al tocar el encabezado de una columna se seleccionan todos los valores
   * no vacíos de esa columna. Si todos ya estaban seleccionados, se quitan.
   */
  const alternarColumnaExcel = (hoja: HojaExcelVista, columna: number) => {
    const direccionesConContenido = hoja.filas
      .map((fila) => utils.encode_cell({ r: fila, c: columna }))
      .filter((direccion) => Boolean(hoja.celdas[direccion]));

    if (direccionesConContenido.length === 0) {
      return;
    }

    setCeldasExcelSeleccionadas((seleccionActual) => {
      const nuevaSeleccion = new Set(seleccionActual);
      const todasSeleccionadas = direccionesConContenido.every((direccion) =>
        nuevaSeleccion.has(crearClaveCeldaExcel(hoja.nombre, direccion)),
      );

      direccionesConContenido.forEach((direccion) => {
        const clave = crearClaveCeldaExcel(hoja.nombre, direccion);

        if (todasSeleccionadas) {
          nuevaSeleccion.delete(clave);
        } else {
          nuevaSeleccion.add(clave);
        }
      });

      return nuevaSeleccion;
    });
  };

  /*
   * Lleva las celdas elegidas al mismo editor/revisor que utiliza el alta
   * manual. Desde ahí se pueden corregir, mover, eliminar, agregar y guardar.
   */
  const continuarConAlumnosDesdeExcel = () => {
    if (celdasExcelSeleccionadas.size === 0) {
      Alert.alert(
        "Selecciona los nombres",
        "Selecciona por lo menos una celda que contenga el nombre de un alumno.",
      );
      return;
    }

    const valoresSeleccionados: string[] = [];

    hojasExcel.forEach((hoja) => {
      hoja.filas.forEach((fila) => {
        hoja.columnas.forEach((columna) => {
          const direccion = utils.encode_cell({ r: fila, c: columna });
          const clave = crearClaveCeldaExcel(hoja.nombre, direccion);
          const valor = hoja.celdas[direccion];

          if (valor && celdasExcelSeleccionadas.has(clave)) {
            valoresSeleccionados.push(valor);
          }
        });
      });
    });

    const nombresImportados = obtenerNombresDesdeTexto(valoresSeleccionados);

    if (nombresImportados.length === 0) {
      Alert.alert(
        "Sin nombres válidos",
        "Las celdas seleccionadas no contienen nombres válidos. Selecciona únicamente las celdas con los nombres de los alumnos.",
      );
      return;
    }

    setAlumnosDetectados((alumnosActuales) => [
      ...alumnosActuales,
      ...nombresImportados.map((nombre) => ({
        id: Crypto.randomUUID(),
        nombre,
      })),
    ]);

    setModalExcelVisible(false);
    setNombreArchivoExcel("");
    setHojasExcel([]);
    setHojaExcelActiva("");
    setCeldasExcelSeleccionadas(new Set());
    setModoAgregarAlumnos("excel");
    setModalVisible(true);
  };

  /*
   * Abre directamente la pantalla de revisión con un campo vacío
   * para agregar alumnos manualmente.
   */
  const agregarAlumnosManualmente = () => {
    if (!idClase) {
      Alert.alert(
        "Clase no válida",
        "No se encontró el identificador de la clase.",
      );
      return;
    }

    if (procesandoOCR || guardando) {
      return;
    }

    detenerReconocimientoVoz(false);
    textoVozConfirmadoRef.current = "";
    textoVozTemporalRef.current = "";
    setTextoVozTemporal("");
    setImagenUri(null);
    setAlumnosDetectados((alumnosActuales) => [
      ...alumnosActuales,
      {
        id: Crypto.randomUUID(),
        nombre: "",
      },
    ]);
    setModoAgregarAlumnos("manual");
    setModalVisible(true);
  };

  const capturarFotografia = async () => {
    if (!camaraRef.current || !camaraLista || tomandoFotografia) {
      return;
    }

    setTomandoFotografia(true);

    try {
      const fotografia = await camaraRef.current.takePictureAsync({
        quality: 0.45,
        base64: false,
        exif: false,
        skipProcessing: false,
        shutterSound: true,
      });

      if (!fotografia?.uri) {
        throw new Error("La cámara no devolvió una fotografía.");
      }

      setFotografiaTemporal({
        uri: fotografia.uri,
        width: fotografia.width,
        height: fotografia.height,
      });
    } catch (error) {
      console.error("Error al tomar la fotografía:", error);

      const mensajeError =
        error instanceof Error ? error.message : "Error desconocido";

      Alert.alert(
        "Error de cámara",
        `No fue posible tomar la fotografía. ${mensajeError}`,
      );
    } finally {
      setTomandoFotografia(false);
    }
  };

  const repetirFotografia = () => {
    if (tomandoFotografia) {
      return;
    }

    setFotografiaTemporal(null);
    setCamaraLista(false);
  };

  const cerrarCamara = () => {
    if (tomandoFotografia || procesandoOCR) {
      return;
    }

    setCamaraVisible(false);
    setCamaraLista(false);
    setFotografiaTemporal(null);
  };

  const aceptarFotografia = async () => {
    if (!fotografiaTemporal || procesandoOCR) {
      return;
    }

    const fotografiaAceptada = fotografiaTemporal;

    setCamaraVisible(false);
    setCamaraLista(false);
    setFotografiaTemporal(null);

    await procesarFotografia(
      fotografiaAceptada.uri,
      fotografiaAceptada.width,
      fotografiaAceptada.height,
    );
  };

  const cerrarModalRevision = () => {
    if (guardando) {
      return;
    }

    detenerReconocimientoVoz(true);
    textoVozConfirmadoRef.current = "";
    setModalVisible(false);
    setModoAgregarAlumnos(null);
    setImagenUri(null);
    setAlumnosDetectados([]);
  };

  /*
   * Permite agregar más alumnos con fotografía directamente
   * desde la pantalla de revisión sin borrar los nombres ya cargados.
   */
  const agregarAlumnosConFotoDesdeModal = async () => {
    if (guardando || procesandoOCR) {
      return;
    }

    detenerReconocimientoVoz(false);
    setImagenUri(null);

    await tomarFotoLista();
  };

  /*
   * Actualiza únicamente el nombre del alumno seleccionado.
   */
  const actualizarAlumnoDetectado = (idAlumno: string, nombre: string) => {
    if (dictadoVozActivoRef.current) {
      return;
    }

    setAlumnosDetectados((alumnosActuales) =>
      alumnosActuales.map((alumno) =>
        alumno.id === idAlumno
          ? {
              ...alumno,
              nombre,
            }
          : alumno,
      ),
    );
  };

  /*
   * Mueve el alumno seleccionado una posición hacia arriba
   * o hacia abajo dentro de la lista de revisión.
   */
  const moverAlumnoDetectado = (
    idAlumno: string,
    direccion: "arriba" | "abajo",
  ) => {
    if (guardando || dictadoVozActivoRef.current) {
      return;
    }

    setAlumnosDetectados((alumnosActuales) => {
      const indiceActual = alumnosActuales.findIndex(
        (alumno) => alumno.id === idAlumno,
      );

      if (indiceActual === -1) {
        return alumnosActuales;
      }

      const nuevoIndice =
        direccion === "arriba" ? indiceActual - 1 : indiceActual + 1;

      if (nuevoIndice < 0 || nuevoIndice >= alumnosActuales.length) {
        return alumnosActuales;
      }

      const alumnosReordenados = [...alumnosActuales];
      const alumnoMovido = alumnosReordenados[indiceActual];

      alumnosReordenados[indiceActual] = alumnosReordenados[nuevoIndice];
      alumnosReordenados[nuevoIndice] = alumnoMovido;

      return alumnosReordenados;
    });
  };

  /*
   * Elimina solamente el alumno seleccionado de la revisión.
   */
  const eliminarAlumnoDetectado = (idAlumno: string) => {
    if (guardando || dictadoVozActivoRef.current) {
      return;
    }

    setAlumnosDetectados((alumnosActuales) =>
      alumnosActuales.filter((alumno) => alumno.id !== idAlumno),
    );
  };

  /*
   * Conserva la posibilidad de agregar manualmente otro alumno.
   */
  const agregarAlumnoDetectado = () => {
    if (guardando || dictadoVozActivoRef.current) {
      return;
    }

    setAlumnosDetectados((alumnosActuales) => [
      ...alumnosActuales,
      {
        id: Crypto.randomUUID(),
        nombre: "",
      },
    ]);
  };

  /*
   * Guarda cada nombre con:
   *
   * id: UUID único.
   * nombre: nombre detectado o corregido.
   * clase: ID de la clase seleccionada.
   */
  const guardarAlumnos = async () => {
    if (!idClase) {
      Alert.alert(
        "Clase no válida",
        "No se encontró el identificador de la clase.",
      );
      return;
    }

    if (dictadoVozActivoRef.current) {
      Alert.alert(
        "Termina el dictado",
        "Presiona “Terminar dictado” antes de guardar los alumnos.",
      );
      return;
    }

    const nombresRevisados = obtenerNombresDesdeTexto(
      alumnosDetectados.map((alumno) => alumno.nombre),
    );

    if (nombresRevisados.length === 0) {
      Alert.alert(
        "Sin alumnos",
        "Escribe por lo menos el nombre de un alumno.",
      );
      return;
    }

    /*
     * Evita volver a guardar alumnos que ya existen
     * en esta clase.
     */
    const nombresExistentes = new Set(
      alumnos.map((alumno) => {
        return normalizarTexto(alumno.nombre);
      }),
    );

    const nombresNuevos = nombresRevisados.filter((nombre) => {
      return !nombresExistentes.has(normalizarTexto(nombre));
    });

    if (nombresNuevos.length === 0) {
      Alert.alert(
        "Sin alumnos nuevos",
        "Todos los nombres de la lista ya están registrados en esta clase.",
      );
      return;
    }

    setGuardando(true);

    try {
      const db = await ejecutarConTiempoMaximo(obtenerBaseDatos());

      await ejecutarConTiempoMaximo(
        db.withTransactionAsync(async () => {
          const resultadoPosicion = await db.getFirstAsync<{
            maxPosicion: number | null;
          }>(
            "SELECT MAX(posicion) AS maxPosicion FROM alumnos WHERE clase = ?;",
            [idClase],
          );

          let siguientePosicion = (resultadoPosicion?.maxPosicion ?? 0) + 1;

          for (const nombre of nombresNuevos) {
            const idAlumno = Crypto.randomUUID();

            await db.runAsync(
              `
                INSERT INTO alumnos (
                  id,
                  nombre,
                  clase,
                  posicion
                )
                VALUES (?, ?, ?, ?);
              `,
              [idAlumno, nombre, idClase, siguientePosicion],
            );

            siguientePosicion += 1;
          }
        }),
        10000,
      );

      await cargarAlumnos();

      detenerReconocimientoVoz(true);
      textoVozConfirmadoRef.current = "";
      setModalVisible(false);
      setModoAgregarAlumnos(null);
      setImagenUri(null);
      setAlumnosDetectados([]);

      Alert.alert(
        "Alumnos guardados",
        nombresNuevos.length === 1
          ? "Se guardó 1 alumno correctamente."
          : `Se guardaron ${nombresNuevos.length} alumnos correctamente.`,
      );
    } catch (error) {
      console.error("Error al guardar alumnos:", error);

      Alert.alert(
        "Error",
        "No fue posible guardar los alumnos. Inténtalo nuevamente.",
      );
    } finally {
      setGuardando(false);
    }
  };

  /*
   * Mueve un alumno ya guardado y conserva el nuevo orden en SQLite.
   */
  const moverAlumnoGuardado = async (
    idAlumno: string,
    direccion: "arriba" | "abajo",
  ) => {
    if (modificandoAlumnos || alumnoEditandoId) {
      return;
    }

    const indiceActual = alumnos.findIndex((alumno) => alumno.id === idAlumno);

    if (indiceActual === -1) {
      return;
    }

    const nuevoIndice =
      direccion === "arriba" ? indiceActual - 1 : indiceActual + 1;

    if (nuevoIndice < 0 || nuevoIndice >= alumnos.length) {
      return;
    }

    const alumnoActual = alumnos[indiceActual];
    const alumnoIntercambio = alumnos[nuevoIndice];

    setModificandoAlumnos(true);

    try {
      const db = await ejecutarConTiempoMaximo(obtenerBaseDatos());

      await ejecutarConTiempoMaximo(
        db.withTransactionAsync(async () => {
          await db.runAsync(
            "UPDATE alumnos SET posicion = ? WHERE id = ? AND clase = ?;",
            [alumnoIntercambio.posicion, alumnoActual.id, idClase],
          );
          await db.runAsync(
            "UPDATE alumnos SET posicion = ? WHERE id = ? AND clase = ?;",
            [alumnoActual.posicion, alumnoIntercambio.id, idClase],
          );
        }),
      );

      setAlumnos((alumnosActuales) => {
        const indice = alumnosActuales.findIndex(
          (alumno) => alumno.id === idAlumno,
        );

        if (indice === -1) {
          return alumnosActuales;
        }

        const destino = direccion === "arriba" ? indice - 1 : indice + 1;

        if (destino < 0 || destino >= alumnosActuales.length) {
          return alumnosActuales;
        }

        const reordenados = [...alumnosActuales];
        const posicionOrigen = reordenados[indice].posicion;
        const posicionDestino = reordenados[destino].posicion;

        reordenados[indice] = {
          ...reordenados[indice],
          posicion: posicionDestino,
        };
        reordenados[destino] = {
          ...reordenados[destino],
          posicion: posicionOrigen,
        };

        const temporal = reordenados[indice];
        reordenados[indice] = reordenados[destino];
        reordenados[destino] = temporal;

        return reordenados;
      });
    } catch (error) {
      console.error("Error al cambiar la posición del alumno:", error);

      Alert.alert(
        "Error",
        "No fue posible cambiar la posición del alumno. Inténtalo nuevamente.",
      );
    } finally {
      setModificandoAlumnos(false);
    }
  };

  /*
   * Activa la edición del nombre del alumno seleccionado.
   */
  const iniciarEdicionAlumno = (alumno: Alumno) => {
    if (modificandoAlumnos) {
      return;
    }

    setAlumnoEditandoId(alumno.id);
    setNombreAlumnoEditando(alumno.nombre);
  };

  const cancelarEdicionAlumno = () => {
    if (modificandoAlumnos) {
      return;
    }

    setAlumnoEditandoId(null);
    setNombreAlumnoEditando("");
  };

  /*
   * Guarda el nombre editado sin alterar la posición del alumno.
   */
  const guardarEdicionAlumno = async (idAlumno: string) => {
    if (modificandoAlumnos) {
      return;
    }

    const nombreLimpio = capitalizarNombre(
      nombreAlumnoEditando.replace(/\s{2,}/g, " ").trim(),
    );

    if (!nombreLimpio) {
      Alert.alert("Nombre requerido", "Escribe el nombre del alumno.");
      return;
    }

    const nombreDuplicado = alumnos.some((alumno) => {
      return (
        alumno.id !== idAlumno &&
        normalizarTexto(alumno.nombre) === normalizarTexto(nombreLimpio)
      );
    });

    if (nombreDuplicado) {
      Alert.alert(
        "Alumno duplicado",
        "Ya existe un alumno con ese nombre en esta clase.",
      );
      return;
    }

    setModificandoAlumnos(true);

    try {
      const db = await ejecutarConTiempoMaximo(obtenerBaseDatos());

      await ejecutarConTiempoMaximo(
        db.runAsync(
          "UPDATE alumnos SET nombre = ? WHERE id = ? AND clase = ?;",
          [nombreLimpio, idAlumno, idClase],
        ),
      );

      setAlumnos((alumnosActuales) =>
        alumnosActuales.map((alumno) =>
          alumno.id === idAlumno
            ? {
                ...alumno,
                nombre: nombreLimpio,
              }
            : alumno,
        ),
      );

      setAlumnoEditandoId(null);
      setNombreAlumnoEditando("");
    } catch (error) {
      console.error("Error al editar el alumno:", error);

      Alert.alert(
        "Error",
        "No fue posible editar el alumno. Inténtalo nuevamente.",
      );
    } finally {
      setModificandoAlumnos(false);
    }
  };

  /*
   * Elimina un alumno guardado y compacta las posiciones restantes.
   */
  const eliminarAlumnoGuardado = (alumno: Alumno) => {
    if (modificandoAlumnos) {
      return;
    }

    Alert.alert("Eliminar alumno", `¿Deseas eliminar a ${alumno.nombre}?`, [
      {
        text: "Cancelar",
        style: "cancel",
      },
      {
        text: "Eliminar",
        style: "destructive",
        onPress: () => {
          void (async () => {
            setModificandoAlumnos(true);

            try {
              const alumnosRestantes = alumnos.filter(
                (alumnoActual) => alumnoActual.id !== alumno.id,
              );

              const db = await ejecutarConTiempoMaximo(obtenerBaseDatos());

              await ejecutarConTiempoMaximo(
                db.withTransactionAsync(async () => {
                  await db.runAsync(
                    "DELETE FROM alumnos WHERE id = ? AND clase = ?;",
                    [alumno.id, idClase],
                  );

                  for (
                    let indice = 0;
                    indice < alumnosRestantes.length;
                    indice += 1
                  ) {
                    await db.runAsync(
                      "UPDATE alumnos SET posicion = ? WHERE id = ? AND clase = ?;",
                      [indice + 1, alumnosRestantes[indice].id, idClase],
                    );
                  }
                }),
                10000,
              );

              setAlumnos(
                alumnosRestantes.map((alumnoRestante, indice) => ({
                  ...alumnoRestante,
                  posicion: indice + 1,
                })),
              );

              if (alumnoEditandoId === alumno.id) {
                setAlumnoEditandoId(null);
                setNombreAlumnoEditando("");
              }
            } catch (error) {
              console.error("Error al eliminar el alumno:", error);

              Alert.alert(
                "Error",
                "No fue posible eliminar el alumno. Inténtalo nuevamente.",
              );
            } finally {
              setModificandoAlumnos(false);
            }
          })();
        },
      },
    ]);
  };

  const regresarAClase = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace({
      pathname: "/clase/[id]",
      params: {
        id: idClase,
        nombreClase,
        escuela,
        grupo,
        descripcion,
      },
    });
  };

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

        {modalVisible ? (
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            className="flex-1"
          >
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{
                flexGrow: 1,
                paddingHorizontal: 20,
                paddingTop: 8,
                paddingBottom: 24,
              }}
            >
              <View className="flex-1">
                {/* Encabezado de la pantalla */}
                <View className="flex-row items-start">
                  <Pressable
                    onPress={cerrarModalRevision}
                    disabled={guardando}
                    accessibilityRole="button"
                    accessibilityLabel="Regresar a alumnos"
                    className="mr-3 h-11 w-11 items-center justify-center rounded-full bg-blue-100 active:opacity-70 dark:bg-slate-800"
                  >
                    <FontAwesomeIcon
                      icon={faArrowLeft}
                      size={20}
                      color={modoOscuro ? "#60a5fa" : "#2563eb"}
                    />
                  </Pressable>

                  <View className="flex-1 pt-1">
                    <Text className="text-xl font-bold text-slate-900 dark:text-white">
                      Revisar alumnos
                    </Text>

                    <Text className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      {modoAgregarAlumnos === "voz"
                        ? "Di el nombre completo y después la palabra “siguiente” para continuar con otro alumno."
                        : modoAgregarAlumnos === "excel"
                          ? "Revisa los nombres importados desde Excel antes de guardarlos."
                          : "Corrige los nombres antes de guardarlos."}
                    </Text>
                  </View>
                </View>

                {/* Métodos para agregar alumnos desde la pantalla de revisión */}
                <View className="mt-5">
                  <Pressable
                    onPress={agregarAlumnosConFotoDesdeModal}
                    disabled={procesandoOCR || guardando}
                    accessibilityRole="button"
                    accessibilityLabel="Agregar alumnos con una foto"
                    className={`min-h-14 w-full flex-row items-center justify-center rounded-2xl bg-blue-600 px-5 py-4 active:bg-blue-700 ${
                      procesandoOCR || guardando ? "opacity-60" : ""
                    }`}
                  >
                    {procesandoOCR ? (
                      <>
                        <ActivityIndicator size="small" color="#ffffff" />

                        <Text className="ml-3 text-base font-bold text-white">
                          Extrayendo nombres...
                        </Text>
                      </>
                    ) : (
                      <>
                        <FontAwesomeIcon
                          icon={faCamera}
                          size={20}
                          color="#ffffff"
                        />

                        <Text className="ml-3 flex-1 text-center text-base font-bold text-white">
                          Agregar alumnos con una foto
                        </Text>
                      </>
                    )}
                  </Pressable>

                  <Pressable
                    onPress={agregarAlumnosConVoz}
                    disabled={procesandoOCR || guardando}
                    accessibilityRole="button"
                    accessibilityLabel="Agregar alumnos con voz"
                    className={`mt-3 min-h-14 w-full flex-row items-center justify-center rounded-2xl bg-blue-600 px-5 py-4 active:bg-blue-700 ${
                      procesandoOCR || guardando ? "opacity-60" : ""
                    }`}
                  >
                    <FontAwesomeIcon
                      icon={faMicrophone}
                      size={20}
                      color="#ffffff"
                    />

                    <Text className="ml-3 flex-1 text-center text-base font-bold text-white">
                      Agregar alumnos con voz
                    </Text>
                  </Pressable>

                  <Pressable
                    onPress={agregarAlumnosConExcel}
                    disabled={procesandoOCR || guardando || cargandoExcel}
                    accessibilityRole="button"
                    accessibilityLabel="Agregar alumnos con excel"
                    className={`mt-3 min-h-14 w-full flex-row items-center justify-center rounded-2xl bg-blue-600 px-5 py-4 active:bg-blue-700 ${
                      procesandoOCR || guardando || cargandoExcel
                        ? "opacity-60"
                        : ""
                    }`}
                  >
                    {cargandoExcel ? (
                      <>
                        <ActivityIndicator size="small" color="#ffffff" />

                        <Text className="ml-3 flex-1 text-center text-base font-bold text-white">
                          Abriendo Excel...
                        </Text>
                      </>
                    ) : (
                      <>
                        <FontAwesomeIcon
                          icon={faFileExcel}
                          size={20}
                          color="#ffffff"
                        />

                        <Text className="ml-3 flex-1 text-center text-base font-bold text-white">
                          Agregar alumnos con Excel
                        </Text>
                      </>
                    )}
                  </Pressable>

                  <Pressable
                    onPress={agregarAlumnosManualmente}
                    disabled={procesandoOCR || guardando}
                    accessibilityRole="button"
                    accessibilityLabel="Agregar alumnos manualmente"
                    className={`mt-3 min-h-14 w-full flex-row items-center justify-center rounded-2xl bg-blue-600 px-5 py-4 active:bg-blue-700 ${
                      procesandoOCR || guardando ? "opacity-60" : ""
                    }`}
                  >
                    <FontAwesomeIcon icon={faPlus} size={20} color="#ffffff" />

                    <Text className="ml-3 flex-1 text-center text-base font-bold text-white">
                      Agregar alumnos manualmente
                    </Text>
                  </Pressable>
                </View>

                {modoAgregarAlumnos === "voz" ? (
                  <View className="mt-5 rounded-2xl border border-blue-200 bg-blue-50 p-4 dark:border-blue-900 dark:bg-blue-950/40">
                    <View className="flex-row items-center">
                      <View className="h-11 w-11 items-center justify-center rounded-full bg-blue-600">
                        <FontAwesomeIcon
                          icon={reconociendoVoz ? faMicrophone : faStop}
                          size={18}
                          color="#ffffff"
                        />
                      </View>

                      <View className="ml-3 flex-1">
                        <Text className="font-bold text-slate-900 dark:text-white">
                          {dictadoVozActivo
                            ? reconociendoVoz
                              ? "Escuchando nombres..."
                              : "Preparando el micrófono..."
                            : "Dictado detenido"}
                        </Text>

                        <Text className="mt-1 text-sm leading-5 text-slate-600 dark:text-slate-300">
                          Ejemplo: “Juan Pérez siguiente María López siguiente”.
                        </Text>
                      </View>
                    </View>

                    {textoVozTemporal ? (
                      <View className="mt-3 rounded-xl bg-white px-3 py-2 dark:bg-slate-900">
                        <Text className="text-xs font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400">
                          Reconociendo
                        </Text>

                        <Text className="mt-1 text-sm text-slate-700 dark:text-slate-200">
                          {textoVozTemporal}
                        </Text>
                      </View>
                    ) : null}

                    <Pressable
                      onPress={alternarDictadoVoz}
                      disabled={guardando}
                      accessibilityRole="button"
                      accessibilityLabel={
                        dictadoVozActivo
                          ? "Terminar dictado de alumnos"
                          : "Continuar dictado de alumnos"
                      }
                      className={`mt-4 min-h-12 flex-row items-center justify-center rounded-xl px-4 py-3 active:opacity-70 ${
                        dictadoVozActivo ? "bg-red-600" : "bg-blue-600"
                      } ${guardando ? "opacity-60" : ""}`}
                    >
                      <FontAwesomeIcon
                        icon={dictadoVozActivo ? faStop : faMicrophone}
                        size={17}
                        color="#ffffff"
                      />

                      <Text className="ml-2 font-bold text-white">
                        {dictadoVozActivo
                          ? "Terminar dictado"
                          : "Continuar dictado"}
                      </Text>
                    </Pressable>
                  </View>
                ) : null}

                <View className="mb-2 mt-5 flex-row items-center justify-between">
                  <View className="flex-1 pr-3">
                    <Text className="font-semibold text-slate-700 dark:text-slate-200">
                      Nombres detectados
                    </Text>

                    <Text className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      {alumnosDetectados.length === 1
                        ? "1 alumno detectado"
                        : `${alumnosDetectados.length} alumnos detectados`}
                    </Text>
                  </View>

                  <Pressable
                    onPress={agregarAlumnoDetectado}
                    disabled={guardando || dictadoVozActivo}
                    accessibilityRole="button"
                    accessibilityLabel="Agregar otro alumno"
                    className={`min-h-11 flex-row items-center justify-center rounded-xl bg-blue-100 px-3 py-2 active:opacity-70 dark:bg-blue-950 ${
                      guardando || dictadoVozActivo ? "opacity-40" : ""
                    }`}
                  >
                    <FontAwesomeIcon
                      icon={faPlus}
                      size={16}
                      color={modoOscuro ? "#60a5fa" : "#2563eb"}
                    />

                    <Text className="ml-2 font-bold text-blue-600 dark:text-blue-400">
                      Agregar
                    </Text>
                  </Pressable>
                </View>

                {alumnosDetectados.length === 0 ? (
                  <View className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 dark:border-slate-700 dark:bg-slate-950">
                    <Text className="text-center text-base font-semibold text-slate-700 dark:text-slate-200">
                      No hay alumnos en la revisión
                    </Text>

                    <Text className="mt-2 text-center text-sm leading-5 text-slate-500 dark:text-slate-400">
                      Presiona Agregar para escribir un nombre manualmente.
                    </Text>
                  </View>
                ) : (
                  <View>
                    {alumnosDetectados.map((alumno, indice) => (
                      <View
                        key={alumno.id}
                        className={`flex-row items-center ${
                          indice > 0 ? "mt-3" : ""
                        }`}
                      >
                        <View className="mr-2 flex-row items-center">
                          <Pressable
                            onPress={() =>
                              moverAlumnoDetectado(alumno.id, "arriba")
                            }
                            disabled={
                              guardando || dictadoVozActivo || indice === 0
                            }
                            accessibilityRole="button"
                            accessibilityLabel={`Mover alumno ${indice + 1} hacia arriba`}
                            className={`h-9 w-9 items-center justify-center rounded-xl bg-blue-100 active:opacity-70 dark:bg-blue-950 ${
                              guardando || dictadoVozActivo || indice === 0
                                ? "opacity-40"
                                : ""
                            }`}
                          >
                            <FontAwesomeIcon
                              icon={faArrowUp}
                              size={15}
                              color={modoOscuro ? "#60a5fa" : "#2563eb"}
                            />
                          </Pressable>

                          <Pressable
                            onPress={() =>
                              moverAlumnoDetectado(alumno.id, "abajo")
                            }
                            disabled={
                              guardando ||
                              dictadoVozActivo ||
                              indice === alumnosDetectados.length - 1
                            }
                            accessibilityRole="button"
                            accessibilityLabel={`Mover alumno ${indice + 1} hacia abajo`}
                            className={`ml-1 h-9 w-9 items-center justify-center rounded-xl bg-blue-100 active:opacity-70 dark:bg-blue-950 ${
                              guardando ||
                              dictadoVozActivo ||
                              indice === alumnosDetectados.length - 1
                                ? "opacity-40"
                                : ""
                            }`}
                          >
                            <FontAwesomeIcon
                              icon={faArrowDown}
                              size={15}
                              color={modoOscuro ? "#60a5fa" : "#2563eb"}
                            />
                          </Pressable>
                        </View>

                        <View className="mr-3 h-11 w-11 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-950">
                          <Text className="font-bold text-blue-600 dark:text-blue-400">
                            {indice + 1}
                          </Text>
                        </View>

                        <TextInput
                          value={alumno.nombre}
                          onChangeText={(nombre) =>
                            actualizarAlumnoDetectado(alumno.id, nombre)
                          }
                          editable={!guardando && !dictadoVozActivo}
                          autoFocus={
                            modoAgregarAlumnos === "manual" && indice === 0
                          }
                          autoCapitalize="words"
                          autoCorrect={false}
                          returnKeyType="next"
                          placeholder="Nombre completo del alumno"
                          placeholderTextColor={
                            modoOscuro ? "#94a3b8" : "#64748b"
                          }
                          className="min-h-12 flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-base text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                        />

                        <Pressable
                          onPress={() => eliminarAlumnoDetectado(alumno.id)}
                          disabled={guardando || dictadoVozActivo}
                          accessibilityRole="button"
                          accessibilityLabel={`Eliminar alumno ${indice + 1}`}
                          className={`ml-3 h-12 w-12 items-center justify-center rounded-2xl bg-red-100 active:opacity-70 dark:bg-red-950 ${
                            guardando || dictadoVozActivo ? "opacity-40" : ""
                          }`}
                        >
                          <FontAwesomeIcon
                            icon={faTrash}
                            size={18}
                            color={modoOscuro ? "#f87171" : "#dc2626"}
                          />
                        </Pressable>
                      </View>
                    ))}
                  </View>
                )}

                <Text className="mt-3 text-sm leading-5 text-slate-500 dark:text-slate-400">
                  Cada alumno aparece por separado. Puedes moverlo, corregir su
                  nombre, eliminarlo o agregar otro antes de guardar.
                </Text>

                {/* Botones de la pantalla */}
                <View className="mt-6 flex-row">
                  <Pressable
                    onPress={cerrarModalRevision}
                    disabled={guardando}
                    accessibilityRole="button"
                    accessibilityLabel="Cancelar guardado"
                    className="mr-3 min-h-14 flex-1 items-center justify-center rounded-2xl bg-slate-200 px-4 py-4 active:opacity-70 dark:bg-slate-800"
                  >
                    <Text className="text-base font-bold text-slate-800 dark:text-slate-200">
                      Cancelar
                    </Text>
                  </Pressable>

                  <Pressable
                    onPress={guardarAlumnos}
                    disabled={guardando || dictadoVozActivo}
                    accessibilityRole="button"
                    accessibilityLabel="Guardar alumnos"
                    className={`min-h-14 flex-1 flex-row items-center justify-center rounded-2xl bg-blue-600 px-4 py-4 active:bg-blue-700 ${
                      guardando || dictadoVozActivo ? "opacity-60" : ""
                    }`}
                  >
                    {guardando ? (
                      <ActivityIndicator size="small" color="#ffffff" />
                    ) : (
                      <>
                        <FontAwesomeIcon
                          icon={faFloppyDisk}
                          size={18}
                          color="#ffffff"
                        />

                        <Text className="ml-2 text-base font-bold text-white">
                          Guardar
                        </Text>
                      </>
                    )}
                  </Pressable>
                </View>
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        ) : (
          <ScrollView
            className="flex-1"
            contentContainerStyle={{
              flexGrow: 1,
            }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <View className="flex-1 px-5 pb-6 pt-2">
              {/* Botón regresar y botón de modo claro y oscuro */}
              <View className="flex-row items-center justify-between">
                <Pressable
                  onPress={regresarAClase}
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
                  Alumnos
                </Text>
              </View>

              {/* Información de la clase */}
              <View className="mt-5 rounded-2xl border border-blue-100 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
                <View>
                  <Text className="text-sm font-semibold text-blue-600 dark:text-blue-400">
                    Escuela
                  </Text>

                  <Text className="mt-1 text-base text-black dark:text-slate-200">
                    {escuela}
                  </Text>
                </View>

                <View className="mt-4">
                  <Text className="text-sm font-semibold text-blue-600 dark:text-blue-400">
                    Grupo
                  </Text>

                  <Text className="mt-1 text-base text-black dark:text-slate-200">
                    {grupo}
                  </Text>
                </View>

                <View className="mt-4">
                  <Text className="text-sm font-semibold text-blue-600 dark:text-blue-400">
                    Descripción
                  </Text>

                  <Text className="mt-1 text-base leading-6 text-black dark:text-slate-200">
                    {descripcion}
                  </Text>
                </View>
              </View>

              {/* Contenido de alumnos */}
              <View className="mt-6 flex-1">
                {/* Métodos para agregar alumnos colocados arriba de la lista. */}
                <View className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                  <Pressable
                    onPress={tomarFotoLista}
                    disabled={procesandoOCR}
                    accessibilityRole="button"
                    accessibilityLabel="Agregar alumnos con una foto"
                    className={`min-h-14 w-full flex-row items-center justify-center rounded-2xl bg-blue-600 px-5 py-4 active:bg-blue-700 ${
                      procesandoOCR ? "opacity-60" : ""
                    }`}
                  >
                    {procesandoOCR ? (
                      <>
                        <ActivityIndicator size="small" color="#ffffff" />
                        <Text className="ml-3 flex-1 text-center text-base font-bold text-white">
                          Extrayendo nombres...
                        </Text>
                      </>
                    ) : (
                      <>
                        <FontAwesomeIcon
                          icon={faCamera}
                          size={20}
                          color="#ffffff"
                        />
                        <Text className="ml-3 flex-1 text-center text-base font-bold text-white">
                          Agregar alumnos con una foto
                        </Text>
                      </>
                    )}
                  </Pressable>

                  <Pressable
                    onPress={agregarAlumnosConVoz}
                    disabled={procesandoOCR || guardando}
                    accessibilityRole="button"
                    accessibilityLabel="Agregar alumnos con voz"
                    className={`mt-3 min-h-14 w-full flex-row items-center justify-center rounded-2xl bg-blue-600 px-5 py-4 active:bg-blue-700 ${
                      procesandoOCR || guardando ? "opacity-60" : ""
                    }`}
                  >
                    <FontAwesomeIcon
                      icon={faMicrophone}
                      size={20}
                      color="#ffffff"
                    />
                    <Text className="ml-3 flex-1 text-center text-base font-bold text-white">
                      Agregar alumnos con voz
                    </Text>
                  </Pressable>

                  <Pressable
                    onPress={agregarAlumnosConExcel}
                    disabled={procesandoOCR || guardando || cargandoExcel}
                    accessibilityRole="button"
                    accessibilityLabel="Agregar alumnos con excel"
                    className={`mt-3 min-h-14 w-full flex-row items-center justify-center rounded-2xl bg-blue-600 px-5 py-4 active:bg-blue-700 ${
                      procesandoOCR || guardando || cargandoExcel
                        ? "opacity-60"
                        : ""
                    }`}
                  >
                    {cargandoExcel ? (
                      <>
                        <ActivityIndicator size="small" color="#ffffff" />
                        <Text className="ml-3 flex-1 text-center text-base font-bold text-white">
                          Abriendo Excel...
                        </Text>
                      </>
                    ) : (
                      <>
                        <FontAwesomeIcon
                          icon={faFileExcel}
                          size={20}
                          color="#ffffff"
                        />
                        <Text className="ml-3 flex-1 text-center text-base font-bold text-white">
                          Agregar alumnos con Excel
                        </Text>
                      </>
                    )}
                  </Pressable>

                  <Pressable
                    onPress={agregarAlumnosManualmente}
                    disabled={procesandoOCR || guardando}
                    accessibilityRole="button"
                    accessibilityLabel="Agregar alumnos manualmente"
                    className={`mt-3 min-h-14 w-full flex-row items-center justify-center rounded-2xl bg-blue-600 px-5 py-4 active:bg-blue-700 ${
                      procesandoOCR || guardando ? "opacity-60" : ""
                    }`}
                  >
                    <FontAwesomeIcon icon={faPlus} size={20} color="#ffffff" />
                    <Text className="ml-3 flex-1 text-center text-base font-bold text-white">
                      Agregar alumnos manualmente
                    </Text>
                  </Pressable>
                </View>

                {/* Buscador de alumnos */}
                <TextInput
                  value={busquedaAlumno}
                  onChangeText={setBusquedaAlumno}
                  placeholder="Buscar alumno..."
                  placeholderTextColor={modoOscuro ? "#94a3b8" : "#64748b"}
                  autoCapitalize="words"
                  autoCorrect={false}
                  returnKeyType="search"
                  accessibilityLabel="Buscar alumnos"
                  className="mb-4 min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base text-black dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                />

                {cargando ? null : alumnos.length === 0 ? (
                  <View className="items-center justify-center rounded-2xl border border-dashed border-blue-300 bg-blue-50 px-5 py-8 dark:border-blue-700 dark:bg-slate-900">
                    <View className="h-16 w-16 items-center justify-center rounded-full bg-blue-100 dark:bg-slate-800">
                      <FontAwesomeIcon
                        icon={faUsers}
                        size={30}
                        color={modoOscuro ? "#60a5fa" : "#2563eb"}
                      />
                    </View>

                    <Text className="mt-4 text-center text-xl font-bold text-black dark:text-white">
                      Alumnos
                    </Text>

                    <Text className="mt-2 text-center text-sm text-slate-500 dark:text-slate-400">
                      No hay alumnos registrados en esta clase.
                    </Text>
                  </View>
                ) : alumnosFiltrados.length === 0 ? (
                  <View className="items-center justify-center rounded-2xl border border-dashed border-blue-300 bg-blue-50 px-5 py-8 dark:border-blue-700 dark:bg-slate-900">
                    <View className="h-16 w-16 items-center justify-center rounded-full bg-blue-100 dark:bg-slate-800">
                      <FontAwesomeIcon
                        icon={faUsers}
                        size={30}
                        color={modoOscuro ? "#60a5fa" : "#2563eb"}
                      />
                    </View>

                    <Text className="mt-4 text-center text-xl font-bold text-black dark:text-white">
                      Sin resultados
                    </Text>

                    <Text className="mt-2 text-center text-sm text-slate-500 dark:text-slate-400">
                      No se encontraron alumnos con ese nombre.
                    </Text>
                  </View>
                ) : (
                  <View className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                    <View className="mb-4 flex-row items-center">
                      <View className="h-12 w-12 items-center justify-center rounded-xl bg-blue-100 dark:bg-blue-950">
                        <FontAwesomeIcon
                          icon={faUsers}
                          size={23}
                          color={modoOscuro ? "#60a5fa" : "#2563eb"}
                        />
                      </View>

                      <View className="ml-4 flex-1">
                        <Text className="text-xl font-bold text-black dark:text-white">
                          Alumnos
                        </Text>

                        <Text className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                          {busquedaAlumno.trim()
                            ? alumnosFiltrados.length === 1
                              ? "1 alumno encontrado"
                              : `${alumnosFiltrados.length} alumnos encontrados`
                            : alumnos.length === 1
                              ? "1 alumno registrado"
                              : `${alumnos.length} alumnos registrados`}
                        </Text>
                      </View>
                    </View>

                    {alumnosFiltrados.map((alumno, indiceFiltrado) => {
                      const indice = alumnos.findIndex(
                        (item) => item.id === alumno.id,
                      );
                      const editandoEsteAlumno = alumnoEditandoId === alumno.id;
                      const accionesBloqueadas =
                        modificandoAlumnos || alumnoEditandoId !== null;
                      const deshabilitarSubir =
                        accionesBloqueadas || indice === 0;
                      const deshabilitarBajar =
                        accionesBloqueadas || indice === alumnos.length - 1;

                      return (
                        <View
                          key={alumno.id}
                          className={`flex-row items-center py-3 ${
                            indiceFiltrado < alumnosFiltrados.length - 1
                              ? "border-b border-slate-200 dark:border-slate-700"
                              : ""
                          }`}
                        >
                          <View className="mr-2 gap-1">
                            <Pressable
                              onPress={() =>
                                void moverAlumnoGuardado(alumno.id, "arriba")
                              }
                              disabled={deshabilitarSubir}
                              accessibilityRole="button"
                              accessibilityLabel={`Subir a ${alumno.nombre}`}
                              className={`h-8 w-8 items-center justify-center rounded-lg bg-blue-100 active:opacity-70 dark:bg-slate-800 ${
                                deshabilitarSubir ? "opacity-35" : ""
                              }`}
                            >
                              <FontAwesomeIcon
                                icon={faArrowUp}
                                size={15}
                                color={modoOscuro ? "#60a5fa" : "#2563eb"}
                              />
                            </Pressable>

                            <Pressable
                              onPress={() =>
                                void moverAlumnoGuardado(alumno.id, "abajo")
                              }
                              disabled={deshabilitarBajar}
                              accessibilityRole="button"
                              accessibilityLabel={`Bajar a ${alumno.nombre}`}
                              className={`h-8 w-8 items-center justify-center rounded-lg bg-blue-100 active:opacity-70 dark:bg-slate-800 ${
                                deshabilitarBajar ? "opacity-35" : ""
                              }`}
                            >
                              <FontAwesomeIcon
                                icon={faArrowDown}
                                size={15}
                                color={modoOscuro ? "#60a5fa" : "#2563eb"}
                              />
                            </Pressable>
                          </View>

                          <View className="h-9 w-9 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-950">
                            <Text className="font-bold text-blue-600 dark:text-blue-400">
                              {indice + 1}
                            </Text>
                          </View>

                          {editandoEsteAlumno ? (
                            <TextInput
                              value={nombreAlumnoEditando}
                              onChangeText={setNombreAlumnoEditando}
                              editable={!modificandoAlumnos}
                              autoFocus
                              returnKeyType="done"
                              onSubmitEditing={() =>
                                void guardarEdicionAlumno(alumno.id)
                              }
                              className="ml-3 min-h-10 flex-1 rounded-xl border border-blue-300 bg-white px-3 py-2 text-base text-black dark:border-blue-700 dark:bg-slate-800 dark:text-white"
                              placeholder="Nombre del alumno"
                              placeholderTextColor={
                                modoOscuro ? "#94a3b8" : "#64748b"
                              }
                            />
                          ) : (
                            <Text className="ml-3 flex-1 text-base font-medium text-black dark:text-slate-200">
                              {alumno.nombre}
                            </Text>
                          )}

                          {editandoEsteAlumno ? (
                            <View className="ml-2 flex-row gap-1">
                              <Pressable
                                onPress={() =>
                                  void guardarEdicionAlumno(alumno.id)
                                }
                                disabled={modificandoAlumnos}
                                accessibilityRole="button"
                                accessibilityLabel={`Guardar cambios de ${alumno.nombre}`}
                                className={`h-9 w-9 items-center justify-center rounded-lg bg-emerald-100 active:opacity-70 dark:bg-emerald-950 ${
                                  modificandoAlumnos ? "opacity-40" : ""
                                }`}
                              >
                                <FontAwesomeIcon
                                  icon={faFloppyDisk}
                                  size={15}
                                  color={modoOscuro ? "#34d399" : "#059669"}
                                />
                              </Pressable>

                              <Pressable
                                onPress={cancelarEdicionAlumno}
                                disabled={modificandoAlumnos}
                                accessibilityRole="button"
                                accessibilityLabel="Cancelar edición"
                                className={`h-9 w-9 items-center justify-center rounded-lg bg-slate-100 active:opacity-70 dark:bg-slate-800 ${
                                  modificandoAlumnos ? "opacity-40" : ""
                                }`}
                              >
                                <FontAwesomeIcon
                                  icon={faXmark}
                                  size={16}
                                  color={modoOscuro ? "#cbd5e1" : "#475569"}
                                />
                              </Pressable>
                            </View>
                          ) : (
                            <View className="ml-2 flex-row gap-1">
                              <Pressable
                                onPress={() => iniciarEdicionAlumno(alumno)}
                                disabled={accionesBloqueadas}
                                accessibilityRole="button"
                                accessibilityLabel={`Editar a ${alumno.nombre}`}
                                className={`h-9 w-9 items-center justify-center rounded-lg bg-amber-100 active:opacity-70 dark:bg-amber-950 ${
                                  accionesBloqueadas ? "opacity-40" : ""
                                }`}
                              >
                                <FontAwesomeIcon
                                  icon={faPen}
                                  size={15}
                                  color={modoOscuro ? "#fbbf24" : "#d97706"}
                                />
                              </Pressable>

                              <Pressable
                                onPress={() => eliminarAlumnoGuardado(alumno)}
                                disabled={accionesBloqueadas}
                                accessibilityRole="button"
                                accessibilityLabel={`Eliminar a ${alumno.nombre}`}
                                className={`h-9 w-9 items-center justify-center rounded-lg bg-red-100 active:opacity-70 dark:bg-red-950 ${
                                  accionesBloqueadas ? "opacity-40" : ""
                                }`}
                              >
                                <FontAwesomeIcon
                                  icon={faTrash}
                                  size={15}
                                  color={modoOscuro ? "#f87171" : "#dc2626"}
                                />
                              </Pressable>
                            </View>
                          )}
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>
            </View>
          </ScrollView>
        )}

        {/* Cámara integrada para evitar el cierre de la aplicación en Android */}
        <Modal
          visible={camaraVisible}
          animationType="fade"
          presentationStyle="fullScreen"
          onRequestClose={cerrarCamara}
        >
          <View className="flex-1 bg-black">
            {fotografiaTemporal ? (
              <>
                <Image
                  source={{
                    uri: fotografiaTemporal.uri,
                  }}
                  resizeMode="contain"
                  style={{
                    flex: 1,
                    width: "100%",
                    backgroundColor: "#000000",
                  }}
                />

                <SafeAreaView
                  edges={["left", "right", "bottom"]}
                  className="bg-black"
                >
                  <View className="flex-row items-center justify-between px-8 pb-5 pt-4">
                    <Pressable
                      onPress={repetirFotografia}
                      disabled={tomandoFotografia || procesandoOCR}
                      accessibilityRole="button"
                      accessibilityLabel="Borrar fotografía y tomar otra"
                      className="h-16 w-16 items-center justify-center rounded-full bg-red-600 active:opacity-70"
                    >
                      <FontAwesomeIcon
                        icon={faXmark}
                        size={28}
                        color="#ffffff"
                      />
                    </Pressable>

                    <Pressable
                      onPress={aceptarFotografia}
                      disabled={procesandoOCR}
                      accessibilityRole="button"
                      accessibilityLabel="Aceptar fotografía"
                      className={`h-16 w-16 items-center justify-center rounded-full bg-blue-600 active:opacity-70 ${
                        procesandoOCR ? "opacity-60" : ""
                      }`}
                    >
                      {procesandoOCR ? (
                        <ActivityIndicator size="small" color="#ffffff" />
                      ) : (
                        <Text className="text-3xl font-bold text-white">✓</Text>
                      )}
                    </Pressable>
                  </View>
                </SafeAreaView>
              </>
            ) : (
              <>
                <CameraView
                  ref={camaraRef}
                  style={{
                    flex: 1,
                  }}
                  facing="back"
                  flash="off"
                  ratio="4:3"
                  animateShutter
                  onCameraReady={() => setCamaraLista(true)}
                  onMountError={(error) => {
                    console.error("Error al montar la cámara:", error);

                    Alert.alert(
                      "Error de cámara",
                      "No fue posible iniciar la cámara del dispositivo.",
                      [
                        {
                          text: "Cerrar",
                          onPress: cerrarCamara,
                        },
                      ],
                    );
                  }}
                />

                <SafeAreaView
                  edges={["top", "left", "right"]}
                  className="absolute left-0 right-0 top-0"
                >
                  <View className="px-5 pt-2">
                    <Pressable
                      onPress={cerrarCamara}
                      accessibilityRole="button"
                      accessibilityLabel="Cerrar cámara"
                      className="h-12 w-12 items-center justify-center rounded-full bg-black/60 active:opacity-70"
                    >
                      <FontAwesomeIcon
                        icon={faXmark}
                        size={24}
                        color="#ffffff"
                      />
                    </Pressable>
                  </View>
                </SafeAreaView>

                <SafeAreaView
                  edges={["left", "right", "bottom"]}
                  className="absolute bottom-0 left-0 right-0 bg-black/60"
                >
                  <View className="items-center px-5 pb-5 pt-4">
                    <Text className="mb-4 text-center text-sm text-white">
                      Coloca la lista completa dentro de la imagen y procura que
                      los nombres se vean nítidos.
                    </Text>

                    <Pressable
                      onPress={capturarFotografia}
                      disabled={!camaraLista || tomandoFotografia}
                      accessibilityRole="button"
                      accessibilityLabel="Tomar fotografía"
                      className={`h-20 w-20 items-center justify-center rounded-full border-4 border-white bg-white/30 active:opacity-70 ${
                        !camaraLista || tomandoFotografia ? "opacity-50" : ""
                      }`}
                    >
                      {tomandoFotografia ? (
                        <ActivityIndicator size="large" color="#ffffff" />
                      ) : (
                        <View className="h-14 w-14 rounded-full bg-white" />
                      )}
                    </Pressable>
                  </View>
                </SafeAreaView>
              </>
            )}
          </View>
        </Modal>

        {/* Selector de celdas del archivo de Excel */}
        <Modal
          visible={modalExcelVisible}
          animationType="slide"
          presentationStyle="fullScreen"
          onRequestClose={cerrarModalExcel}
        >
          <SafeAreaView
            edges={["top", "left", "right", "bottom"]}
            style={{
              flex: 1,
              backgroundColor: modoOscuro ? "#020617" : "#f8fafc",
            }}
          >
            <View className="flex-1">
              <View className="border-b border-slate-200 bg-white px-5 pb-4 pt-2 dark:border-slate-700 dark:bg-slate-900">
                <View className="flex-row items-center justify-between">
                  <View className="flex-1 pr-4">
                    <Text className="text-xl font-bold text-slate-900 dark:text-white">
                      Seleccionar nombres de Excel
                    </Text>

                    <Text
                      numberOfLines={1}
                      className="mt-1 text-sm text-slate-500 dark:text-slate-400"
                    >
                      {nombreArchivoExcel}
                    </Text>
                  </View>

                  <Pressable
                    onPress={cerrarModalExcel}
                    accessibilityRole="button"
                    accessibilityLabel="Cerrar archivo de Excel"
                    className="h-11 w-11 items-center justify-center rounded-full bg-slate-100 active:opacity-70 dark:bg-slate-800"
                  >
                    <FontAwesomeIcon
                      icon={faXmark}
                      size={20}
                      color={modoOscuro ? "#e2e8f0" : "#334155"}
                    />
                  </Pressable>
                </View>

                <View className="mt-4 rounded-2xl border border-blue-200 bg-blue-50 p-4 dark:border-blue-900 dark:bg-blue-950/40">
                  <Text className="font-bold text-blue-700 dark:text-blue-300">
                    Selecciona únicamente las celdas que contienen los nombres
                    de los alumnos.
                  </Text>

                  <Text className="mt-2 text-sm leading-5 text-slate-600 dark:text-slate-300">
                    Puedes cambiar de hoja sin perder tu selección. Toca una
                    celda para marcarla. También puedes tocar la letra de una
                    columna para seleccionar todos sus valores con contenido.
                  </Text>
                </View>

                <View className="mt-4 flex-row items-center justify-between">
                  <Text className="font-semibold text-slate-700 dark:text-slate-200">
                    Hojas del archivo
                  </Text>

                  <Text className="text-sm font-bold text-blue-600 dark:text-blue-400">
                    {celdasExcelSeleccionadas.size === 1
                      ? "1 celda seleccionada"
                      : `${celdasExcelSeleccionadas.size} celdas seleccionadas`}
                  </Text>
                </View>

                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  className="mt-3"
                  contentContainerStyle={{
                    paddingRight: 8,
                  }}
                >
                  {hojasExcel.map((hoja) => {
                    const activa = hoja.nombre === hojaExcelActiva;
                    const tieneContenido = Object.keys(hoja.celdas).length > 0;

                    return (
                      <Pressable
                        key={hoja.nombre}
                        onPress={() => {
                          if (tieneContenido) {
                            setHojaExcelActiva(hoja.nombre);
                          }
                        }}
                        disabled={!tieneContenido}
                        accessibilityRole="button"
                        accessibilityLabel={`Abrir hoja ${hoja.nombre}`}
                        className={`mr-2 rounded-xl border px-4 py-3 ${
                          activa
                            ? "border-blue-600 bg-blue-600"
                            : "border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-800"
                        } ${!tieneContenido ? "opacity-40" : ""}`}
                      >
                        <Text
                          className={`font-bold ${
                            activa
                              ? "text-white"
                              : "text-slate-700 dark:text-slate-200"
                          }`}
                        >
                          {hoja.nombre}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>

              <View className="flex-1 bg-slate-100 dark:bg-slate-950">
                {(() => {
                  const hojaActiva = hojasExcel.find(
                    (hoja) => hoja.nombre === hojaExcelActiva,
                  );

                  if (!hojaActiva || hojaActiva.filas.length === 0) {
                    return (
                      <View className="flex-1 items-center justify-center px-6">
                        <Text className="text-center text-lg font-bold text-slate-800 dark:text-slate-100">
                          Esta hoja no tiene contenido
                        </Text>

                        <Text className="mt-2 text-center text-sm text-slate-500 dark:text-slate-400">
                          Selecciona otra hoja del archivo.
                        </Text>
                      </View>
                    );
                  }

                  return (
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator
                      contentContainerStyle={{
                        padding: 12,
                      }}
                    >
                      <ScrollView
                        showsVerticalScrollIndicator
                        nestedScrollEnabled
                      >
                        <View className="overflow-hidden rounded-xl border border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900">
                          <View className="flex-row">
                            <View className="h-12 w-14 items-center justify-center border-b border-r border-slate-300 bg-slate-200 dark:border-slate-700 dark:bg-slate-800">
                              <Text className="text-xs font-bold text-slate-500 dark:text-slate-400">
                                #
                              </Text>
                            </View>

                            {hojaActiva.columnas.map((columna) => {
                              const direccionesConContenido = hojaActiva.filas
                                .map((fila) =>
                                  utils.encode_cell({ r: fila, c: columna }),
                                )
                                .filter((direccion) =>
                                  Boolean(hojaActiva.celdas[direccion]),
                                );

                              const columnaCompletaSeleccionada =
                                direccionesConContenido.length > 0 &&
                                direccionesConContenido.every((direccion) =>
                                  celdasExcelSeleccionadas.has(
                                    crearClaveCeldaExcel(
                                      hojaActiva.nombre,
                                      direccion,
                                    ),
                                  ),
                                );

                              return (
                                <Pressable
                                  key={`cabecera-${columna}`}
                                  onPress={() =>
                                    alternarColumnaExcel(hojaActiva, columna)
                                  }
                                  accessibilityRole="button"
                                  accessibilityLabel={`Seleccionar columna ${obtenerLetraColumnaExcel(
                                    columna,
                                  )}`}
                                  className={`h-12 w-44 items-center justify-center border-b border-r border-slate-300 px-2 active:opacity-70 dark:border-slate-700 ${
                                    columnaCompletaSeleccionada
                                      ? "bg-blue-600"
                                      : "bg-slate-200 dark:bg-slate-800"
                                  }`}
                                >
                                  <Text
                                    className={`font-bold ${
                                      columnaCompletaSeleccionada
                                        ? "text-white"
                                        : "text-slate-700 dark:text-slate-200"
                                    }`}
                                  >
                                    {obtenerLetraColumnaExcel(columna)}
                                  </Text>
                                </Pressable>
                              );
                            })}
                          </View>

                          {hojaActiva.filas.map((fila) => (
                            <View key={`fila-${fila}`} className="flex-row">
                              <View className="min-h-16 w-14 items-center justify-center border-b border-r border-slate-300 bg-slate-200 px-1 dark:border-slate-700 dark:bg-slate-800">
                                <Text className="text-xs font-bold text-slate-600 dark:text-slate-300">
                                  {fila + 1}
                                </Text>
                              </View>

                              {hojaActiva.columnas.map((columna) => {
                                const direccion = utils.encode_cell({
                                  r: fila,
                                  c: columna,
                                });
                                const valor =
                                  hojaActiva.celdas[direccion] ?? "";
                                const clave = crearClaveCeldaExcel(
                                  hojaActiva.nombre,
                                  direccion,
                                );
                                const seleccionada =
                                  celdasExcelSeleccionadas.has(clave);

                                return (
                                  <Pressable
                                    key={`${fila}-${columna}`}
                                    onPress={() => {
                                      if (valor) {
                                        alternarCeldaExcel(
                                          hojaActiva.nombre,
                                          direccion,
                                        );
                                      }
                                    }}
                                    disabled={!valor}
                                    accessibilityRole="button"
                                    accessibilityLabel={
                                      valor
                                        ? `${direccion}: ${valor}`
                                        : `${direccion} vacía`
                                    }
                                    className={`min-h-16 w-44 justify-center border-b border-r border-slate-300 px-3 py-2 dark:border-slate-700 ${
                                      seleccionada
                                        ? "bg-blue-100 dark:bg-blue-950"
                                        : valor
                                          ? "bg-white dark:bg-slate-900"
                                          : "bg-slate-50 dark:bg-slate-950"
                                    }`}
                                  >
                                    {valor ? (
                                      <>
                                        <Text className="text-[10px] font-bold uppercase tracking-wide text-blue-600 dark:text-blue-400">
                                          {direccion}
                                        </Text>

                                        <Text
                                          numberOfLines={3}
                                          className={`mt-1 text-sm ${
                                            seleccionada
                                              ? "font-bold text-blue-700 dark:text-blue-300"
                                              : "text-slate-800 dark:text-slate-100"
                                          }`}
                                        >
                                          {seleccionada ? "✓ " : ""}
                                          {valor}
                                        </Text>
                                      </>
                                    ) : null}
                                  </Pressable>
                                );
                              })}
                            </View>
                          ))}
                        </View>
                      </ScrollView>
                    </ScrollView>
                  );
                })()}
              </View>

              <View className="border-t border-slate-200 bg-white px-5 py-4 dark:border-slate-700 dark:bg-slate-900">
                <View className="flex-row">
                  <Pressable
                    onPress={cerrarModalExcel}
                    accessibilityRole="button"
                    accessibilityLabel="Cancelar selección de Excel"
                    className="mr-3 min-h-14 flex-1 items-center justify-center rounded-2xl bg-slate-200 px-4 py-4 active:opacity-70 dark:bg-slate-800"
                  >
                    <Text className="text-base font-bold text-slate-800 dark:text-slate-200">
                      Cancelar
                    </Text>
                  </Pressable>

                  <Pressable
                    onPress={continuarConAlumnosDesdeExcel}
                    disabled={celdasExcelSeleccionadas.size === 0}
                    accessibilityRole="button"
                    accessibilityLabel="Continuar con los alumnos seleccionados"
                    className={`min-h-14 flex-1 items-center justify-center rounded-2xl bg-blue-600 px-4 py-4 active:bg-blue-700 ${
                      celdasExcelSeleccionadas.size === 0 ? "opacity-50" : ""
                    }`}
                  >
                    <Text className="text-base font-bold text-white">
                      Continuar
                    </Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </SafeAreaView>
        </Modal>
      </SafeAreaView>
    </>
  );
}
