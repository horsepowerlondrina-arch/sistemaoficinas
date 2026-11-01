import test from "node:test";
import assert from "node:assert/strict";
import { workshopTheme } from "../shared/workshopTheme";

test("cores de oficinas fictícias permanecem isoladas da marca do software", () => {
  const a = workshopTheme({ name: "Oficina A", accent_color: "#1265a8" });
  const b = workshopTheme({ name: "Oficina B", accent_color: "#f6cb32" });
  assert.equal(a["--red"], "#1265a8");
  assert.equal(b["--red"], "#f6cb32");
  assert.equal(a["--red-ink"], "#ffffff");
  assert.equal(b["--red-ink"], "#000000");
  assert.notEqual(a["--red-soft"], b["--red-soft"]);
  assert.equal(workshopTheme({ accent_color: "invalid" })["--red"], "#26364b");
});
