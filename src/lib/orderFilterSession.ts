const prefix = "order-list-filters:";
const fields = ["status", "basis", "from", "to"] as const;

export function orderFilterStorageKey(tenantId: string, userId: string) {
  return `${prefix}${tenantId}:${userId}`;
}

export function readOrderFilterSearch(storage: Pick<Storage, "getItem">, key: string) {
  try {
    return storage.getItem(key) || "";
  } catch {
    return "";
  }
}

export function saveOrderFilterSearch(storage: Pick<Storage, "setItem">, key: string, search: string) {
  if (!search) return;
  const incoming = new URLSearchParams(search);
  const saved = new URLSearchParams();
  for (const field of fields) {
    const value = incoming.get(field);
    if (value !== null) saved.set(field, value);
  }
  try {
    storage.setItem(key, saved.toString());
  } catch {
    // Browsers can disable session storage; URL filters remain usable.
  }
}

export function clearOrderFilterSession(storage: Pick<Storage, "length" | "key" | "removeItem">) {
  try {
    for (let index = storage.length - 1; index >= 0; index--) {
      const key = storage.key(index);
      if (key?.startsWith(prefix)) storage.removeItem(key);
    }
  } catch {
    // Logout must still complete when browser storage is unavailable.
  }
}
