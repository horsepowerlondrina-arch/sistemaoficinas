# INF-011 — Homologação paralela Cloudflare

Data: 14/11/2026. Base: main `68dc006`. Repositório exclusivo: `horsepowerlondrina-arch/sistemaoficinas`.

## Escopo e autorização

O responsável autorizou implementar e validar uma homologação paralela, mantendo Supabase e Vercel para retorno. Não autorizou produção ou contratação de planos pagos. Autorizou reutilizar somente as duas conexões restritas e a chave MFA existentes no arquivo privado da INF-010. Não houve migração, criação de papéis, grants ou redefinição de credenciais.

Conta Cloudflare: `398bbed171a2a062429f9e2efa6df1cc`. Worker: `sistema-oficinas-homologacao`. Endereço: https://sistema-oficinas-homologacao.osdrive-homologacao.workers.dev. Nenhuma zona DNS ou domínio comercial é alterado. O subdomínio workers.dev foi criado para este piloto.

## Arquitetura

- React/Vite 6 e seus comandos atuais permanecem intactos. `npm run build:cloudflare` primeiro executa o build existente e depois o empacotador em `cloudflare/`.
- O subprojeto usa `cf` e Cloudflare Vite plugin 2 beta, com seu próprio Vite 7 corrigido e lockfile. Não atualiza o Vite da aplicação nem cria configuração Wrangler.
- `cloudflare/cloudflare.config.ts` contém somente configuração pública, certificado CA público, Assets e declarações de segredos. Não tem domínios customizados, cron, Hyperdrive ou recursos pagos. `cf deploy --prebuilt --no-provision` não cria recursos auxiliares.
- PostgreSQL permanece no Supabase `vnclahdnirqlcbamodqy`, via TLS verificado. Pools são criados por requisição e encerrados após a resposta; não há sockets/pools/identidade compartilhados entre requisições Workers. Express usa o adaptador oficial `cloudflare:node`.
- O código transacional e os tipos de DB foram separados de `node:sqlite`. SQLite permanece disponível para os testes existentes; não integra o bundle Workers.
- Os três segredos são provisionados privadamente pelo CLI oficial: `DATABASE_URL`, `PLATFORM_ADMIN_DATABASE_URL`, `PLATFORM_ADMIN_TOTP_ENCRYPTION_KEY`. Nunca incluir valores no Git, logs, artifacts ou relatório. Arquivos privados em `data/` continuam ignorados.
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
