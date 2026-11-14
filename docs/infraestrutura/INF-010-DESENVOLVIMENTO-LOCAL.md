# INF-010 — Desenvolvimento local e publicação consolidada

Data: 14/11/2026. Base inicial: `d2b8292` (`main`). Somente `horsepowerlondrina-arch/sistemaoficinas`.

## Modalidades e segurança

O GitHub e o CI continuam sendo a referência. Desenvolvimento local é uma opção, não condição para versionar ou integrar PRs. Não é necessário instalar PostgreSQL para usar `dev:homologation`.

- `npm run dev:homologation`: React/Vite + Express completo, incluindo administração e transferência, ligado **exclusivamente** ao Supabase `vnclahdnirqlcbamodqy`.
- `npm run dev` e `dev:admin`: mantidos para o PostgreSQL local/descartável existente. Não apontar esses comandos antigos para Supabase.
- GitHub Actions: PostgreSQL **17 temporário**, dados fictícios, build, testes gerais, operacionais, financeiros, permissões e interfaces. Nunca usa banco persistente ou credenciais da Vercel.

Nenhuma migração remota é necessária para a INF-010. O modo local não aplica migrações nem cria oficinas automaticamente. RLS, identidade transacional, pools separados, autorização, limites de plano, permissões financeiras e MFA continuam os mesmos da aplicação publicada.

## Linux e configuração inicial

Instale Node **24** e npm usando uma distribuição oficial/gerenciador da sua preferência. Depois, em um checkout isolado da branch da tarefa:

```bash
npm ci
npm run dev:configure
npm run dev:homologation
```

`dev:configure` é um assistente de terminal privado com entrada oculta. Solicita somente:

1. `DATABASE_URL`: papel `horse_power_app` da homologação.
2. `PLATFORM_ADMIN_DATABASE_URL`: papel separado `hp_platform_admin_app` da homologação.
3. `PLATFORM_ADMIN_TOTP_ENCRYPTION_KEY`: chave **existente** da homologação. Não gerar outra para tentar autenticar administradores existentes.

As conexões aceitam o host direto `db.vnclahdnirqlcbamodqy.supabase.co:5432` ou pooler Supabase `aws-….pooler.supabase.com`, portas 5432/6543. No pooler, o usuário inclui `.vnclahdnirqlcbamodqy`. Banco `postgres`, senha codificada na URL, sem parâmetros adicionais. TLS usa o certificado CA versionado com verificação obrigatória. Não usar `postgres`, `service_role`, credenciais da Horse Power definitiva ou banco histórico.

O assistente grava `.env.development.local` com permissão **0600**, ignorado pelo Git. Recusa sobrescrever arquivo existente. O modelo sem segredos é [`.env.development.example`](../../.env.development.example). Para outro arquivo privado, use `DEV_ENV_FILE=/caminho/privado`. Não use arquivos protegidos de outros diretórios nem grave valores em comandos, chat, logs, artefatos ou commits.

### Recuperação segura da configuração

Procure os valores no gerenciador de segredos original. A Vercel pode manter Secrets sem permitir recuperar seu conteúdo: listar variáveis, `get_project_env` e `vercel env pull` **não garantem** acesso a esses valores. Não tentar extraí-los de deployments, criar endpoints de diagnóstico, ler senhas do banco ou redefinir credenciais existentes para contornar isso.

Nesta execução, os três valores da homologação foram identificados como `sensitive/secret`, e a consulta autorizada ao segredo MFA retornou somente metadados. Nenhum valor foi recuperado/copiado ou alterado. A execução contra Supabase permanece pendente até configuração segura pelo responsável ou outro mecanismo autorizado disponível. A existência de testes aprovados no banco descartável não comprova conexão local com Supabase.

## Endereços, proxy e sessões

Slot 1: frontend **http://127.0.0.1:5173**, administração **http://127.0.0.1:5173/admin**, API **http://127.0.0.1:3001/api**.

O Vite encaminha `/api` ao Express e traduz `/admin-api` para `/api/admin-api` no mesmo backend. Documentos públicos `/p/…`, ativação e SPA são atendidos pelo Vite. Abra sempre o endereço **127.0.0.1**, sem alternar com localhost durante a sessão.

