const homologationProjectId = "prj_rLVsFKBpMXQFtfm1kgYHFQObr4Jc";
const homologationHost = "sistema-oficinas-homologacao.vercel.app";

export function catalogHomologationProjectId(
  hostname: string,
  env: Record<string,string|undefined> = process.env,
) {
  return env.VERCEL === "1" && env.VERCEL_ENV === "production" &&
    env.VERCEL_PROJECT_ID === homologationProjectId &&
    hostname.trim().toLowerCase() === homologationHost
    ? homologationProjectId
    : null;
}

export const homologationCatalogHost = homologationHost;
