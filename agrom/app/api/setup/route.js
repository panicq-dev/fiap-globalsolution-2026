import { NextResponse } from "next/server";
import { loadFarmConfig, normalizeFarmConfig } from "../../../lib/farm-config.js";
import { hasRedisConfig } from "../../../lib/redis.js";
import { getWorkspace, storeWorkspace } from "../../../lib/workspace-store.js";

const allowedFrequencies = new Set([3, 6, 12, 24]);

function getPublicSetup(workspace, farm, missing = []) {
  const configuredFarm = farm ?? { name: "", locationName: "", fields: [] };
  const fields = configuredFarm.fields.map(({ id, name, areaHa, crop }) => ({ id, name, areaHa, crop: crop || null }));
  return {
    profile: workspace?.profile ?? null,
    farm: { name: configuredFarm.name, locationName: configuredFarm.locationName, fields },
    schedule: workspace?.schedule ?? { frequencyHours: 3, nextRunAt: null, lastRunAt: null },
    setupComplete: Boolean(workspace?.profile?.fullName && workspace?.profile?.email && workspace?.schedule?.frequencyHours && fields.length),
    storageAvailable: hasRedisConfig(),
    missing,
  };
}

export async function GET() {
  const config = await loadFarmConfig();
  try {
    const workspace = hasRedisConfig() ? await getWorkspace() : null;
    return NextResponse.json(getPublicSetup(workspace, config.farm, config.missing), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Setup read failed:", error);
    return NextResponse.json({ error: "Não foi possível carregar o cadastro salvo." }, { status: 503 });
  }
}

export async function POST(request) {
  if (!hasRedisConfig()) {
    return NextResponse.json({ error: "Configure o armazenamento persistente Upstash antes de salvar o cadastro." }, { status: 503 });
  }

  let input;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({ error: "Envie os dados do cadastro em formato JSON." }, { status: 400 });
  }

  const fullName = typeof input.fullName === "string" ? input.fullName.trim() : "";
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const farmName = typeof input.farmName === "string" ? input.farmName.trim() : "";
  const locationName = typeof input.locationName === "string" ? input.locationName.trim() : "";
  const frequencyHours = Number(input.frequencyHours);

  if (fullName.length < 2 || fullName.length > 80) {
    return NextResponse.json({ error: "Informe o nome do responsável (de 2 a 80 caracteres)." }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return NextResponse.json({ error: "Informe um email válido para o responsável." }, { status: 400 });
  }
  if (farmName.length < 2 || farmName.length > 100 || locationName.length > 100) {
    return NextResponse.json({ error: "Confira o nome e a localização da fazenda." }, { status: 400 });
  }
  if (!allowedFrequencies.has(frequencyHours)) {
    return NextResponse.json({ error: "Escolha uma frequência entre 3, 6, 12 ou 24 horas." }, { status: 400 });
  }

  const config = input.farm
    ? normalizeFarmConfig(input.farm)
    : await loadFarmConfig();
  if (config.error) return NextResponse.json({ error: config.error, missing: config.missing }, { status: 409 });

  try {
    const previous = await getWorkspace();
    const savedAt = new Date();
    const workspace = {
      profile: { fullName, email },
      farm: {
        ...config.farm,
        name: farmName,
        locationName,
      },
      schedule: {
        frequencyHours,
        nextRunAt: savedAt.toISOString(),
        lastRunAt: previous?.schedule?.lastRunAt ?? null,
      },
      createdAt: previous?.createdAt ?? savedAt.toISOString(),
      updatedAt: savedAt.toISOString(),
    };

    await storeWorkspace(workspace);
    return NextResponse.json({ ...getPublicSetup(workspace, workspace.farm), status: "saved" }, { status: 201 });
  } catch (error) {
    console.error("Setup save failed:", error);
    return NextResponse.json({ error: "Não foi possível salvar o cadastro no Upstash." }, { status: 503 });
  }
}