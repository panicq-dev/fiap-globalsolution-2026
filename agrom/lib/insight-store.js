import { redisCommand } from "./redis.js";

const insightKey = "agrom:insight:latest";

export async function getLatestInsight() {
  const value = await redisCommand(["GET", insightKey]);
  return value ? JSON.parse(value) : null;
}

export async function storeLatestInsight(insight) {
  await redisCommand(["SET", insightKey, JSON.stringify(insight), "EX", "2592000"]);
}