import { redisCommand } from "./redis.js";

const workspaceKey = "agrom:workspace:default";
const cronLockKey = "agrom:cron:insights:lock";

export async function getWorkspace() {
  const value = await redisCommand(["GET", workspaceKey]);
  return value ? JSON.parse(value) : null;
}

export async function storeWorkspace(workspace) {
  await redisCommand(["SET", workspaceKey, JSON.stringify(workspace)]);
}

export async function acquireInsightLock(lockId) {
  const result = await redisCommand(["SET", cronLockKey, lockId, "NX", "EX", "7200"]);
  return result === "OK";
}

export async function releaseInsightLock(lockId) {
  const currentLock = await redisCommand(["GET", cronLockKey]);
  if (currentLock === lockId) await redisCommand(["DEL", cronLockKey]);
}