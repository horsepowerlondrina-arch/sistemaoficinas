# INF-008 — Auditoria de viabilidade: Cloudflare Workers Paid

Data: **14/11/2026**, America/Sao_Paulo. Repositório: `horsepowerlondrina-arch/sistemaoficinas`.
Base auditada: `main` **7636cec125fb0c979ce3e846d0aef734adcdc851**. Branch documental: `docs/inf-008-cloudflare-audit`.

## 1. Resumo executivo e recomendação

**Compatibilidade geral: parcialmente compatível; migração viável com adaptações, ainda não comprovada em execução Workers.** Recomendo uma prova de compatibilidade isolada do backend antes de decidir a troca definitiva. Cloudflare Paid é candidata tecnicamente plausível e tem mensalidade mínima inferior à Vercel Pro. Não recomendo transferir imediatamente todo o OSDrive nem prometer custo fixo de US$ 5 para qualquer volume.

O frontend é uma SPA React/Vite. Express tem adaptador oficial atual para Workers; o `pg` instalado atende ao mínimo documentado do Hyperdrive. Autenticação própria, SQL PostgreSQL, RLS e Supabase podem ser mantidos. Não é necessário trocar o banco por D1 ou reescrever a aplicação em outro framework.

Os maiores riscos são: inicialização com I/O no escopo global; ciclo de vida dos pools/conexões e configuração transacional de identidade; certificados carregados por arquivo; rotas específicas da Vercel; memória dos pacotes `.hptx`; rate limiting em memória; cron e webhooks. Um backend Node separado é **uma alternativa**, não uma exigência já comprovada para todos os módulos. Para grandes transferências, ele é a opção de menor risco enquanto o processamento não for adaptado.

Estimativa de engenharia, não compromisso: **8–15 dias úteis** para portabilidade inicial dos fluxos comuns e validação; **mais 5–12 dias** se for necessário redesenhar transferências grandes. Uma alternativa Node tradicional pode exigir aproximadamente **2–5 dias**, incluindo testes e operação. São faixas baseadas na superfície de código, sem benchmark ou protótipo nesta auditoria.

## 2. Escopo, evidências e limites

Lidos `AGENTS.md`, [gestão](../GESTAO-PROJETO.md), [decisões](../DECISOES-ARQUITETURA.md) e [fluxo](../fluxo-desenvolvimento.md). A GOV-002 permite integração documental após controles; bancos/credenciais/infraestrutura continuam sujeitos a autorização específica.

GitHub consultado: `main` confirmada; inventário paginado retornou **188 branches** naquele momento. Entre as referências relevantes: `main`, `feat/checklist-private-storage`, `feat/admin-billing-mercadopago`, `feat/admin-billing-stripe`, `release/horse-power-definitiva-v2`. Nenhuma branch foi removida ou alterada pela inspeção.

Vercel consultada somente por metadados: projeto `sistema-oficinas-homologacao`, ID `prj_rLVsFKBpMXQFtfm1kgYHFQObr4Jc`, Node `24.x`, deployment mais recente observado `dpl_C164MDAnnWaW8Ywyri4XJhbi78Fg` em READY. Isso não comprova saúde de todos os módulos nem altera o bloqueio de builds registrado anteriormente. Não foram lidos valores de variáveis, credenciais ou dados operacionais. Não foi necessário acessar banco persistente.

