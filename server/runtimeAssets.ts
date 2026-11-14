import { URL as NodeURL } from "node:url";
import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync } from "node:fs";
const assets = new AsyncLocalStorage<() => Promise<Buffer>>();
export function withDocumentLogo<T>(read: () => Promise<Buffer>, callback: () => T): T {
  return assets.run(read, callback);
}
export async function documentLogoBytes(): Promise<Buffer> {
  const read = assets.getStore();
  return read ? read() : readFileSync(new NodeURL("../public/brand/icon.jpg", import.meta.url));
}
