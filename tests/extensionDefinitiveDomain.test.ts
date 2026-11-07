import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("conector Sky Peças usa apenas a Horse Power e a homologação durante a transição", () => {
  const manifest = JSON.parse(readFileSync(new URL("../extension/horse-power/manifest.json", import.meta.url), "utf8"));
  const background = readFileSync(new URL("../extension/horse-power/background.js", import.meta.url), "utf8");
  const hosts = manifest.host_permissions as string[];
  const bridge = manifest.content_scripts.find((entry: { js: string[] }) => entry.js.includes("bridge.js"));
  assert.ok(hosts.includes("https://oficinahorsepower.com.br/*"));
  assert.ok(bridge.matches.includes("https://oficinahorsepower.com.br/*"));
  assert.ok(hosts.includes("https://sistema-oficinas-homologacao.vercel.app/*"));
  assert.ok(!hosts.some((host) => host.includes("osdrive.com.br")));
  assert.ok(!bridge.matches.some((host: string) => host.includes("osdrive.com.br")));
  assert.match(background, /const defaultAppOrigin = "https:\/\/oficinahorsepower\.com\.br"/);
  assert.doesNotMatch(background, /https:\/\/osdrive\.com\.br/);
});
