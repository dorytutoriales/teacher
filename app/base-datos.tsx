import {
    obtenerDiagnosticoBaseDatos,
    TablaDiagnosticoSQLite,
} from "@/lib/database";
import {
    faArrowLeft,
    faArrowsRotate,
    faDatabase,
    faMoon,
    faSun,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-native-fontawesome";
import { Stack, useRouter } from "expo-router";
import { useColorScheme } from "nativewind";
import { useCallback, useEffect, useRef, useState } from "react";
import {
    ActivityIndicator,
    Pressable,
    ScrollView,
    StatusBar,
    Text,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const formatearValor = (valor: unknown) => {
  if (valor === null) {
    return "NULL";
  }

  if (valor === undefined) {
    return "UNDEFINED";
  }

  if (typeof valor === "string") {
    return valor;
  }

  if (
    typeof valor === "number" ||
    typeof valor === "boolean" ||
    typeof valor === "bigint"
  ) {
    return String(valor);
  }

  try {
    return JSON.stringify(valor);
  } catch {
    return String(valor);
  }
};

const formatearValorPredeterminado = (valor: unknown) => {
  if (valor === null || valor === undefined) {
    return "Sin valor";
  }

  return formatearValor(valor);
};

export default function PantallaBaseDatos() {
  const router = useRouter();

  const { colorScheme, toggleColorScheme } = useColorScheme();

  const modoOscuro = colorScheme === "dark";

  const componenteActivoRef = useRef(true);

  const [tablas, setTablas] = useState<TablaDiagnosticoSQLite[]>([]);
  const [cargando, setCargando] = useState(true);
  const [actualizando, setActualizando] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    componenteActivoRef.current = true;

    return () => {
      componenteActivoRef.current = false;
    };
  }, []);

  const cargarBaseDatos = useCallback(async (esActualizacion = false) => {
    if (esActualizacion) {
      setActualizando(true);
    } else {
      setCargando(true);
    }

    setError("");

    try {
      const diagnostico = await obtenerDiagnosticoBaseDatos();

      if (!componenteActivoRef.current) {
        return;
      }

      setTablas(diagnostico);
    } catch (errorConsulta) {
      console.error(
        "Error al consultar la estructura de SQLite:",
        errorConsulta,
      );

      if (!componenteActivoRef.current) {
        return;
      }

      const mensaje =
        errorConsulta instanceof Error
          ? errorConsulta.message
          : "No fue posible consultar la base de datos.";

      setError(mensaje);
    } finally {
      if (componenteActivoRef.current) {
        setCargando(false);
        setActualizando(false);
      }
    }
  }, []);

  useEffect(() => {
    cargarBaseDatos();
  }, [cargarBaseDatos]);

  const regresar = () => {
    router.back();
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
          barStyle={modoOscuro ? "light-content" : "dark-content"}
          backgroundColor={modoOscuro ? "#020617" : "#f8fafc"}
          translucent={false}
        />

        <View className="flex-1">
          <View className="px-5 pt-2">
            {/* Navegación y acciones */}
            <View className="flex-row items-center justify-between">
              <Pressable
                onPress={regresar}
                accessibilityRole="button"
                accessibilityLabel="Regresar"
                className="h-11 w-11 items-center justify-center rounded-full bg-blue-100 active:opacity-70 dark:bg-slate-800"
              >
                <FontAwesomeIcon
                  icon={faArrowLeft}
                  size={20}
                  color={modoOscuro ? "#60a5fa" : "#2563eb"}
                />
              </Pressable>

              <View className="flex-row items-center">
                <Pressable
                  onPress={() => cargarBaseDatos(true)}
                  disabled={actualizando}
                  accessibilityRole="button"
                  accessibilityLabel="Actualizar base de datos"
                  className={`mr-2 h-11 w-11 items-center justify-center rounded-full bg-blue-100 active:opacity-70 dark:bg-slate-800 ${
                    actualizando ? "opacity-50" : ""
                  }`}
                >
                  {actualizando ? (
                    <ActivityIndicator
                      size="small"
                      color={modoOscuro ? "#60a5fa" : "#2563eb"}
                    />
                  ) : (
                    <FontAwesomeIcon
                      icon={faArrowsRotate}
                      size={18}
                      color={modoOscuro ? "#60a5fa" : "#2563eb"}
                    />
                  )}
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
            </View>

            {/* Encabezado */}
            <View className="mt-4 items-center">
              <View className="h-16 w-16 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-950">
                <FontAwesomeIcon
                  icon={faDatabase}
                  size={28}
                  color={modoOscuro ? "#60a5fa" : "#2563eb"}
                />
              </View>

              <Text className="mt-3 text-center text-2xl font-bold text-blue-600 dark:text-blue-400">
                Base de datos
              </Text>

              <Text className="mt-1 text-center text-sm text-slate-500 dark:text-slate-400">
                dory_teacher.db
              </Text>
            </View>
          </View>

          {cargando ? (
            <View className="flex-1 items-center justify-center px-5">
              <ActivityIndicator
                size="large"
                color={modoOscuro ? "#60a5fa" : "#2563eb"}
              />

              <Text className="mt-4 text-center text-base text-slate-600 dark:text-slate-400">
                Leyendo estructura y datos...
              </Text>
            </View>
          ) : error ? (
            <View className="flex-1 items-center justify-center px-5">
              <Text className="text-center text-lg font-bold text-red-600 dark:text-red-400">
                No se pudo leer la base de datos
              </Text>

              <Text className="mt-3 text-center text-sm leading-6 text-slate-600 dark:text-slate-400">
                {error}
              </Text>

              <Pressable
                onPress={() => cargarBaseDatos()}
                className="mt-6 rounded-2xl bg-blue-600 px-6 py-4 active:bg-blue-700"
              >
                <Text className="font-bold text-white">
                  Intentar nuevamente
                </Text>
              </Pressable>
            </View>
          ) : (
            <ScrollView
              className="flex-1"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{
                paddingHorizontal: 20,
                paddingTop: 24,
                paddingBottom: 40,
              }}
            >
              <View className="mb-5 rounded-2xl border border-blue-200 bg-blue-50 p-4 dark:border-blue-900 dark:bg-blue-950/40">
                <Text className="text-base font-bold text-blue-700 dark:text-blue-300">
                  Resumen
                </Text>

                <Text className="mt-2 text-sm text-slate-700 dark:text-slate-300">
                  Tablas encontradas: {tablas.length}
                </Text>

                <Text className="mt-1 text-sm text-slate-700 dark:text-slate-300">
                  Esta pantalla muestra la estructura y los datos almacenados
                  actualmente en SQLite.
                </Text>
              </View>

              {tablas.length === 0 ? (
                <View className="rounded-2xl border border-dashed border-slate-300 p-6 dark:border-slate-700">
                  <Text className="text-center text-base text-slate-500 dark:text-slate-400">
                    No se encontraron tablas.
                  </Text>
                </View>
              ) : (
                tablas.map((tabla) => (
                  <View
                    key={tabla.nombre}
                    className="mb-7 overflow-hidden rounded-3xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"
                  >
                    {/* Nombre de tabla */}
                    <View className="bg-blue-600 px-5 py-4">
                      <View className="flex-row items-center justify-between">
                        <Text className="flex-1 text-lg font-bold text-white">
                          {tabla.nombre}
                        </Text>

                        <View className="rounded-full bg-white/20 px-3 py-1">
                          <Text className="text-xs font-bold text-white">
                            {tabla.totalRegistros} registros
                          </Text>
                        </View>
                      </View>
                    </View>

                    {/* SQL de creación */}
                    <View className="border-b border-slate-200 p-5 dark:border-slate-700">
                      <Text className="text-base font-bold text-slate-900 dark:text-white">
                        SQL de creación
                      </Text>

                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator
                        className="mt-3"
                      >
                        <View className="min-w-full rounded-xl bg-slate-100 p-4 dark:bg-slate-950">
                          <Text
                            selectable
                            style={{
                              fontFamily: "monospace",
                            }}
                            className="text-xs leading-5 text-slate-800 dark:text-slate-300"
                          >
                            {tabla.sql || "SQL no disponible"}
                          </Text>
                        </View>
                      </ScrollView>
                    </View>

                    {/* Estructura */}
                    <View className="border-b border-slate-200 p-5 dark:border-slate-700">
                      <Text className="text-base font-bold text-slate-900 dark:text-white">
                        Estructura de la tabla
                      </Text>

                      <Text className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {tabla.columnas.length} columnas
                      </Text>

                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator
                        className="mt-4"
                      >
                        <View>
                          {/* Encabezados */}
                          <View className="flex-row border-b border-slate-300 bg-slate-100 dark:border-slate-700 dark:bg-slate-950">
                            <View className="w-12 px-2 py-3">
                              <Text className="text-xs font-bold text-slate-700 dark:text-slate-300">
                                CID
                              </Text>
                            </View>

                            <View className="w-40 px-2 py-3">
                              <Text className="text-xs font-bold text-slate-700 dark:text-slate-300">
                                Nombre
                              </Text>
                            </View>

                            <View className="w-32 px-2 py-3">
                              <Text className="text-xs font-bold text-slate-700 dark:text-slate-300">
                                Tipo
                              </Text>
                            </View>

                            <View className="w-20 px-2 py-3">
                              <Text className="text-xs font-bold text-slate-700 dark:text-slate-300">
                                NOT NULL
                              </Text>
                            </View>

                            <View className="w-16 px-2 py-3">
                              <Text className="text-xs font-bold text-slate-700 dark:text-slate-300">
                                PK
                              </Text>
                            </View>

                            <View className="w-40 px-2 py-3">
                              <Text className="text-xs font-bold text-slate-700 dark:text-slate-300">
                                Default
                              </Text>
                            </View>
                          </View>

                          {tabla.columnas.map((columna) => (
                            <View
                              key={`${tabla.nombre}-${columna.cid}-${columna.name}`}
                              className="flex-row border-b border-slate-200 dark:border-slate-800"
                            >
                              <View className="w-12 px-2 py-3">
                                <Text className="text-xs text-slate-700 dark:text-slate-300">
                                  {columna.cid}
                                </Text>
                              </View>

                              <View className="w-40 px-2 py-3">
                                <Text
                                  selectable
                                  className="text-xs font-semibold text-blue-700 dark:text-blue-300"
                                >
                                  {columna.name}
                                </Text>
                              </View>

                              <View className="w-32 px-2 py-3">
                                <Text className="text-xs text-slate-700 dark:text-slate-300">
                                  {columna.type || "Sin tipo"}
                                </Text>
                              </View>

                              <View className="w-20 px-2 py-3">
                                <Text className="text-xs text-slate-700 dark:text-slate-300">
                                  {columna.notnull ? "Sí" : "No"}
                                </Text>
                              </View>

                              <View className="w-16 px-2 py-3">
                                <Text className="text-xs text-slate-700 dark:text-slate-300">
                                  {columna.pk ? "Sí" : "No"}
                                </Text>
                              </View>

                              <View className="w-40 px-2 py-3">
                                <Text
                                  selectable
                                  className="text-xs text-slate-700 dark:text-slate-300"
                                >
                                  {formatearValorPredeterminado(
                                    columna.dflt_value,
                                  )}
                                </Text>
                              </View>
                            </View>
                          ))}
                        </View>
                      </ScrollView>
                    </View>

                    {/* Datos */}
                    <View className="p-5">
                      <Text className="text-base font-bold text-slate-900 dark:text-white">
                        Datos almacenados
                      </Text>

                      <Text className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {tabla.filas.length} filas cargadas
                      </Text>

                      {tabla.filas.length === 0 ? (
                        <View className="mt-4 rounded-xl border border-dashed border-slate-300 p-5 dark:border-slate-700">
                          <Text className="text-center text-sm text-slate-500 dark:text-slate-400">
                            Esta tabla está vacía.
                          </Text>
                        </View>
                      ) : (
                        <View className="mt-4">
                          {tabla.filas.map((fila, indiceFila) => (
                            <View
                              key={`${tabla.nombre}-fila-${indiceFila}`}
                              className="mb-4 overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700"
                            >
                              <View className="bg-slate-100 px-4 py-2 dark:bg-slate-800">
                                <Text className="text-xs font-bold text-slate-700 dark:text-slate-300">
                                  Fila {indiceFila + 1}
                                </Text>
                              </View>

                              <View className="p-4">
                                {Object.entries(fila).map(
                                  ([campo, valor], indiceCampo) => (
                                    <View
                                      key={`${tabla.nombre}-${indiceFila}-${campo}`}
                                      className={`${
                                        indiceCampo > 0
                                          ? "mt-3 border-t border-slate-100 pt-3 dark:border-slate-800"
                                          : ""
                                      }`}
                                    >
                                      <Text className="text-xs font-bold text-blue-600 dark:text-blue-400">
                                        {campo}
                                      </Text>

                                      <Text
                                        selectable
                                        style={{
                                          fontFamily: "monospace",
                                        }}
                                        className="mt-1 text-xs leading-5 text-slate-800 dark:text-slate-300"
                                      >
                                        {formatearValor(valor)}
                                      </Text>
                                    </View>
                                  ),
                                )}
                              </View>
                            </View>
                          ))}
                        </View>
                      )}
                    </View>
                  </View>
                ))
              )}
            </ScrollView>
          )}
        </View>
      </SafeAreaView>
    </>
  );
}
