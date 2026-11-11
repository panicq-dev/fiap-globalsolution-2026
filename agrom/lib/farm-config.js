import { readFile } from "node:fs/promises";
import { getWorkspace } from "./workspace-store.js";
import { hasRedisConfig } from "./redis.js";

function collectPositions(geometry) {
  if (geometry.type === "Polygon") return geometry.coordinates.flat(1);
  if (geometry.type === "MultiPolygon") return geometry.coordinates.flat(2);
  return [];
}

function isValidGeometry(geometry) {
  if (!geometry || !["Polygon", "MultiPolygon"].includes(geometry.type)) return false;
  const positions = collectPositions(geometry);
  return positions.length >= 4 && positions.every((position) => (
    Array.isArray(position)
    && position.length >= 2
    && Number.isFinite(position[0])
    && Number.isFinite(position[1])
    && Math.abs(position[0]) <= 180
    && Math.abs(position[1]) <= 90
  ));
}

function geometryBounds(geometry) {
  const positions = collectPositions(geometry);
  const longitudes = positions.map(([longitude]) => longitude);
  const latitudes = positions.map(([, latitude]) => latitude);
  return [
    Math.min(...longitudes),
    Math.min(...latitudes),
    Math.max(...longitudes),
    Math.max(...latitudes),
  ];
}

export async function loadFarmConfig() {
  const configPath = `${process.cwd()}/data/fields.json`;
  let farm = hasRedisConfig() ? (await getWorkspace())?.farm : null;

  if (!farm) {
    try {
      farm = JSON.parse(await readFile(configPath, "utf8"));
    } catch (error) {
      return {
        error: error.code === "ENOENT"
          ? "Cadastre os talhões reais para iniciar o monitoramento."
          : "O cadastro da fazenda não é um JSON válido.",
        missing: ["data/fields.json com os polígonos GeoJSON reais dos talhões"],
      };
    }
  }

  return normalizeFarmConfig(farm);
}

export function normalizeFarmConfig(farm) {
  if (!farm || !Array.isArray(farm.fields) || farm.fields.length === 0) {
    return {
      error: "O cadastro ainda não tem nenhum talhão.",
      missing: ["Ao menos um talhão com nome, área e polígono GeoJSON"],
    };
  }

  const ids = new Set();
  const invalidFields = farm.fields.some((field) => {
    if (
      !field
      || typeof field.id !== "string"
      || !/^[a-z0-9-]+$/.test(field.id)
      || ids.has(field.id)
      || typeof field.name !== "string"
      || !field.name.trim()
      || !Number.isFinite(field.areaHa)
      || field.areaHa <= 0
      || !isValidGeometry(field.geometry)
    ) return true;

    ids.add(field.id);
    return false;
  });

  if (invalidFields) {
    return {
      error: "Revise os dados dos talhões: nome, ID único, área em hectares e polígono GeoJSON válido são obrigatórios.",
      missing: ["Cadastro válido em data/fields.json"],
    };
  }

  const fields = farm.fields.map((field) => ({
    ...field,
    bounds: geometryBounds(field.geometry),
  }));
  const farmBounds = [
    Math.min(...fields.map((field) => field.bounds[0])),
    Math.min(...fields.map((field) => field.bounds[1])),
    Math.max(...fields.map((field) => field.bounds[2])),
    Math.max(...fields.map((field) => field.bounds[3])),
  ];

  return {
    farm: {
      name: typeof farm.farmName === "string" && farm.farmName.trim() ? farm.farmName.trim() : "Minha fazenda",
      locationName: typeof farm.locationName === "string" ? farm.locationName.trim() : "",
      fields,
      bounds: farmBounds,
    },
  };
}

export function getGeometryCenter(geometry) {
  const [west, south, east, north] = geometryBounds(geometry);
  return { latitude: (south + north) / 2, longitude: (west + east) / 2 };
}