Todos os listeners usam loopback, sem exposição à rede local. Cookies continuam HttpOnly/SameSite; HTTP de loopback não usa Secure, como os testes locais existentes. Configuração de produção não é aceita pelo modo local. Origem e portas são validadas; não é adicionado CORS aberto nem bypass de senha/MFA. Logout e expiração continuam validados no servidor. Pools são encerrados com Ctrl+C e em falha de inicialização.

O bootstrap compartilhado está em `server/cloudRuntime.ts`; `server/cloud.ts` mantém a entrada publicada. O modo local usa a mesma composição de APIs, sem copiar a lógica de negócio.

## Integrações externas

Neste modo seguro, credenciais de Stripe, Mercado Pago, Resend, FipePlaca, cron e antigos bypasses MFA são removidas do ambiente do processo. Chamadas HTTP externas do servidor são bloqueadas. Isso também impede consumo de chaves de provedor guardadas por oficina no banco. Não há agendamento automático local.

Consequência explícita: envio real de e-mail, consulta paga de placa, checkout/webhook remoto e download de arquivo por integração externa **não são validados por este modo**. Seus testes simulados continuam no CI. Para habilitar algum provedor de teste futuramente, criar configuração restrita e autorização própria; não copiar chaves comerciais para o desenvolvimento. Links manuais e funções que não dependem desses serviços podem ser exercitados com dados fictícios e permissões normais.

## Dois Codex e separação de testes

Cada execução tem checkout/branch própria; nenhuma pasta de trabalho compartilhada. Não há obrigação de usar worktree se outro isolamento já existir.

```bash
# Primeiro ambiente
DEV_SLOT=1 DEV_RUN_ID=inf010-codex-a npm run dev:homologation
# Segundo, em outra pasta e branch
DEV_SLOT=2 DEV_RUN_ID=inf010-codex-b npm run dev:homologation
```

Slot 2 usa frontend 5174/API 3011. `DEV_WEB_PORT` e `DEV_API_PORT` permitem outras portas não privilegiadas; colisões são detectadas antes da abertura dos pools. Cada processo tem seus próprios pools e origens. Cookies não são isolados por porta: **usar perfis/contextos de navegador separados** para evitar substituir as sessões entre execuções.

Cada Codex reserva uma oficina fictícia distinta antes de gravar. Registre o ID e use `DEV_RUN_ID` como prefixo nos nomes/descrições/referências de dados de teste. O identificador é uma convenção de rastreabilidade, **não** permissão, partição automática de banco ou filtro substituto de RLS. Nunca testar simultaneamente na mesma oficina. Oito oficinas existiam na inspeção agregada inicial; nenhuma foi removida.

Migrações e operações destrutivas remotas são sequenciais: combinar a janela com a outra execução, registrar início/fim e, em futuras rotinas SQL autorizadas, utilizar o mesmo `pg_advisory_xact_lock` para manutenção. Não executar DDL em paralelo com testes ativos. INF-010 não cria um executor genérico de SQL ou bypass administrativo.

## Testes funcionais e automatizados

```bash
npm run build
npm test
# O workflow existente executa esta etapa com PostgreSQL 17 temporário:
npm run test:postgres
```

Não executar a suíte PostgreSQL contra Supabase. Ela mantém os bloqueios de loopback. Novos testes cobrem rejeição de projeto/roles privilegiados/opções de URL, MFA ausente, origens incoerentes, execução online, portas, dois slots, bloqueio de provedores e política de publicação.

Após as conexões locais estarem configuradas, validar numa oficina fictícia reservada:

| Fluxo | Verificação e evidência esperada |
|---|---|
| Login/sessões | Login normal, atualização de página, logout, cookie inválido/expirado e 401 sem sessão |
| Administração | MFA obrigatório, permissões efetivas, listar oficinas e histórico; sem alterar outras oficinas |
| Clientes/veículos | Criar com prefixo de execução; conferir vínculo, persistência e ausência de duplicação |
| Serviços/catálogo | Serviço próprio, marcas/modelos/tempos com plano permitido e negativa sem Premium |
| Orçamento/OS | Itens, descontos, totais em centavos, conversão, finalização e bloqueios de alteração |
| Checklist | Vincular à OS e testar foto fictícia/documento; considerar o estado real da PR de Storage |
| Produtos/estoque | Cadastro, entrada/saída fictícia e saldo; negativo cruzado entre oficinas |
| Financeiro/recebimentos | Recebimento simulado, parcelas, caixa, estorno/regras financeiras |
| Configurações | Salvar/ler novamente na oficina reservada, sem modificar outras oficinas |
| Documentos | Impressão do navegador/PDF e link público fictício sem dados de outras oficinas |
| Isolamento | Sessões distintas, IDs de outro tenant negados e acesso administrativo sem privilégio negado |