**Importante:** [PR #184](https://github.com/horsepowerlondrina-arch/sistemaoficinas/pull/184) de fotos privadas permanece aberto e sem merge. Portanto Storage privado é uma implementação pendente, não funcionalidade ativa comprovada na `main`. O estudo distingue essa proposta do comportamento Base64 atual. Mercado Pago não deve ser integrado como efeito desta tarefa.

Não houve execução do runtime Cloudflare, teste de carga, deploy, contratação, alteração de DNS, banco, segredo ou infraestrutura. “Compatível em princípio” significa respaldo em documentação e código, não teste aprovado. Não foi usado o repositório histórico.

## 3. Arquitetura real

### Versões e composição

Valores resolvidos em [package-lock.json](../../package-lock.json), distintos dos intervalos do [package.json](../../package.json): React/React DOM **19.3.0**, React Router **7.18.4**, Express **5.2.1**, `pg` **8.16.3**, Zod **4.6.7**, Vite **6.4.5**, TypeScript **5.9.3**, fast-xml-parser **5.11.2**. Node exigido: **24.x**. Não há Next.js nem SSR obrigatório.

- [src/main.tsx](../../src/main.tsx) e [src/App.tsx](../../src/App.tsx): SPA, sessões e navegação da oficina/administração.
- [server/app.ts](../../server/app.ts): aplicação Express; inventário textual encontrou 116 registros diretos de rotas operacionais, além de routers separados. Não é uma contagem exaustiva de endpoints.
- [server/cloud.ts](../../server/cloud.ts): composição publicada; instancia pool operacional e pool administrativo separado, valida isolamento, conecta Stripe e administração. Faz verificação de banco com `await` durante avaliação do módulo.
- [api/index.ts](../../api/index.ts), [server/vercelApiHandler.ts](../../server/vercelApiHandler.ts) e [vercel.json](../../vercel.json): entrada Vercel, normalização `__hp_vercel_path`, rewrites `/api`, `/admin-api`, páginas públicas, SPA e site institucional. Não existe `api/[...path].ts` na base auditada.
- [server/index.ts](../../server/index.ts) **não é uma entrada pronta de produção Node tradicional**: carrega `.env.local`, exige PostgreSQL local e escuta em `127.0.0.1`. Criar bootstrap de produção específico, reutilizando composição segura, seria necessário também em Railway/Render/VPS.
- [server/db/postgres.ts](../../server/db/postgres.ts): PostgreSQL com TLS verificado/CA, pool máximo 3, `AsyncLocalStorage`, transações e identidade em `set_config(...,true)`. Administração usa outro pool, máximo 2, no bootstrap cloud.
- [server/db/database.ts](../../server/db/database.ts): tipos/transação compartilhados e implementação SQLite para testes/ferramentas; imports runtime incluem `node:sqlite` e `node:fs`. Não confundir esse código com persistência operacional em SQLite.

### Segurança, integrações e processamento

[server/auth/session.ts](../../server/auth/session.ts) mantém hashes `scrypt`, tokens aleatórios e sessão de oficina. [server/auth/platformAdmin.ts](../../server/auth/platformAdmin.ts) implementa sessão separada, MFA/TOTP, HMAC e criptografia da chave MFA. [server/platformAdminApp.ts](../../server/platformAdminApp.ts) aplica permissões e auditoria. [server/auth/userAuthorization.ts](../../server/auth/userAuthorization.ts) e [server/services/userAccess.ts](../../server/services/userAccess.ts) cobrem permissões operacionais/escopo de OS.

Os middlewares em `server/app.ts` validam origem, usam `no-store`, contexto autenticado e autorização no servidor. Cache de placa em [server/services/vehicleLookup.ts](../../server/services/vehicleLookup.ts) inclui tenant no banco; há deduplicação em `WeakMap` e contador de consultas em `Map` no app. Esses estados em memória não constituem rate limiter distribuído.

[server/services/fipePlaca.ts](../../server/services/fipePlaca.ts), [server/services/workshopActivation.ts](../../server/services/workshopActivation.ts), [server/services/passwordReset.ts](../../server/services/passwordReset.ts) e [server/services/stripeGateway.ts](../../server/services/stripeGateway.ts) acessam provedores por HTTP `fetch`. Resend é usado para convites/recuperação; FipePlaca depende de autorização efetiva e credencial; Stripe usa verificação HMAC do corpo bruto, persistência/idempotência e cron em [server/stripeBillingRoutes.ts](../../server/stripeBillingRoutes.ts). A troca de host não autoriza cobranças reais.

PDFs são principalmente impressão HTML no navegador: [IssuedDocument.tsx](../../src/components/IssuedDocument.tsx), [PublicOrder.tsx](../../src/pages/PublicOrder.tsx), [CashReport.tsx](../../src/components/CashReport.tsx). Não foi encontrada exigência de Chromium/Puppeteer no backend para esse fluxo. Snapshots e links são produzidos no servidor por [documents.ts](../../server/services/documents.ts) e [sharing.ts](../../server/services/sharing.ts).

[checklists.ts](../../server/services/checklists.ts) grava fotos Base64 no PostgreSQL, limita foto a 1.600.000 bytes e até 40 fotos por checklist. O endpoint recebe imagem com limite de 2 MB; outros parsers têm limites próprios. A PR #184 deverá ser avaliada separadamente antes de presumir economia de Storage ou funcionamento em Workers.

[shared/transferPackage.ts](../../shared/transferPackage.ts) usa JSON integral, gzip nível 9, `scryptSync` N=32768/r=8/p=1 e AES-256-GCM. Limites: 64 MiB de conteúdo descomprimido e 96 MiB de arquivo. [dataTransferExport.ts](../../server/services/dataTransferExport.ts), [dataTransferImport.ts](../../server/services/dataTransferImport.ts) e [dataTransferVerification.ts](../../server/services/dataTransferVerification.ts) materializam tabelas, mapas, hashes e relacionamentos. [platformAdminDataTransferRoutes.ts](../../server/platformAdminDataTransferRoutes.ts) já prevê download em partes e limite online de 4 MiB para outros fluxos. Dividir o download não divide automaticamente o custo de gerar/descriptografar o pacote.

O catálogo também possui carga em lote fora do servidor web: [scripts/catalog-import.ts](../../scripts/catalog-import.ts) usa leitura incremental e lotes de 1.000 registros, e [.github/workflows/catalog-homologation-import.yml](../../.github/workflows/catalog-homologation-import.yml) executa o procedimento controlado. Preservar esse caminho com autorização de banco; não transferir a carga de centenas de milhares de tempos para uma única requisição Worker.

## 4. Matriz de compatibilidade por módulo

Legenda: **P** = compatível em princípio, exige regressão; **A** = adaptação necessária; **N** = não validado, sem afirmar compatibilidade integral.

| Módulo | Estado | Evidência e trabalho necessário |
|---|---|---|
| Frontend, clientes e veículos | P/A | SPA estática; configurar fallback por rota e separar assets/API. Autocomplete e consulta externa continuam no backend. |
| Login e permissões | A | Crypto documentado; medir `scrypt`, testar cookies, origem, revogação e contexto concorrente. Não alterar hashes para facilitar migração. |
| Administração central | A | Reutilizar Express, MFA e pool restrito; eliminar I/O global e manter conexão administrativa separada. |
| Checklist/fotos | P/A | Upload HTTP é possível; proteger endpoint, tamanho e tenant. Base64 atual e snapshots aumentam memória. Storage proposto continua privado. |
| Orçamentos/OS | P/A | Regras são TypeScript + SQL; preservar transações, sequência, recebimentos e permissões em leitura/escrita. |
| Catálogo Técnico | P/A | Manter tabelas compartilhadas no Supabase, consultas paginadas e acesso Premium. Não carregar catálogo inteiro no isolate. |
| Cadastros/estoque | P/A | SQL/transações e XML existentes reutilizáveis; medir parse de XML e testar rollback de movimentações. |
| Financeiro/recebimentos | A | Sem impedimento de regra de negócio; alta criticidade para locks, precisão, idempotência e concorrência. |
| Configurações/taxas | P/A | CRUD e cálculo reaproveitáveis; testar uploads de logo e atualização das permissões. |
| Documentos/PDF | P/A | Impressão continua no navegador; validar CSS/assets, snapshots e links públicos. Não requer serviço pago de navegador no desenho atual. |
| Importação/exportação | A/N | Não aprovar limites máximos atuais em 128 MB sem medição/redesenho. Candidato a job separado com memória maior. |
| Extensão Chrome | A | Atualizar origens autorizadas, host permissions/configuração e CORS apenas se hostname mudar; testar token, expiração e repetição. |
| Convites/e-mail | P/A | HTTP Resend; ajustar origem dos links, segredos por ambiente, tokens e retentativas. |
| Stripe/webhooks | A | Manter bytes brutos, assinatura, anti-replay/idempotência e permissão; migrar cron com exclusão mútua. Testar somente sandbox autorizado. |
| Suporte/monitoramento | P/A | SQL e interfaces reutilizáveis; adaptar coleta de falhas, correlação e logs do provedor. |

## 5. Incompatibilidades, alternativas e esforço

Os esforços abaixo se sobrepõem; não somar mecanicamente. Gravidade refere-se à migração, não a uma vulnerabilidade comprovada da aplicação atual.

| Arquivo/módulo | Motivo e gravidade | Alternativa | Esforço estimado / regressão |
|---|---|---|---|
| `api/index.ts`, `vercelApiHandler.ts`, `vercel.json` | Entrada/rewrites específicos da Vercel. **Alta** | Novo entry Worker com adaptador oficial `httpServerHandler`, rotas `/api`/`admin-api` equivalentes, Assets e headers explícitos. Não reutilizar normalizador Vercel em requisições normais. | 1–2 dias / média-alta |
| `server/cloud.ts` | Pool e verificação de banco durante importação. I/O de rede deve ocorrer em handler, não depender de execução de inicialização. **Alta** | Factory com bindings por ambiente, validação de configuração sem rede no global e inicialização por requisição. | 1–2 dias / alta |
| `server/db/postgres.ts`, pools ADM | Sockets/pools globais têm ciclo diferente; identidade RLS precisa mesma conexão/transação. **Crítica** | Dois bindings Hyperdrive com papéis distintos, cache desabilitado; cliente/pool por requisição e encerramento garantido. Preservar BEGIN/COMMIT/ROLLBACK/SET LOCAL e locks transacionais. | 2–4 dias / alta |
| CA em `server/cloud.ts` e `db/postgres.ts` | Paths do filesystem Node não são automaticamente paths do bundle Worker. **Média** | Importar PEM como texto/asset ou configurar TLS verificado conforme Hyperdrive; jamais `rejectUnauthorized:false`. | 0,5–1 dia / média |
| `auth/session.ts`, `auth/platformAdmin.ts` | API crypto suportada, mas `scryptSync` consome CPU/memória e bloqueia isolate. **Alta sob carga; funcional N** | Vetores conhecidos + benchmark no workerd, manter parâmetros e hashes; se necessário, executar autenticação no backend Node da opção B. | 1–2 dias / alta |
| `shared/transferPackage.ts`, `dataTransfer*` | JSON, buffers comprimidos/descomprimidos, Base64 e KDF coexistem. **Crítica** | Jobs limitados, armazenamento temporário privado e retomada. Para manter formato antigo grande sem risco, Node com memória medida; streaming posterior preservando bytes/formato criptográfico. | 5–12 dias / alta |
| Cron em `vercel.json` | Agendador não é portátil. **Alta** | `scheduled()` com função de negócio compartilhada, lote/idempotência e um único scheduler ativo. `waitUntil` não é fila durável. | 0,5–1,5 dia / alta financeira |
| Contadores `Map` e deduplicação | Estado isolado por instância e volátil. **Média/alta** | Limitação distribuída por banco ou mecanismo apropriado da Cloudflare, sem remover limites persistentes de login. | 1–2 dias / média |
| `server/index.ts` | Bootstrap local/loopback não serve como produção tradicional. **Alta na opção C** | Entrada Node de produção, bind apropriado, build TS, healthcheck, shutdown e segredos; composição operacional/admin mantida. | 1–2 dias / média |
| `server/db/database.ts` | Acoplamento de transação com imports SQLite/fs de testes. **Baixa/média** | Separar adaptador de testes do contrato/runtime. Não alegar incompatibilidade absoluta: compatibilidade Node evoluiu e precisa ser fixada por data. | 0,5–1 dia / baixa |

### O que a documentação atual permite afirmar

- Express possui tutorial oficial Workers; não há motivo para pressupor reescrita em Hono. Adaptador e data/flags de compatibilidade devem ser fixados e testados. [Express Workers](https://developers.cloudflare.com/workers/tutorials/deploy-an-express-app/).
- A página atual de crypto informa suporte a `node:crypto` com exceções que não incluem o `scrypt` empregado aqui. Portanto o risco identificado é de desempenho/limites, não uma afirmação de API ausente. [Crypto](https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/). `gzip` tem documentação própria; testar formato e limites reais. [zlib](https://developers.cloudflare.com/workers/runtime-apis/nodejs/zlib/).
- `node:fs` oferece VFS: bundle somente leitura e `/tmp` efêmero em memória, não disco persistente. Isso exige empacotar certificados e impede tratar `/tmp` como backup. [Filesystem](https://developers.cloudflare.com/workers/runtime-apis/nodejs/fs/).
- `process.env` pode ser preenchido por bindings em datas/flags compatíveis; não é obrigatório reescrever cada acesso, mas fallback `VERCEL_*` precisa sair da composição Worker. [Ambiente](https://developers.cloudflare.com/workers/configuration/environment-variables/).
- `pg` 8.16.3 atende ao mínimo informado pelo Hyperdrive, embora o exemplo use uma faixa superior; fixar versão testada. [Driver](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/node-postgres/). [Integração Supabase](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/supabase/).

### Segurança de PostgreSQL/RLS: condição de aceite

A aplicação autoriza via sessão própria e configura `app.tenant_id`, `app.user_id` e outros valores na conexão transacional. **Não trocar isso por uma conexão administrativa global nem por tenant informado pelo navegador.** Hyperdrive usa pooling transacional; locks de sessão não são a alternativa correta. O código atual usa locks de transação, que devem permanecer dentro do BEGIN. [Recursos suportados](https://developers.cloudflare.com/hyperdrive/reference/supported-databases-and-features/).

Desabilitar inicialmente o cache de consultas nos dois bindings. O cache padrão pode devolver dados antigos e não deve ser presumido seguro para resultados dependentes de contexto, sessão, permissões e RLS. Não habilitar cache até demonstrar isolamento com duas oficinas, revogação e leitura após escrita. Isso é uma prevenção de migração, não prova de vazamento atual. [Cache Hyperdrive](https://developers.cloudflare.com/hyperdrive/concepts/query-caching/).

A Cloudflare não elimina a latência ao Supabase no Canadá nem seu limite de conexões. Comparar localização/placement do Worker e distância do banco; utilizar endpoint TLS compatível e não empilhar poolers transacionais sem validar a recomendação do provedor. Manter limites de pool e papéis mínimos.

## 6. Recursos e custos oficiais

Preços em **USD/mês**, consultados em 14/11/2026, antes de impostos/câmbio. Não são cotação nem contratação. Banco, fotos, Stripe, Resend e FipePlaca são custos separados.

| Item | Vercel Hobby | Vercel Pro | Workers Free | Workers Paid/Standard |
|---|---|---|---|---|
| Base | US$ 0; uso pessoal/não comercial | US$ 20, um assento de publicação e US$ 20 de crédito de uso | US$ 0 | US$ 5 mínimos |
| Dinâmico | 1 milhão de invocações/mês na cota; exceder pode bloquear | Consumo por recursos, descontado do crédito, depois excedentes | 100 mil requisições/dia; CPU 10 ms por execução | 10 milhões/mês; US$ 0,30/milhão adicional; 30 milhões CPU-ms/mês; US$ 0,02/milhão CPU-ms adicional |
| Memória/CPU | Fluid: 2 GB / 1 vCPU; cota publicada de 4 CPU-h/mês | Fluid: 2 GB / 1 vCPU padrão, até 4 GB / 2 vCPU; cobrança por consumo | 128 MB por isolate | 128 MB por isolate; HTTP 30 s CPU padrão, configurável até 5 min |
| Builds/publicações | 100 deployments criados/dia; até 45 min/build | 6.000 deployments/dia; até 45 min/build | Workers Builds 3.000 min/mês, concorrência 1 | Workers Builds 6.000 min/mês; depois US$ 0,005/min; concorrência 6; timeout 20 min |
| Estáticos/banda | 100 GB de transferência rápida e 1 milhão de requisições CDN na cota | Flat Rate CDN inicial: 1 TB e 1 milhão de requisições/mês; demais usos conforme crédito/tabela | Assets diretos sem cobrança por requisição | Assets diretos sem cobrança por requisição/armazenamento; executar Worker para servi-los muda a contabilização |
| Logs | Retenção limitada do produto | Retenção/produto e add-ons específicos | Workers Logs 200 mil eventos/dia, 3 dias | Workers Logs 20 milhões eventos/mês, 7 dias; excedente US$ 0,60/milhão na tabela consultada |

Fontes de cada grupo: [Vercel Hobby](https://vercel.com/docs/plans/hobby), [Vercel Pro](https://vercel.com/docs/plans/pro-plan), [limites Vercel](https://vercel.com/docs/limits), [Workers preços](https://developers.cloudflare.com/workers/platform/pricing/), [Workers limites](https://developers.cloudflare.com/workers/platform/limits/), [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/), [Assets](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/), [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/).

Na Vercel Pro, não transformar uma quantidade de requisições em capacidade garantida: CPU ativa, memória provisionada, invocações, CDN e builds têm métricas próprias. A função do repositório está explicitamente limitada a **60 s**; aumentar o plano não altera esse arquivo. Payload de função também exige conferência da modalidade vigente. [Limites de Functions](https://vercel.com/docs/functions/limitations).

Na Cloudflare, tempo aguardando rede não é CPU, mas mantém recursos e conexão. O limite de 128 MB é compartilhado por requisições concorrentes do isolate. Em domínio com plano Free/Pro de zona, corpo HTTP pode chegar a 100 MB; isso **não** significa que o parser JSON ou o `.hptx` atual possa processar esse tamanho. O app continua com limites menores e o envelope Base64 amplia a requisição. Resposta em streaming não elimina as cópias já produzidas pela criptografia/JSON.

Hyperdrive está incluído no Workers Paid, sem cobrança própria por query ou egress; o Supabase continua cobrando seus recursos. [Preço Hyperdrive](https://developers.cloudflare.com/hyperdrive/platform/pricing/). R2, Queues, Workflows, Durable Objects, Browser Rendering e observabilidade adicional têm modelos próprios; nenhum foi considerado gratuito ou obrigatório nesta estimativa. A documentação de Logs anuncia mudança a partir de **01/12/2026**: revalidar a tarifa antes de contratar.

Deploy via GitHub Actions + Wrangler não usa Workers Builds para compilar quando o build ocorre no runner; ainda consome minutos/armazenamento do GitHub e está sujeito aos limites da API de publicação. Não é publicação ilimitada. Workers Builds pode ser alternativa, não executar dois pipelines para o mesmo commit. [CI GitHub](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/). Segredos devem ficar em bindings/secret store, separados por ambiente e sem `VITE_*`. [Secrets](https://developers.cloudflare.com/workers/configuration/secrets/).

### Cenários calculados e sensibilidade

Hipótese de simulação: requisições abaixo são **dinâmicas**, CPU média **20 ms**, sem serviços adicionais, sem cache de respostas privadas. Não são medições do OSDrive nem limite de oficinas.

`C = 5 + max(R-10.000.000,0)/1.000.000 × 0,30 + max(R×CPUms-30.000.000,0)/1.000.000 × 0,02`.

| Cenário hipotético | R/mês | CPU total | Workers calculado | Vercel Pro comparável |
|---|---:|---:|---:|---|
| Homologação intensa | 100 mil | 2 milhões ms | US$ 5 + builds/CI excedentes | Base US$ 20; uso real ainda não medido |
| Produção inicial, p.ex. 5 oficinas | 200 mil | 4 milhões ms | US$ 5 | Base US$ 20 + eventual excedente |
| Dezenas, p.ex. 50 oficinas | 2 milhões | 40 milhões ms | US$ 5,20 | Base US$ 20 + eventual excedente |
| Centenas, p.ex. 300 oficinas | 20 milhões | 400 milhões ms | US$ 15,40 | Não calculável só por R; medir CPU/memória/banda |
| Sensibilidade: alto tráfego | 100 milhões | 2 bilhões ms | US$ 71,40 | Comparação depende do consumo efetivo |

Exemplo desenvolvimento: 30 builds/dia × 5 min × 30 dias = 4.500 min/mês, dentro dos 6.000 do Workers Builds Paid. 60 builds/dia no mesmo ritmo = 9.000 min e aproximadamente US$ 15 de excedente. GitHub CI separado continua tendo custo próprio.

Se a média subir a 100 ms, 20 milhões de requisições passam a aproximadamente **US$ 47,40** só de Workers. Grandes `.hptx`, logins e muitos logs alteram o resultado. Contar oficinas sem conhecer usuários ativos, requisições, fotos e jobs não dimensiona a infraestrutura.

Supabase Pro parte de US$ 25/mês com um projeto Micro coberto pelos créditos de computação; adicionais Micro partem de cerca de US$ 10 cada. Assim, um arranjo hipotético com um projeto Pro resulta em base aproximada **US$ 30 Cloudflare+Supabase** versus **US$ 45 Vercel+Supabase**. Homologação, OSDrive comercial e Horse Power separados podem exigir mais projetos; não presumir que todos estejam incluídos nesse preço. [Supabase preços](https://supabase.com/pricing). Fotos e snapshots podem dominar o crescimento do banco, independentemente do host do backend.

Economia mínima de hospedagem comparada: US$ 15/mês. Para esforço de migração de valor `M`, retorno simples seria `M/15` meses se o consumo permanecesse na base, sem incluir manutenção. Preço menor de assinatura não prova economia total de engenharia.

## 7. Opções arquiteturais

| Opção | Custo indicativo de hospedagem | Complexidade/manutenção | Segurança e escala | Esforço/risco |
|---|---|---|---|---|
| **A — SPA + API Workers Paid** | US$ 5 + consumo; Supabase separado | Um runtime publicado, bootstrap/DB/jobs adaptados | Isolamento depende do contexto e cache desabilitado; limite de memória exige desenho consciente | 8–15 dias; +5–12 para transferências grandes se necessário; risco médio-alto |
| **B — frontend/API leves Workers + Node para fluxos pesados** | US$ 5 + Node + consumo, ou frontend estático gratuito e API toda em Node | Dois serviços e observabilidade; manter mesma origem por proxy reduz cookies/CORS | Worker não recebe credencial ampla para contornar SQL; Node restrito para jobs, idempotência e rede autenticada | 4–8 dias para divisão inicial; risco médio; não colocar lógica financeira duplicada |
| **C1 — permanecer Vercel Pro** | Base US$ 20 + uso | Menor mudança operacional; resolve restrição comercial do Hobby | Modelo atual preservado; ainda otimizar pacotes, conexões e limites | Menor esforço imediato; custo base maior |
| **C2 — Node tradicional, SPA junto ou estática Cloudflare** | Railway mínimo US$ 5 de uso; Render instância a partir de cerca de US$ 7; VPS sob cotação | Novo bootstrap, deploy, healthcheck, shutdown e scheduler. VPS exige patches/TLS/monitoramento/backups | Mais memória por processo disponível conforme instância; isolamento/RLS continua obrigatório; réplicas multiplicam pools | 2–5 dias em serviço gerenciado; VPS adiciona operação contínua |

[Railway preços](https://railway.com/pricing): Hobby é mínimo de consumo, não servidor ilimitado por US$ 5; Pro parte de US$ 20 e inclui crédito. [Render preços](https://render.com/pricing): conferir CPU/RAM, workspace, banda e builds na contratação; instância pequena pode não suportar imports concorrentes. VPS não foi cotada com fornecedor específico e não recebe preço tratado como fato. Plano gratuito que suspende serviço não é base adequada para webhooks de cobrança disponíveis continuamente.

**Escolha fundamentada:** para reduzir custo com o menor esforço imediato, Node gerenciado merece comparação real com Vercel Pro. Para melhorar distribuição do frontend e manter operação serverless, Workers Paid merece um piloto. Não recomendo arquitetura híbrida permanente só por hábito: adotá-la se os testes demonstrarem que `.hptx`/KDF não cabem com margem no isolate. Não mover o Supabase nem o catálogo nesta migração de hospedagem.

## 8. Plano técnico proposto — depende de nova autorização

1. Fixar commit de aplicação e isolar branch da migração; resolver/rebasear mudanças concorrentes e PR #184 sem mesclar funcionalidades por conveniência.
2. Criar entrada Worker/factory sem I/O global, preservar código de negócio e bootstrap Vercel para rollback. Fixar compatibilidade e Wrangler; testar bundle local no runner.
3. Empacotar CA/configuração; criar bindings de segredos e duas conexões restritas (operacional e administração), com cache SQL inicialmente desativado. Alterações de credenciais/recursos persistentes precisam de autorização específica.
4. Configurar Assets, rotas e fallback de `/admin`, `/p/*`, `/api/*`, `/admin-api/*`; APIs desconhecidas devem retornar JSON 404, não HTML da SPA. Manter headers de segurança e autorização de origem explícita.
5. CI mantém PostgreSQL 17 descartável e dados fictícios. Acrescentar testes workerd, sem CI tocar banco persistente. Build uma vez; promover o artefato exato aprovado para ambiente paralelo após autorização. Token Cloudflare restrito ao alvo, sem salvar segredos em artifacts.
6. Criar ambiente paralelo somente de homologação, sem trocar DNS ou produção; conectar Supabase de homologação apenas quando autorizado. Não copiar configuração da Horse Power.
7. Testar módulos e carga descritos abaixo; medir CPU p50/p95, heap, latência, conexões, falhas, tamanho de bundle/arranque e custo estimado. Critério proposto para fluxos comuns: p95 dentro de 20% da referência atual ou justificativa aprovada; zero divergência financeira/RLS.
8. Testar transferências em tamanhos crescentes, duas oficinas simultâneas e falhas. Não liberar o limite máximo histórico de 64/96 MiB sem margem de memória demonstrada; planejar worker/job Node se necessário. Não reduzir limite silenciosamente.
9. Migrar cron/webhook de sandbox com deduplicação e apenas um scheduler ativo. Validar assinatura, repetição, ordem invertida e recuperação; nunca cobrar clientes reais na prova.
10. Após aceite, apontar somente o endpoint de homologação aprovado e monitorar. Vercel e seus segredos permanecem disponíveis para retorno até uma autorização posterior de desativação.

### Plano de testes obrigatório antes de troca

- Login oficina/admin, MFA, origem inválida, cookies Secure/HttpOnly/SameSite, expiração, logout, revogação e recuperação por e-mail; manter senhas/hash atuais.
- Duas oficinas concorrentes repetindo SELECT com SQL idêntico e tenants distintos: nenhuma leitura cruzada, incluindo após devolução do cliente ao pool, exceção e rollback. Testar proprietário, funcionário por OS atribuída e acesso somente leitura.
- Planos Básico/Profissional/Premium, teste expirado, alterações administrativas e permissões efetivas na API; catálogo paginado, ausência de cache de autorização antiga.
- Clientes/veículos, OS/orçamento, estoque, XML, pagamentos, parcelas, taxas e totais em centavos; finalização/recebimento simultâneos e repetição sem duplicação.
- Checklist antigo e novo, upload JPEG/PNG, limite/erro, isolamento, foto privada, snapshot/reimpressão e link público revogado. Validar formato e assets do PDF no navegador.
- `.hptx` legado e novo: exportar, prévia sem escrita, conferir, mesclar/repetir, substituir com backup fictício, falha/rollback, relações e documentos arquivados; vetores criptográficos e limite de descompressão.
- Resend com envio simulado primeiro; entrega real só para destinatário autorizado. FipePlaca sem consumir créditos reais em teste automatizado. Extensão: CORS/origens, token escopado e duplicação.
- Stripe sandbox: corpo bruto, assinatura inválida, replay, eventos fora de ordem, fatura única, renovação e somente leitura; retornar erro recuperável e permitir reentrega quando banco indisponível.
- Falha no Supabase/provedor, reconexão, timeouts, limites CPU/memória, concorrência, refresh de conversa e monitoramento sem registrar dados pessoais/tokens.

## 9. Rollback

Manter Vercel e versão funcional anterior, segredo MFA e banco compatíveis. A troca de hospedagem não deve depender de migração destrutiva. Na reversão: parar o scheduler novo, confirmar que o antigo pode assumir sem duplicar cobranças, devolver rota/DNS ao alvo anterior aprovado, revalidar origens/cookies e acompanhar webhooks pendentes. Se hostname mudar, reautenticação pode ser necessária; não copiar cookies ou sessões pelo navegador.

Como o banco permanece compartilhado entre os dois runtimes durante o ensaio, **rollback de código não desfaz gravações legítimas**. Usar oficinas fictícias, contratos compatíveis e uma única implementação ativa de jobs. Não restaurar um dump por cima de movimentações novas. Manter versões de assets coerentes para evitar JS antigo chamando API incompatível. Revogar acessos temporários só depois de confirmar retorno; não apagar arquivos/fotos nem projetos como parte de um rollback automático.

## 10. Decisões e lacunas reais

- Aprovar ou não uma prova de compatibilidade Workers Paid; esta auditoria não a autoriza.
- Escolher A, B ou C a partir do custo de engenharia, não só da mensalidade.
- Definir orçamento mensal, alarmes e política para excedentes. Não assumir que o limite de CPU é teto financeiro global. Avaliar [Workers spending limits](https://developers.cloudflare.com/workers/platform/spend-management/), que podem recusar novas invocações ao atingir o teto; considerar o impacto na disponibilidade de login e webhooks.
- Definir teto de arquivos, concorrência e retenção de backups/fotos preservando históricos.
- Confirmar os papéis/credenciais/endpoint TLS do Supabase quando a implantação for autorizada, sem reduzir RLS.
- Medir runtime real: desempenho, uso concorrente e memória não foram mensurados aqui. Nenhuma funcionalidade recebeu selo de “testada no Workers”.
- Não há evidência nesta tarefa sobre conta/plano Cloudflare do responsável; não solicitar credenciais para concluir o relatório.
- O Directory Stripe não estava instalado no ambiente; consultada sua documentação, sem instalar ferramenta de pagamento para uma auditoria. A pesquisa técnica e de preços usou diretamente fontes oficiais dos provedores.

## 11. Encerramento documental

Único arquivo alterado nesta tarefa: este relatório. Verificações previstas: diff documental, links locais, fórmulas, referências oficiais, ausência de segredos e status do PR. Não se executou build/teste demorado manualmente, pois não houve código alterado; verificações automáticas obrigatórias do repositório são acompanhadas se disparadas pelo PR. Nenhuma falha de deployment deve ser mascarada como falha de teste de compatibilidade Workers.

**Conclusão:** é tecnicamente razoável avaliar Workers Paid e economicamente promissor para baixo/médio consumo. **Não é recomendável migrar integralmente o OSDrive atual sem um piloto**, principalmente por transferências grandes e preservação do contexto PostgreSQL/RLS. Para economia imediata com menor esforço, comparar Node gerenciado; para o médio prazo serverless, provar A e manter B como contingência. A migração e qualquer gasto aguardam nova autorização.
