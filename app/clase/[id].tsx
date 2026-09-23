import {
  faArrowLeft,
  faClipboardCheck,
  faFileCircleCheck,
  faGraduationCap,
  faMoon,
  faSun,
  faUsers,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-native-fontawesome";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useColorScheme } from "nativewind";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type ParametrosClase = {
  id?: string | string[];
  nombreClase?: string | string[];
  escuela?: string | string[];
  grupo?: string | string[];
  descripcion?: string | string[];
};

export default function PantallaClase() {
  const router = useRouter();

  const parametros = useLocalSearchParams<ParametrosClase>();

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

  const escuela = obtenerParametro(
    parametros.escuela,
    "Escuela no especificada",
  );

  const grupo = obtenerParametro(parametros.grupo, "Grupo no especificado");

  const descripcion = obtenerParametro(
    parametros.descripcion,
    "Sin descripción",
  );

  const abrirPantallaAlumnos = () => {
    router.push({
      pathname: "/alumnos",
      params: {
        id: idClase,
        nombreClase,
        escuela,
        grupo,
        descripcion,
      },
    });
  };

  const abrirPantallaAsistencias = () => {
    router.push({
      pathname: "/asistencias",
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

        <ScrollView
          className="flex-1"
          contentContainerStyle={{
            flexGrow: 1,
          }}
          showsVerticalScrollIndicator={false}
        >
          <View className="flex-1 px-5 pb-6 pt-2">
            {/* Botón regresar y botón de modo claro y oscuro */}
            <View className="flex-row items-center justify-between">
              <Pressable
                onPress={() => router.back()}
                accessibilityRole="button"
                accessibilityLabel="Regresar a clases"
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

            {/* Botones de opciones */}
            <View className="flex-1 justify-center gap-4 py-8">
              <Pressable
                onPress={abrirPantallaAlumnos}
                accessibilityRole="button"
                accessibilityLabel="Abrir alumnos"
                className="w-full flex-row items-center justify-center rounded-xl bg-blue-600 px-5 py-4 active:opacity-70 dark:bg-blue-500"
              >
                <FontAwesomeIcon icon={faUsers} size={22} color="#ffffff" />

                <Text className="ml-3 text-lg font-bold text-white">
                  Alumnos
                </Text>
              </Pressable>

              <Pressable
                onPress={abrirPantallaAsistencias}
                accessibilityRole="button"
                accessibilityLabel="Abrir asistencias"
                className="w-full flex-row items-center justify-center rounded-xl bg-blue-600 px-5 py-4 active:opacity-70 dark:bg-blue-500"
              >
                <FontAwesomeIcon
                  icon={faClipboardCheck}
                  size={22}
                  color="#ffffff"
                />

                <Text className="ml-3 text-lg font-bold text-white">
                  Asistencias
                </Text>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Abrir calificaciones"
                className="w-full flex-row items-center justify-center rounded-xl bg-blue-600 px-5 py-4 active:opacity-70 dark:bg-blue-500"
              >
                <FontAwesomeIcon
                  icon={faGraduationCap}
                  size={22}
                  color="#ffffff"
                />

                <Text className="ml-3 text-lg font-bold text-white">
                  Calificaciones
                </Text>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Abrir exámenes"
                className="w-full flex-row items-center justify-center rounded-xl bg-blue-600 px-5 py-4 active:opacity-70 dark:bg-blue-500"
              >
                <FontAwesomeIcon
                  icon={faFileCircleCheck}
                  size={22}
                  color="#ffffff"
                />

                <Text className="ml-3 text-lg font-bold text-white">
                  Exámenes
                </Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    </>
  );
}
