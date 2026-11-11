export function findFieldAlerts(fieldData, currentPeriodStart) {
  const cutoff = currentPeriodStart ? new Date(currentPeriodStart).getTime() : Number.NEGATIVE_INFINITY;
  return fieldData.flatMap((field) => {
    const observations = field.series
      .map((point) => ({ date: point.to, ndvi: point.indices.NDVI?.mean }))
      .filter((point) => Number.isFinite(point.ndvi) && new Date(point.date).getTime() > cutoff);
    if (observations.length < 2) return [];

    const previous = observations.at(-2);
    const current = observations.at(-1);
    const change = ((current.ndvi - previous.ndvi) / Math.max(Math.abs(previous.ndvi), 0.01)) * 100;
    if (change > -10 || previous.ndvi - current.ndvi < 0.05) return [];

    return [{
      fieldId: field.id,
      fieldName: field.name,
      previous,
      current,
      change,
    }];
  });
}