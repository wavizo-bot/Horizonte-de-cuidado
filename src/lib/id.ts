let counter = 0;

export function newId(prefix = "id"): string {
  counter = (counter + 1) % 1_000_000;
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}-${random}`;
}

export function deterministicId(parts: Array<string | number>): string {
  return parts
    .map((part) => String(part).replace(/[^a-zA-Z0-9_-]/g, "-"))
    .join("--");
}
