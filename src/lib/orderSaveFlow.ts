/** A confirmed write must never be reported as a failed save because its readback failed. */
export async function saveOrderAndRefresh(
  persist: () => Promise<{ id: string }>,
  refresh: () => Promise<void>,
): Promise<{ id: string; refreshed: boolean }> {
  const saved = await persist();
  try {
    await refresh();
    return { id: saved.id, refreshed: true };
  } catch {
    return { id: saved.id, refreshed: false };
  }
}
