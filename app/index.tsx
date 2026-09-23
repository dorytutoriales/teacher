import { ejecutarConTiempoMaximo, obtenerBaseDatos } from "@/lib/database";
import {
  faBookOpen,
  faFloppyDisk,
  faMoon,
  faPen,
  faPlus,
  faSun,
  faTrash,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-native-fontawesome";
import * as Crypto from "expo-crypto";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useColorScheme } from "nativewind";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
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

type Clase = {
  id: string;
  clase: string;
  escuela: string;
  grupo: string;
  descripcion: string;
};

export default function Index() {
  const router = useRouter();

  const { colorScheme, toggleColorScheme } = useColorScheme();

  const modoOscuro = colorScheme === "dark";

  const [busqueda, setBusqueda] = useState("");
  const [clases, setClases] = useState<Clase[]>([]);
  const [cargando, setCargando] = useState(true);

  const [modalVisible, setModalVisible] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [claseEditandoId, setClaseEditandoId] = useState<string | null>(null);

  const [nombreClase, setNombreClase] = useState("");
  const [escuela, setEscuela] = useState("");
  const [grupo, setGrupo] = useState("");
  const [descripcion, setDescripcion] = useState("");

  /*
   * Crea la tabla y carga las clases almacenadas
   * cuando se abre la pantalla.
   */
  useEffect(() => {
    let componenteActivo = true;

    const inicializarBaseDatos = async () => {
      try {
        const db = await ejecutarConTiempoMaximo(obtenerBaseDatos());

        await ejecutarConTiempoMaximo(
          db.execAsync(`
            PRAGMA journal_mode = WAL;

            CREATE TABLE IF NOT EXISTS clase (
              id TEXT PRIMARY KEY NOT NULL,
              clase TEXT NOT NULL,
              escuela TEXT NOT NULL,
              grupo TEXT NOT NULL DEFAULT '',
              descripcion TEXT NOT NULL DEFAULT ''
            );
          `),
        );

        const clasesGuardadas = await ejecutarConTiempoMaximo(
          db.getAllAsync<Clase>(`
            SELECT
              id,
              clase,
              escuela,
              grupo,
              descripcion
            FROM clase
            ORDER BY rowid DESC;
          `),
        );

        if (componenteActivo) {
          setClases(clasesGuardadas);
        }
      } catch (error) {
        console.error("Error al inicializar SQLite:", error);

        Alert.alert(
          "Error",
          "No fue posible abrir la base de datos de clases.",
        );
      } finally {
        if (componenteActivo) {
          setCargando(false);
        }
      }
    };

    inicializarBaseDatos();

    return () => {
      componenteActivo = false;
    };
  }, []);

  const clasesFiltradas = useMemo(() => {
    const texto = busqueda.trim().toLowerCase();

    if (!texto) {
      return clases;
    }

    return clases.filter((item) => {
      return (
        item.clase.toLowerCase().includes(texto) ||
        item.escuela.toLowerCase().includes(texto) ||
        item.grupo.toLowerCase().includes(texto) ||
        item.descripcion.toLowerCase().includes(texto)
      );
    });
  }, [busqueda, clases]);

  const limpiarFormulario = () => {
    setNombreClase("");
    setEscuela("");
    setGrupo("");
    setDescripcion("");
    setClaseEditandoId(null);
  };

  const abrirModal = () => {
    limpiarFormulario();
    setModalVisible(true);
  };

  const abrirModalEditar = (item: Clase) => {
    setClaseEditandoId(item.id);
    setNombreClase(item.clase);
    setEscuela(item.escuela);
    setGrupo(item.grupo);
    setDescripcion(item.descripcion);
    setModalVisible(true);
  };

  const abrirClase = (item: Clase) => {
    router.push({
      pathname: "/clase/[id]",
      params: {
        id: item.id,
        nombreClase: item.clase,
        escuela: item.escuela,
        grupo: item.grupo,
        descripcion: item.descripcion,
      },
    });
  };

  const cerrarModal = () => {
    if (guardando) {
      return;
    }

    setModalVisible(false);
    limpiarFormulario();
  };

  const guardarClase = async () => {
    const claseLimpia = nombreClase.trim();
    const escuelaLimpia = escuela.trim();
    const grupoLimpio = grupo.trim();
    const descripcionLimpia = descripcion.trim();

    if (!claseLimpia) {
      Alert.alert("Campo requerido", "Escribe el nombre de la clase.");
      return;
    }

    if (!escuelaLimpia) {
      Alert.alert("Campo requerido", "Escribe el nombre de la escuela.");
      return;
    }

    if (!grupoLimpio) {
      Alert.alert("Campo requerido", "Escribe el grupo.");
      return;
    }

    setGuardando(true);

    try {
      const db = await ejecutarConTiempoMaximo(obtenerBaseDatos());

      if (claseEditandoId) {
        const claseActualizada: Clase = {
          id: claseEditandoId,
          clase: claseLimpia,
          escuela: escuelaLimpia,
          grupo: grupoLimpio,
          descripcion: descripcionLimpia,
        };

        await db.runAsync(
          `
            UPDATE clase
            SET
              clase = ?,
              escuela = ?,
              grupo = ?,
              descripcion = ?
            WHERE id = ?;
          `,
          [
            claseActualizada.clase,
            claseActualizada.escuela,
            claseActualizada.grupo,
            claseActualizada.descripcion,
            claseActualizada.id,
          ],
        );

        setClases((clasesAnteriores) =>
          clasesAnteriores.map((item) =>
            item.id === claseActualizada.id ? claseActualizada : item,
          ),
        );
      } else {
        const id = Crypto.randomUUID();

        const nuevaClase: Clase = {
          id,
          clase: claseLimpia,
          escuela: escuelaLimpia,
          grupo: grupoLimpio,
          descripcion: descripcionLimpia,
        };

        await db.runAsync(
          `
            INSERT INTO clase (
              id,
              clase,
              escuela,
              grupo,
              descripcion
            )
            VALUES (?, ?, ?, ?, ?);
          `,
          [
            nuevaClase.id,
            nuevaClase.clase,
            nuevaClase.escuela,
            nuevaClase.grupo,
            nuevaClase.descripcion,
          ],
        );

        setClases((clasesAnteriores) => [nuevaClase, ...clasesAnteriores]);
      }

      setModalVisible(false);
      limpiarFormulario();
    } catch (error) {
      console.error("Error al guardar la clase:", error);

      Alert.alert(
        "Error",
        claseEditandoId
          ? "No fue posible actualizar la clase. Inténtalo nuevamente."
          : "No fue posible guardar la clase. Inténtalo nuevamente.",
      );
    } finally {
      setGuardando(false);
    }
  };

  const eliminarClase = (item: Clase) => {
    Alert.alert(
      "Eliminar clase",
      `¿Deseas eliminar la clase "${item.clase}"?`,
      [
        {
          text: "Cancelar",
          style: "cancel",
        },
        {
          text: "Eliminar",
          style: "destructive",
          onPress: async () => {
            try {
              const db = await ejecutarConTiempoMaximo(obtenerBaseDatos());

              await db.runAsync(
                `
                  DELETE FROM clase
                  WHERE id = ?;
                `,
                [item.id],
              );

              setClases((clasesAnteriores) =>
                clasesAnteriores.filter((clase) => clase.id !== item.id),
              );
            } catch (error) {
              console.error("Error al eliminar la clase:", error);

              Alert.alert(
                "Error",
                "No fue posible eliminar la clase. Inténtalo nuevamente.",
              );
            }
          },
        },
      ],
    );
  };

  return (
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

      <View className="flex-1 px-5 pt-2">
        {/* Botón de modo claro y oscuro */}
        <View className="items-end">
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

          <Text className="mt-2 text-center text-lg font-medium text-black dark:text-slate-300">
            Clases
          </Text>
        </View>

        {/* Buscador y botón para agregar */}
        <View className="mt-8 flex-row items-center">
          <TextInput
            value={busqueda}
            onChangeText={setBusqueda}
            placeholder="Buscar clase, escuela o grupo..."
            placeholderTextColor={modoOscuro ? "#94a3b8" : "#64748b"}
            autoCapitalize="none"
            returnKeyType="search"
            className="h-12 flex-1 rounded-2xl border border-slate-200 bg-white px-4 text-base text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
          />

          <Pressable
            onPress={abrirModal}
            accessibilityRole="button"
            accessibilityLabel="Agregar clase"
            className="ml-3 h-12 w-12 items-center justify-center rounded-2xl bg-blue-600 active:bg-blue-700"
          >
            <FontAwesomeIcon icon={faPlus} size={20} color="#ffffff" />
          </Pressable>
        </View>

        {/* Título de la lista */}
        <Text className="mb-4 mt-8 text-lg font-bold text-slate-900 dark:text-white">
          Mis clases
        </Text>

        {/* Cargando información */}
        {cargando ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator
              size="large"
              color={modoOscuro ? "#60a5fa" : "#2563eb"}
            />

            <Text className="mt-4 text-slate-500 dark:text-slate-400">
              Cargando clases...
            </Text>
          </View>
        ) : (
          <FlatList
            data={clasesFiltradas}
            keyExtractor={(item) => item.id}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{
              flexGrow: 1,
              paddingBottom: 24,
            }}
            ItemSeparatorComponent={() => <View className="h-3" />}
            ListEmptyComponent={
              <View className="flex-1 items-center justify-center px-6 pb-20">
                <View className="mb-5 h-20 w-20 items-center justify-center rounded-full bg-blue-100 dark:bg-slate-800">
                  <FontAwesomeIcon
                    icon={faBookOpen}
                    size={34}
                    color={modoOscuro ? "#60a5fa" : "#2563eb"}
                  />
                </View>

                <Text className="text-center text-lg font-bold text-slate-700 dark:text-slate-200">
                  {busqueda.trim()
                    ? "No se encontraron clases"
                    : "Aquí aparecen tus clases"}
                </Text>

                <Text className="mt-2 text-center text-sm text-slate-500 dark:text-slate-400">
                  {busqueda.trim()
                    ? "Prueba utilizando otra búsqueda"
                    : "Presiona el botón azul para agregar una clase"}
                </Text>
              </View>
            }
            renderItem={({ item }) => (
              <View className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                <View className="flex-row items-start">
                  <Pressable
                    onPress={() => abrirClase(item)}
                    accessibilityRole="button"
                    accessibilityLabel={`Abrir clase ${item.clase}`}
                    className="flex-1 flex-row items-start active:opacity-70"
                  >
                    <View className="mr-4 h-12 w-12 items-center justify-center rounded-xl bg-blue-100 dark:bg-blue-950">
                      <FontAwesomeIcon
                        icon={faBookOpen}
                        size={21}
                        color={modoOscuro ? "#60a5fa" : "#2563eb"}
                      />
                    </View>

                    <View className="flex-1">
                      <Text className="text-base font-bold text-blue-600 dark:text-blue-400">
                        {item.clase}
                      </Text>

                      <Text className="mt-1 text-sm text-black dark:text-white">
                        {item.escuela}
                      </Text>

                      <Text className="mt-1 text-sm font-medium text-black dark:text-white">
                        Grupo: {item.grupo}
                      </Text>

                      {item.descripcion.length > 0 && (
                        <Text className="mt-2 text-sm leading-5 text-black dark:text-white">
                          {item.descripcion}
                        </Text>
                      )}
                    </View>
                  </Pressable>

                  <View className="ml-3 flex-row items-center">
                    <Pressable
                      onPress={() => abrirModalEditar(item)}
                      accessibilityRole="button"
                      accessibilityLabel={`Editar clase ${item.clase}`}
                      className="h-10 w-10 items-center justify-center rounded-xl bg-blue-100 active:opacity-70 dark:bg-blue-950"
                    >
                      <FontAwesomeIcon
                        icon={faPen}
                        size={17}
                        color={modoOscuro ? "#60a5fa" : "#2563eb"}
                      />
                    </Pressable>

                    <Pressable
                      onPress={() => eliminarClase(item)}
                      accessibilityRole="button"
                      accessibilityLabel={`Eliminar clase ${item.clase}`}
                      className="ml-2 h-10 w-10 items-center justify-center rounded-xl bg-red-100 active:opacity-70 dark:bg-red-950"
                    >
                      <FontAwesomeIcon
                        icon={faTrash}
                        size={17}
                        color={modoOscuro ? "#f87171" : "#dc2626"}
                      />
                    </Pressable>
                  </View>
                </View>
              </View>
            )}
          />
        )}
      </View>

      {/* Ventana emergente para agregar o editar una clase */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={cerrarModal}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          className="flex-1 bg-black/60 px-5"
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{
              flexGrow: 1,
              justifyContent: "center",
              paddingVertical: 30,
            }}
          >
            <View className="rounded-3xl bg-white p-5 dark:bg-slate-900">
              {/* Encabezado del modal */}
              <View className="mb-6 flex-row items-center justify-between">
                <Text className="text-xl font-bold text-slate-900 dark:text-white">
                  {claseEditandoId ? "Editar Clase" : "Agregar una Clase"}
                </Text>

                <Pressable
                  onPress={cerrarModal}
                  disabled={guardando}
                  accessibilityRole="button"
                  accessibilityLabel="Cerrar ventana"
                  className="h-10 w-10 items-center justify-center rounded-full bg-slate-100 active:opacity-70 dark:bg-slate-800"
                >
                  <FontAwesomeIcon
                    icon={faXmark}
                    size={20}
                    color={modoOscuro ? "#e2e8f0" : "#334155"}
                  />
                </Pressable>
              </View>

              {/* Campo Clase */}
              <Text className="mb-2 font-semibold text-slate-700 dark:text-slate-200">
                Clase
              </Text>

              <TextInput
                value={nombreClase}
                onChangeText={setNombreClase}
                placeholder="Ejemplo: Matemáticas"
                placeholderTextColor={modoOscuro ? "#94a3b8" : "#64748b"}
                editable={!guardando}
                className="h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-base text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />

              {/* Campo Escuela */}
              <Text className="mb-2 mt-5 font-semibold text-slate-700 dark:text-slate-200">
                Escuela
              </Text>

              <TextInput
                value={escuela}
                onChangeText={setEscuela}
                placeholder="Ejemplo: Escuela Benito Juárez"
                placeholderTextColor={modoOscuro ? "#94a3b8" : "#64748b"}
                editable={!guardando}
                className="h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-base text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />

              {/* Campo Grupo */}
              <Text className="mb-2 mt-5 font-semibold text-slate-700 dark:text-slate-200">
                Grupo
              </Text>

              <TextInput
                value={grupo}
                onChangeText={setGrupo}
                placeholder="Ejemplo: 2° A"
                placeholderTextColor={modoOscuro ? "#94a3b8" : "#64748b"}
                editable={!guardando}
                className="h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-base text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />

              {/* Campo Descripción */}
              <Text className="mb-2 mt-5 font-semibold text-slate-700 dark:text-slate-200">
                Descripción
              </Text>

              <TextInput
                value={descripcion}
                onChangeText={setDescripcion}
                placeholder="Escribe una descripción de la clase..."
                placeholderTextColor={modoOscuro ? "#94a3b8" : "#64748b"}
                editable={!guardando}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
                className="min-h-28 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-base text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />

              {/* Botón guardar */}
              <Pressable
                onPress={guardarClase}
                disabled={guardando}
                accessibilityRole="button"
                accessibilityLabel={
                  claseEditandoId ? "Guardar cambios" : "Guardar clase"
                }
                className={`mt-7 h-13 flex-row items-center justify-center rounded-2xl bg-blue-600 px-4 py-4 active:bg-blue-700 ${
                  guardando ? "opacity-60" : ""
                }`}
              >
                {guardando ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <>
                    <FontAwesomeIcon
                      icon={faFloppyDisk}
                      size={19}
                      color="#ffffff"
                    />

                    <Text className="ml-3 text-base font-bold text-white">
                      {claseEditandoId ? "Guardar cambios" : "Guardar clase"}
                    </Text>
                  </>
                )}
              </Pressable>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}