Conferir no Supabase por consultas agregadas dos IDs/prefixos criados, sem retornar dados pessoais desnecessários. Registrar resultados observados; não marcar essas etapas como realizadas só porque existe código ou CI aprovado.

## MAP-001 e capturas locais

A biblioteca continua em `docs/mapeamento-visual/`. Leia README/INDEX/CHECKLIST antes de atualizar capturas.

- `npm run visual:capture -- --module <id>` continua usando apenas fixtures de PostgreSQL **descartável**, como no GitHub Actions; não usa Supabase compartilhado. O script rejeita `LOCAL_HOMOLOGATION=true`.
- `VISUAL_BASE_URL=http://127.0.0.1:5173 npm run visual:local:readonly -- /inicio` captura uma página local existente em `data/inf010-capturas/`, sem login automatizado, sem seed/cleanup, bloqueando pedidos de escrita e recursos externos. Pode capturar o login; não comprova um módulo autenticado.
- Para captura autenticada com dados persistentes, usar o navegador do responsável ou preparar uma automação específica da oficina fictícia; não fornecer sessões reais ao script de fixtures.
- Imagens aprovadas da interface real podem ser incorporadas à biblioteca com identificação do ambiente, commit, data e dados fictícios; depois `npm run visual:index` e `npm run visual:check`.

Caso o Chromium do Playwright não esteja instalado, execute `npx playwright install chromium`, ou indique um Chrome existente com `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/caminho/do/chrome`. A captura local de `/inicio` foi gerada e inspecionada nesta execução, usando Chrome já instalado e API com banco fictício em memória (sem Supabase).

A INF-010 não modifica a interface do produto e não acrescenta galeria pública. Testes visuais do CI continuam produzindo evidências temporárias da aplicação real.

## Publicação consolidada e retomada

`vercel.json` define **`git.deploymentEnabled: false`**. Isso desliga deployments disparados por eventos Git sem desligar a aplicação existente, sem excluir histórico e sem desativar a integração Git/GitHub Actions. A configuração passa a valer nos commits que a contêm; branches antigas sem essa configuração ainda podem disparar Preview. Não modifica as configurações do projeto Horse Power definitivo nem sua versão publicada.

PRs continuam sendo integrados após CI aprovado. O SHA de `main` pode ficar à frente do SHA publicado, e isso deve ser declarado nos relatórios. Falha de deployment por limite externo não equivale a teste de aplicação reprovado; não desabilitar os testes obrigatórios nem contornar proteção da branch.

### Publicar todas as melhorias aprovadas

1. Atualizar `main`, conferir HEAD e CI desse SHA; todos os PRs desejados devem estar integrados. Não usar checkout antigo com alterações locais.
2. Conferir destino **somente** `sistema-oficinas-homologacao`, time `horse-power2`, ID `prj_rLVsFKBpMXQFtfm1kgYHFQObr4Jc` e Supabase homologação. Verificar migrações necessárias antes de publicar.
3. Quando houver cota, criar uma publicação **manual** do SHA consolidado por Vercel/API conectada, ou CLI oficial em checkout limpo vinculado ao projeto correto (`vercel --prod` no contexto **do projeto de homologação**). `git.deploymentEnabled` controla eventos Git, não é proibição permanente de publicações manuais. Autenticar no painel/CLI sem registrar tokens em comandos.
4. Nunca usar “Redeploy” de uma versão antiga supondo que ela incorporará a `main` nova. Confirmar SHA, READY, aliases e validação funcional depois da publicação.
5. Se falhar, manter o deployment anterior ativo e registrar o erro. Não fazer retry em loop nem contratar plano automaticamente.

A INF-010 **não executa essa publicação**. O projeto definitivo da Horse Power e seus domínios permanecem fora do escopo.

### Evitar builds documentais e reativar o fluxo normal

O `ignoreCommand` aponta para `scripts/vercel-ignore-docs.mjs`. Se a comparação com `VERCEL_GIT_PREVIOUS_SHA` mostrar somente documentação, retorna 0 (cancelar build). Mudança funcional ou histórico desconhecido retorna 1 (construir), evitando ocultar uma melhoria junto com documentação. Não remove testes do CI. Esse comando é uma segunda proteção: a pausa dos eventos Git é o mecanismo que evita dispará-los durante a restrição.

