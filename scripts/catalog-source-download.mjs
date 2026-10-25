import { createHash } from "node:crypto";
import { createWriteStream, rm } from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const expectedSha256 =
  "5557e09a16362452e1a5716164e9cc0e13d48a26140c1682ffdc5ae48b0eefaa";
const expectedBytes = 294141952;
const output = process.argv[2];
const sourceUrl = process.env.CATALOG_SOURCE_URL;
const allowedHosts = new Set(
  (process.env.CATALOG_SOURCE_ALLOWED_HOSTS || "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean),
);

function assertAllowed(url) {
  if (
    url.protocol !== "https:" ||
    !allowedHosts.has(url.hostname.toLowerCase()) ||
    url.username ||
    url.password
  )
    throw new Error(
      "Origem recusada: use HTTPS e um host explicitamente autorizado.",
    );
}

async function main() {
  if (!output || !sourceUrl || allowedHosts.size === 0)
    throw new Error(
      "Configure o destino temporário e os segredos de origem privada.",
    );
  let url = new URL(sourceUrl);
  assertAllowed(url);
  let response;
  for (let redirects = 0; redirects <= 3; redirects++) {
    response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(120000),
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    if (redirects === 3)
      throw new Error("A origem excedeu o limite de redirecionamentos.");
    const location = response.headers.get("location");
    if (!location)
      throw new Error("A origem retornou redirecionamento sem destino.");
    url = new URL(location, url);
    assertAllowed(url);
  }
  if (!response?.ok || !response.body)
    throw new Error(
      `Download da origem privada falhou (HTTP ${response?.status || "sem resposta"}).`,
    );
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared && declared !== expectedBytes)
    throw new Error("Tamanho declarado da origem diverge do pacote aprovado.");
  const hash = createHash("sha256");
  let bytes = 0;
  try {
    await pipeline(
      Readable.fromWeb(response.body),
      new Transform({
        transform(chunk, _encoding, callback) {
          bytes += chunk.length;
          hash.update(chunk);
          callback(null, chunk);
        },
      }),
      createWriteStream(output, { flags: "wx", mode: 0o600 }),
    );
    if (bytes !== expectedBytes || hash.digest("hex") !== expectedSha256)
      throw new Error(
        "A origem baixada não corresponde ao pacote operacional validado.",
      );
    console.log(
      JSON.stringify({ bytes, sha256: expectedSha256, verified: true }),
    );
  } catch (error) {
    await rm(output, { force: true }).catch(() => {});
    throw error;
  }
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Download não concluído.",
  );
  process.exitCode = 1;
});
