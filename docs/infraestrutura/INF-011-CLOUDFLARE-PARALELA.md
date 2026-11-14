# INF-011 — Homologação paralela Cloudflare

Data: 14/11/2026. Base: main `68dc006`. Repositório exclusivo: `horsepowerlondrina-arch/sistemaoficinas`.

## Escopo e autorização

O responsável autorizou implementar e validar uma homologação paralela, mantendo Supabase e Vercel para retorno. Não autorizou produção ou contratação de planos pagos. Autorizou reutilizar somente as duas conexões restritas e a chave MFA existentes no arquivo privado da INF-010. Não houve migração de esquema/dados, criação de papéis, grants ou redefinição de credenciais. Houve somente o ajuste de limites de conexão explicitamente autorizado ao final desta seção.

Conta Cloudflare: `398bbed171a2a062429f9e2efa6df1cc`. Worker: `sistema-oficinas-homologacao`. Endereço: https://sistema-oficinas-homologacao.osdrive-homologacao.workers.dev. Nenhuma zona DNS ou domínio comercial é alterado. O subdomínio workers.dev foi criado para este piloto.

## Arquitetura

- React/Vite 6 e seus comandos atuais permanecem intactos. `npm run build:cloudflare` primeiro executa o build existente e depois o empacotador em `cloudflare/`.
- O subprojeto usa `cf` e Cloudflare Vite plugin 2 beta, com seu próprio Vite 7 corrigido e lockfile. Não atualiza o Vite ou pg da aplicação Vercel nem cria configuração Wrangler. O pacote Worker usa pg 8.23.1 isolado pelo alias do Vite; a aplicação existente mantém pg 8.16.3.
- `cloudflare/cloudflare.config.ts` contém somente configuração pública, certificado CA público, Assets e declarações de segredos. Não tem domínios customizados, cron ou recursos pagos. Declara dois bindings Hyperdrive previamente criados na capacidade gratuita. `cf deploy --prebuilt --no-provision` não cria recursos auxiliares.
- PostgreSQL permanece no Supabase `vnclahdnirqlcbamodqy`, usando o endpoint direto `db.vnclahdnirqlcbamodqy.supabase.co:5432` (sem pooler duplo), via Hyperdrive com TLS `verify-full` e CA Supabase pública registrada. Ambos os bindings mantêm cache desativado e máximo de cinco conexões de origem (mínimo aceito pela Cloudflare). O trecho Worker–Hyperdrive usa o transporte privado do binding; a conexão de origem mantém TLS verificado. Pools são criados por requisição e encerrados após a resposta; não há sockets/pools/identidade compartilhados entre requisições Workers. Express usa o adaptador oficial `cloudflare:node`.
- O código transacional e os tipos de DB foram separados de `node:sqlite`. SQLite permanece disponível para os testes existentes; não integra o bundle Workers.
- As duas conexões também foram configuradas privadamente nos bindings Hyperdrive. Os três segredos são provisionados privadamente pelo CLI oficial: `DATABASE_URL`, `PLATFORM_ADMIN_DATABASE_URL`, `PLATFORM_ADMIN_TOTP_ENCRYPTION_KEY`. Nunca incluir valores no Git, logs, artifacts ou relatório. Arquivos privados em `data/` continuam ignorados.
- As conexões disponíveis usam `osdrive_local_app` e `osdrive_local_admin`. Consultas somente leitura confirmaram associação aos papéis base correspondentes, ausência de superuser/BYPASSRLS/CREATEROLE/CREATEDB e separação de schemas. O runtime verifica novamente essas condições. Os nomes base continuam aceitos; aliases só são reconhecidos no destino Cloudflare exato.
- A origem Cloudflare é admitida explicitamente na proteção de homologação. Não há wildcard workers.dev, CORS aberto, simulação de Vercel nem alteração na proteção de produção.
- Cookies continuam HttpOnly, Secure e SameSite. O IP de limitação usa CF-Connecting-IP fornecido pela borda, sem confiar em X-Forwarded-For arbitrário. A sessão do responsável no navegador não é utilizada.
- A leitura da logo de documentos usa Assets por contexto de requisição, preservando o snapshot dos bytes. Node/Vercel continuam lendo o arquivo existente.

