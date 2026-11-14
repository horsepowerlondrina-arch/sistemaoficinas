// Vercel: exit 0 cancels this build, exit 1 builds. Never skip on unknown history.
import { execFileSync } from 'node:child_process';
export function documentationOnly(files) {
  return files.length > 0 && files.every(path => /^(docs\/|AGENTS\.md$|README\.md$|\.github\/PULL_REQUEST_TEMPLATE\.md$)/.test(path));
}
export function shouldIgnore(env = process.env, run = execFileSync) {
  if (!env.VERCEL_GIT_PREVIOUS_SHA || !/^[a-f0-9]{40}$/.test(env.VERCEL_GIT_PREVIOUS_SHA)) return false;
  try {
    const files = run('git',['diff','--name-only',env.VERCEL_GIT_PREVIOUS_SHA,'HEAD'],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
    return documentationOnly(files);
  } catch { return false; }
}
if (process.argv[1]?.endsWith('vercel-ignore-docs.mjs')) {
  const ignore = shouldIgnore();
  console.log(ignore ? 'INF-010: somente documentação desde a versão anterior.' : 'INF-010: build necessário ou histórico desconhecido.');
  process.exit(ignore ? 0 : 1);
}
