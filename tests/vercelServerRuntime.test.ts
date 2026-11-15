import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import ts from "typescript";

test("Vercel server modules load as emitted JavaScript without a TypeScript resolver", () => {
  const root = process.cwd();
  const output = mkdtempSync(join(root, ".vercel-runtime-"));
  try {
    writeFileSync(join(output, "package.json"), '{"type":"module"}');
    const emit = (directory: string) => {
      for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
        const relative = join(directory, entry.name);
        if (entry.isDirectory()) emit(relative);
        else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
          const target = join(output, relative.replace(/\.ts$/, ".js"));
          mkdirSync(dirname(target), { recursive: true });
          writeFileSync(target, ts.transpileModule(readFileSync(join(root, relative), "utf8"), {
            compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
            fileName: relative,
          }).outputText);
        }
      }
    };
    emit("server");
    emit("shared");
    const { NODE_OPTIONS: _loader, ...env } = process.env;
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval",
      "const { createApp } = await import('./server/app.js'); if (typeof createApp !== 'function') process.exit(1);",
    ], { cwd: output, env, encoding: "utf8", timeout: 30_000 });
    assert.equal(result.status, 0, result.error?.message || result.stderr);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});
