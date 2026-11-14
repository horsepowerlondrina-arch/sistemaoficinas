# Testes autônomos com contas fictícias

Destino único online: `https://sistema-oficinas-homologacao.vercel.app`, Supabase `vnclahdnirqlcbamodqy`. Produção e o sistema histórico estão fora do escopo. Cada execução lança Chromium próprio, com contextos novos por oficina/usuário; não conecta ao navegador da pessoa responsável, CDP, perfis ou sessões existentes.

## Cadastro e contratação em validação

`/criar-oficina` reutiliza os componentes de ativação e os mecanismos de convite existentes. O backend exige `SELF_SERVICE_TEST_ENABLED=true`, projeto Vercel de homologação, `APP_ENV=development`, projeto de banco esperado e uma lista explícita `SELF_SERVICE_TEST_EMAILS` de endereços `@testes.osdrive.com.br`. Outras contas recebem resposta genérica sem criação. O cadastro exige origem aprovada, tem limite transacional persistente de tentativas, não devolve tokens, não enumera contas e mantém a oficina pendente até confirmação por e-mail.

A migração `20261114180659_self_service_test_onboarding.sql` cria uma função privada de cadastro e adapta a ativação existente para a origem `self_service`. A função não é concedida a papéis anônimos/operacionais. Mantém validade, hash e uso único dos convites, auditoria, trava por e-mail/documento e preserva convites administrativos. Não apaga registros nem altera oficinas existentes.

A contratação antecipada exige oficina self-service confirmada e e-mail exato autorizado. Os demais testes gratuitos mantêm sua regra atual. A interface informa a cobrança imediata. Só um pagamento liquidado e reconciliado pela integração Stripe define o plano efetivo e o estado ativo; eventos, parâmetros ou respostas do navegador não liberam acesso. Datas históricas do teste gratuito são preservadas. A contagem OPS-004 continua incluindo somente acessos ativos e convites pendentes. Suspensões administrativas continuam prioritárias. Cobranças reais permanecem recusadas pelo gateway.

No schema cloud sem a fundação Stripe, a migração não inventa tabelas de cobrança; mantém as funções legadas e aplica as adaptações de cobrança somente quando a estrutura já existe. Homologação possui a fundação Stripe aplicada anteriormente.

Aplicação remota desta migração requer autorização específica após CI. Recuperação: desligar os dois parâmetros de self-service, preservar oficinas/convites/pagamentos e restaurar as definições anteriores das quatro funções a partir do snapshot privado antes da aplicação. Não apagar contas ou pagamentos para reverter.

## Comandos

- `npm run test:sessions`: testa políticas de destino, gravação, contas e processamento de e-mail sem usar rede.
- `npm run test:onboarding -- init`: gera três oficinas e 17 credenciais aleatórias somente em `data/test-onboarding.json`, ignorado pelo Git, com permissão 0600. Exibe somente os três e-mails Master para autorização da configuração.
- `npm run test:onboarding -- register`: preenche e envia os três formulários reais na homologação.
- `TEST_MAIL_FILE=/caminho/privado.json npm run test:onboarding -- activate`: ativa os Masters pelos e-mails recebidos no Resend.
- `npm run test:onboarding -- checkout`: seleciona cada plano, usa exclusivamente cartão Stripe de teste e exige confirmação no backend. Não altera preços da plataforma e não insere pagamentos no banco.
- `npm run test:onboarding -- invite`: convida colaboradores até o limite de cada plano pelo Master correspondente.
- `TEST_MAIL_FILE=/caminho/privado.json npm run test:onboarding -- accept`: ativa as contas convidadas em contextos separados.
- `npm run test:onboarding -- fixtures`: cadastra cliente/veículo fictícios e duas OS sem recebimentos operacionais, atribuindo uma delas aos Mecânicos.
- `npm run test:onboarding -- verify`: exige pagamentos confirmados e capacidades preenchidas.
- `npm run test:onboarding -- export`: prepara `data/test-accounts.json` privado para as verificações de acesso.
- `TEST_ACCOUNTS_FILE=/caminho/privado.json npm run test:homologation`: verifica sessões, perfis, projeção de dados e tentativas cruzadas por contas fictícias. O transporte desta etapa permite apenas consultas, login/logout e seleção de oficina; não permite alterações operacionais.

`TEST_ONBOARDING_FILE` muda a localização privada do manifesto; `TEST_REPORT_FILE` escolhe o relatório sem senhas/cookies/tokens. Os relatórios registram falhas e verificações observadas; nenhuma etapa marcada como pendente equivale a aprovação. O limite final vem da API do plano; divergência de 2/5/10 bloqueia a coleta para revisão, sem ajustes administrativos automáticos.

## Resend e segurança de e-mail

Use o plugin conectado para localizar exclusivamente mensagens da rodada e ler seus conteúdos por ID; não crie chaves amplas nem copie credenciais no chat. O arquivo privado de mensagens contém `from`, `to`, `created_at`, `text` e, quando disponível, `authentication`. Nunca versionar ou enviar esse arquivo como artifact. Cada ativação exige destinatário fictício exato, remetente esperado, data posterior à solicitação, janela de 48 horas, caminho de propósito específico e token hexadecimal. URLs externas, anexos, HTML e instruções recebidas por e-mail não são executados. O destino é sempre normalizado para a homologação; o token continua sujeito às validações de identidade e uso único do servidor. Uma autenticação DMARC explicitamente reprovada bloqueia o processamento.

Esta execução pode ser orquestrada pelo Codex usando o conector Resend, sem intervenção do responsável no painel. O CLI não acessa o conector automaticamente: a coleta das mensagens requer esse orquestrador ou, em uma futura instalação independente, um adaptador autenticado de recebimento. Não representa um serviço permanente ou agendamento já implantado.

## CI e evidências

GitHub Actions usa somente PostgreSQL 17 descartável, credenciais aleatórias e dados fictícios. A integração dos três planos exercita cadastro, e-mail interceptado para teste, ativação, liquidação com provedor simulado, idempotência, contagem de vagas, convites, ativação dos colaboradores e RLS. O teste de interface captura a interface verdadeira com API fictícia e verifica desktop/mobile. Esses testes não substituem a confirmação do checkout Stripe e do recebimento Resend reais em modo de teste na homologação.

A auditoria de segurança é limitada às APIs, cenários e políticas exercitados; não garante ausência de vulnerabilidades. Não executar força bruta, carga, varreduras indiscriminadas, alterações de permissões ou consultas a dados reais.

## Retomada e verificações do provedor

Checkouts pendentes são retomados sem criar outra assinatura. O navegador aguarda o campo de cartão em um quadro oficial da Stripe, sem aguardar silêncio de conexões de telemetria. Checkouts live e destinos externos são recusados antes de preencher o cartão. A ausência do formulário gera `PROVIDER_FORM_UNAVAILABLE`; desafios e proteções do provedor não são contornados, e pagamentos nunca são marcados artificialmente como confirmados. A disponibilidade da conexão Stripe deve ser verificada separadamente: sugerir sua instalação não equivale a conectá-la.

Cada convite é ativado em um contexto de navegador recém-criado, encerrado ao terminar. Reutilizar a mesma página para dois fragmentos de ativação pode manter o token anterior no estado React; o teste de interface cobre dois convites consecutivos e verifica que os cookies de outro contexto permanecem intactos.