## Limites do piloto

- Login e APIs autenticadas aceitam somente as três oficinas fictícias reservadas na política versionada. Não habilitar oficinas reais sem nova avaliação.
- Administração central e endpoints Stripe/webhook/renovação são negados no Worker. Não há cron. A Vercel permanece responsável pelas integrações existentes. Isso evita cobrança/renovação duplicada.
- Resend, novas ativações, novos checkouts, consulta paga de placa e alterações administrativas não fazem parte da validação paralela inicial. Nenhuma chave desses provedores foi copiada.
- Os demais módulos usam as regras, planos e permissões existentes. Grandes transferências/importações e cargas máximas de fotos precisam de validação de memória/CPU específica antes de considerar migração definitiva.
- O piloto usa a capacidade gratuita existente. Não reduzir custo de hash de senha nem enfraquecer segurança para caber no limite de CPU. Se o plano gratuito impedir o fluxo, registrar evidência e pedir decisão sobre eventual contratação; não contratar automaticamente.
- Logs de invocação estão desativados para evitar caminhos sensíveis; logs próprios registram somente códigos genéricos, sem corpo, cookies, SQL ou segredos.

## Comandos e publicação

```sh
npm ci
npm ci --prefix cloudflare
npm run build:cloudflare
npx tsc --project cloudflare/tsconfig.json
npm run test:cloudflare
# Autenticação privada na conta Cloudflare correta; confirmar identidade antes de publicar.
cd cloudflare
cf deploy --prebuilt --no-provision --secrets-file ../data/cloudflare.secrets.json
```

O JSON privado deve ter permissão 0600 e somente as três chaves acima. Não copiar dumps nem reconstituir segredos por endpoints. O build não lê esse arquivo: segredos entram somente na publicação. A versão deve ser publicada com mensagem/tag do SHA integrado e registrada no relatório final.

A publicação Cloudflare é manual e explícita neste piloto. Não há workflow com credenciais remotas, cron ou deploy automático a cada PR. A Vercel continua pausada conforme INF-010, sem mudanças em `vercel.json`. Para retorno, basta abrir a URL Vercel existente; não há troca de DNS a desfazer. Como o banco é compartilhado, retorno de hospedagem não desfaz dados fictícios criados durante testes.

## Validação

O workflow existente conserva todos os testes PostgreSQL 17 descartáveis e acrescenta um job `cloudflare-runtime`, sem segredos ou rede para Supabase. Ele compila ambos os builds, verifica tipos e executa o pacote real em workerd/Miniflare: rotas SPA/documentos, Assets, cabeçalhos, bloqueio de domínio, métodos, integração administrativa/cobrança e falha fechada sem configuração.

Testes de unidade cobrem origens exatas, banco/roles não privilegiados, rejeição de configurações de produção, login fora das oficinas reservadas e isolamento concorrente dos Assets. As suítes existentes cobrem transações/RLS/planos e regressões financeiras no PostgreSQL temporário.

Validação remota deve usar contextos distintos das contas fictícias, confirmar identidade/plano, oficinas cruzadas negadas, dados pessoais/financeiros conforme perfil, clientes, veículos, checklist, orçamento, OS, estoque e financeiro. Registrar módulos realmente exercitados; CI aprovado não comprova jornada online. Não usar produção ou alterar oficinas externas aos IDs reservados.

MAP-001: não houve mudança de interface, identidade visual ou biblioteca pública. A pasta privada de capturas existente é preservada.

## Recursos do piloto

