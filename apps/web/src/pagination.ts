/** Load every page for selection controls that must not silently omit eligible records. */
export async function readAllPages<T>(
  load: (page: number) => Promise<{ items: T[]; totalPages: number }>,
): Promise<T[]> {
  const first = await load(1);
  const items = [...first.items];
  for (let page = 2; page <= first.totalPages; page++) items.push(...(await load(page)).items);
  return items;
}
