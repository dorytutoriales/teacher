import { faArrowLeft, faMoon, faSun } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-native-fontawesome";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useColorScheme } from "nativewind";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type ParametrosAsistencias = {
  id?: string | string[];
  nombreClase?: string | string[];
  escuela?: string | string[];
  grupo?: string | string[];
  descripcion?: string | string[];
};

export default function PantallaAsistencias() {
  const router = useRouter();

  const parametros = useLocalSearchParams<ParametrosAsistencias>();

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

  const nombreClase = obtenerParametro(parametros.nombreClase, "Clase");

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
          </View>
        </ScrollView>
      </SafeAreaView>
    </>
  );
}
