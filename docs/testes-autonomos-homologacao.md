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

## Jornadas operacionais das três oficinas fictícias

`TEST_OPERATIONAL_WRITES=fictitious-homologation-only npm run test:operations` executa a rodada operacional autorizada. O comando recusa produção, valida o manifesto privado e os identificadores das três oficinas previamente ativadas e confere a identidade Master antes de qualquer cadastro. Cada oficina utiliza um contexto Chromium novo; não utiliza a sessão do responsável. Nenhuma chave administrativa de banco é usada: os movimentos passam pelas APIs normais e pelas telas da aplicação.

A jornada cobre cadastro conjunto de cliente e veículo pela interface, edição e recuperação, checklist pela placa local, rascunho, finalização com justificativa da ausência de assinatura, orçamento automático, produtos e serviços próprios, desconto, aprovação, execução, conclusão e recebimento. Profissional e Premium verificam entrada idempotente e baixa de estoque, recebimento Pix e pagamento de despesa com conciliação do caixa. Básico verifica bloqueio dos módulos não contratados e o recebimento simples da OS.

O progresso fica em `data/operacional-20261114.json`, privado e ignorado pelo Git. Uma retomada usa os mesmos registros; não remova checkpoints para forçar nova execução. Após resposta de rede inconclusiva, confira o estado salvo e o recurso correspondente antes de repetir uma operação. As imagens e o relatório ficam por padrão na pasta local `relatorios/operacionais-2026-11-14`, fora do checkout. Não enviar credenciais, cookies ou e-mails de ativação para artifacts. Evidências online são separadas da biblioteca visual oficial, cuja captura continua restrita ao ambiente descartável.

O CI reaproveita `selfService.postgres.integration.ts` e `helpers/operationalJourney.ts`: cada plano recém-ativado percorre os mesmos vínculos operacionais e cálculos em PostgreSQL 17 temporário. Inclui negativas para desconto inválido, edição de OS concluída, recebimento duplicado, desconto após recebimento e documento de outra oficina. O CI não executa o comando de homologação nem acessa bancos persistentes.

## Cartões, parcelamento, pagamentos mistos e estornos

`TEST_FINANCIAL_WRITES=fictitious-homologation-only npm run test:finance` executa a matriz financeira nas mesmas três oficinas fictícias, usando sessões próprias e os vínculos de cliente/veículo já conferidos. Exige o manifesto privado e a rodada operacional anterior. Novas OS, peça e contas identificadas com `FIN-ADV-20261114` separam os testes dos movimentos anteriores. Checkpoints privados ficam em `data/financeiro-avancado-20261114.json`; as evidências ficam fora do checkout, em `relatorios/financeiro-avancado-2026-11-14`.

O harness compartilhado `tests/helpers/financialJourney.ts` usa valores esperados fixos de centavos para débito, crédito à vista, crédito 3x, repasse, Pix + cartão nas duas ordens de recebimento, boleto 3x com juros totais, desconto e duas solicitações simultâneas de baixa. Confere bruto, taxa, líquido, soma das parcelas, saldo imediato e crédito futuro. Valida planos inválidos sem substituir parcelas, recebimento duplicado, proteção de valores já pagos e preservação dos snapshots após mudança/desativação da máquina. O CI executa a mesma matriz após ativar cada plano em PostgreSQL 17 temporário; não executa o driver remoto.

No Básico, as modalidades financeiras não incluídas são recusadas e o recebimento simples pode ser estornado com motivo, reabrindo e recebendo novamente a OS. Nos planos com Financeiro, a reabertura antes de receber desfaz a finalização e restaura o estoque; após recebimento ela é bloqueada. O produto ainda não oferece uma ação operacional para estornar recebimentos no Financeiro. O teste registra essa limitação explicitamente: não desbloqueia reaberturas, não cria compensações artificiais e não trata o bloqueio como um estorno executado.

Esses pagamentos são registros operacionais fictícios. Não criam transações com adquirentes ou com a Stripe, não validam reembolso por provedor e não modificam assinaturas ou oficinas reais. A API normal determina permissões e isolamento em todas as gravações.