Para voltar ao automático, mudar apenas `git.deploymentEnabled` para `true` num PR, testar e integrar. Manter o filtro documental. Para voltar completamente à configuração anterior, remover também `ignoreCommand`. São alterações reversíveis; não exigem tocar nos deployments existentes.

Documentação oficial: [controle de deployments Git](https://vercel.com/docs/project-configuration/git-configuration), [configuração Vercel](https://vercel.com/docs/project-configuration/vercel-json), [conexões PostgreSQL Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres).

## Situação e problemas conhecidos

- Build e suíte geral executados localmente; teste adicional de proxy confirmou login, sessão, logout, cookie inválido, origem não autorizada e roteamento administrativo; suíte PostgreSQL 17 e interfaces são conferidas no run do PR.
- Nenhum esquema, segredo remoto, usuário ou dado persistente foi alterado pela preparação desta infraestrutura.
- Conexão real da aplicação local com Supabase e roteiro autenticado completo pendentes: os Secrets da Vercel não retornam os três valores necessários pela integração disponível. Sem redefinir chaves existentes.
- O ambiente do agente precisou de autorização para abrir portas locais nos testes; não é requisito de produção nem falha da aplicação.
- Efeitos externos comerciais ficam bloqueados deliberadamente. Captura somente leitura não substitui validação funcional autenticada.
- Capturas/validação no PostgreSQL descartável não comprovam disponibilidade de integrações remotas.
- A avaliação Cloudflare permanece suspensa até nova decisão. Nenhum serviço foi criado/contratado.

## Acessos exclusivos autorizados para o Linux (continuação INF-010)

Quando os Secrets originais não estão disponíveis, o responsável autorizou credenciais novas **sem modificar as existentes**:

- `osdrive_local_app` herda somente `horse_power_app`.
- `osdrive_local_admin` herda somente `hp_platform_admin_app`.
- Os novos logins não são superusuários, não ignoram RLS, não criam bancos/papéis e não podem assumir o papel herdado por `SET ROLE` nem concedê-lo a terceiros. A validade inicial é 30 dias e os pools continuam separados.
- `.env.development.local` contém `LOCAL_EXCLUSIVE_CREDENTIALS=true` e uma chave MFA **nova e exclusiva**. Essa chave não é colocada na Vercel e não é aplicada às contas existentes.
- A conta `inf010-admin@example.test` usa senha e MFA próprios; não é uma conta de e-mail real e nenhum convite externo é enviado. No modo exclusivo, tentativas de login de outros administradores são recusadas antes de acessar/alterar suas contas; inscrição MFA e alterações de administradores ficam bloqueadas.
- A senha e o segredo MFA dessa conta ficam somente em `data/inf010-exclusive.json` (0600), ignorado pelo Git. São dados de teste privados: não anexar a relatórios ou artefatos. Não são credenciais da oficina.

A preparação de papéis é explícita em `scripts/infra/inf010-create-local-roles.sql`, fora do conjunto de migrações automáticas. O SQL não contém senhas. Um auxiliar temporário, restrito a `postgres`, recebe somente verificadores SCRAM gerados no Linux para habilitar **apenas os dois nomes novos**. É removido depois da configuração. As senhas em texto não são enviadas por consultas SQL nem armazenadas no histórico de migrações.

A migração `20261114222723_inf010_local_support_identity.sql` adiciona ao Suporte somente o login `osdrive_local_app` **com associação efetiva ao papel operacional**; tenant, usuário e vínculo continuam obrigatórios. Não altera tabelas ou registros de chamados. A cópia `local-postgres/040-inf010-local-support-identity.sql` permite validar essa regra no PostgreSQL 17 temporário, incluindo leitura autorizada e negativa entre oficinas.

**Recuperação/revogação:** colocar os dois logins novos em NOLOGIN, revogar somente suas associações e desativar a conta `inf010-admin@example.test`, preservando a auditoria. Se necessário, restaurar `workshop_support_identity` usando a definição anterior da migração `20261111000100_admin_support.sql`. Nunca redefinir `horse_power_app`, `hp_platform_admin_app` ou o MFA dos administradores existentes. Não excluir oficinas de testes como forma de revogação.

O modo original com os três Secrets existentes continua disponível. Usar a conta administrativa exclusiva para teste local; ela não substitui a conta real do responsável nem altera a autenticação publicada.