- Hyperdrive operacional: `5e060ca01a63467e9b7684f093c47a31`.
- Hyperdrive administrativo: `017953836b764a709e07d19b9154ac7c`.
- CA pública de homologação: `dcc22bc0-267e-4a6f-9112-d1a96e4c1e54`.
- Limite gratuito Hyperdrive documentado: 100.000 consultas/dia; exceder bloqueia operações, não autoriza upgrade. Confirmar limites atuais antes de ampliar o uso.
- Referência de conexão direta: https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/supabase/

### Jornada operacional com checkpoint privado

```sh
TEST_OPERATIONAL_TARGET=cloudflare \
TEST_OPERATIONAL_WRITES=fictitious-homologation-only \
TEST_ONBOARDING_FILE=/caminho/privado/test-onboarding.json \
node scripts/e2e/run-operations.mjs
```

O driver aceita somente os destinos Vercel e Cloudflare fixos em código, mantém as verificações do manifesto original de três oficinas e cria uma rodada `cf-operacional-20261114`, com placas fictícias próprias. Checkpoints ficam em `data/`; capturas e relatório ficam fora da aplicação. Nunca usar um manifesto de usuários reais. `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` permite escolher um Chrome instalado sem reutilizar seu perfil pessoal.

### Capacidade de conexões

As consultas somente leitura identificaram limites de conexão 4/3 nos papéis exclusivos de testes `osdrive_local_app`/`osdrive_local_admin`. O Hyperdrive aceita limite mínimo de 5 por configuração e retornou erro PostgreSQL `53300` em chamadas concorrentes. Não retirar guardas, MFA ou segregação para contornar isso. O responsável autorizou explicitamente alterar somente esses dois limites para **10/10**. A configuração foi aplicada no Supabase de homologação, registrada como `20261114232746_cloudflare_fictitious_role_connection_limits`, e verificada por consulta: ambos continuam sem superuser/BYPASSRLS/CREATEROLE/CREATEDB. Antes do ajuste havia 23 conexões totais, para máximo 60. Não alterar esses valores em produção. Retorno aos limites anteriores, se autorizado e coordenado após desativar o piloto: `ALTER ROLE osdrive_local_app CONNECTION LIMIT 4; ALTER ROLE osdrive_local_admin CONNECTION LIMIT 3;`.

## Resultado do piloto gratuito — 14/11/2026

A interface foi publicada e o login Master fictício e a sessão chegaram a autenticar. A jornada completa do Básico passou (11 verificações, incluindo o bloqueio de estoque/Financeiro não contratados). Cliente, veículo, checklist, orçamento, OS, documento e recebimento simples foram efetivamente exercitados. As rodadas seguintes retornaram HTTP 503 e os logs oficiais registraram **Worker exceeded CPU time limit** na versão `2747f4ad-7845-4210-bc4d-95d81fd04f1b`. Logo, **o plano gratuito não está validado para operar o backend completo com confiabilidade**.

A verificação de segurança conseguiu consultar um Master fictício e negar acessos cruzados, mas foi interrompida pela mesma indisponibilidade na verificação pós-logout. Não declarar os oito perfis nem a revogação pós-logout validados. Profissional/Premium e seus recebimentos/estoque continuam pendentes de jornada completa. Cadastro público, e-mails, checkout/webhook, cron, administração central, extensão e grandes transferências também não foram validados no piloto.

Não houve contratação. Não reduzir scrypt, remover verificações ou aumentar o limite de CPU por configuração para contornar o plano gratuito. A próxima decisão é autorizar Workers Paid, cujo preço mínimo documentado é US$ 5/mês mais eventual consumo, ou rever a hospedagem do backend. A migração definitiva e a substituição da Vercel **não estão aprovadas por este piloto**.

A versão de código e a versão online devem ser registradas separadamente no PR/relatório. O fluxo de CI sem banco remoto continua sendo a evidência de regressão; ele não elimina o impedimento de CPU da plataforma gratuita. Relatórios HTML/JSON e capturas fictícias ficam na pasta local de relatórios, fora da aplicação.

Fontes: https://developers.cloudflare.com/workers/platform/limits/ e https://developers.cloudflare.com/workers/platform/pricing/
