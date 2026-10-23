> Configuração online: [docs/07-supabase-vercel.md](docs/07-supabase-vercel.md). Esta branch prepara desenvolvimento PostgreSQL local e não publica alterações.

# Horse Power

Fundação de um SaaS de gestão para oficinas mecânicas.

## Executar localmente

Requer Node.js 24, npm e PostgreSQL 17 local. Siga primeiro o
[guia PostgreSQL no Windows](docs/postgresql-local.md) para criar o banco
`horse_power_local`, o usuário restrito e o arquivo ignorado `.env.local`.

```powershell
npm.cmd ci
npm.cmd run db:local:migrate
npm.cmd run db:local:seed
npm.cmd run dev
```

Abra **http://127.0.0.1:5173**. O seed cria somente oficinas e dados fictícios;
as senhas aleatórias ficam em `data/local-credentials.json`, fora do Git.
O servidor local exige PostgreSQL e não abre nem altera o SQLite anterior.

```powershell
npm.cmd run build
npm.cmd test
npm.cmd run test:postgres
npm.cmd start
```

`npm start` requer build prévio e serve a versão compilada em
http://127.0.0.1:3001. Os testes existentes preservam SQLite em memória como
infraestrutura de testes, sem fallback SQLite na execução da aplicação.
A [análise do catálogo original](docs/catalogo-importacao-local.md) descreve
as duas fontes encontradas e o plano de importação; nenhuma foi importada.

## Funcional nesta fase

- Login com senha protegida, sessões no servidor e acesso exclusivo à Horse Power nesta instalação.
- Dashboard com faturamento de peças e serviços, lucro bruto das peças, recebimentos líquidos, atendimento e entregas.
- Clientes e veículos: criar, editar, inativar, buscar e consultar histórico de OS.
- Produtos, serviços e profissionais: criar, editar, inativar e filtrar.
- Cadastro conjunto de cliente e veículo; produtos e serviços em abas, com criação sem sair do atendimento.
- Orçamento → aprovação → aberta → execução → pronta → finalizada; cancelamento antes da conclusão.
- Orçamento sem cadastro obrigatório, cancelados na listagem e OS a receber visíveis até a quitação.
- Visualização simples da OS separada da edição, com acesso próprio do mecânico e proteção financeira no servidor.
- Consulta por placa no cadastro local; conector FipePlaca preservado; consultas pagas ficam desativadas nesta configuração local.
- Itens, quantidades, preço, atribuição de profissional, desconto, relato, observações e datas.
- Impressão de OS/orçamento; o navegador permite salvar em PDF.
- Estoque com ajustes justificados, histórico de movimentos e alertas de mínimo.
- Conclusão de OS com baixa de estoque e recebível na mesma transação; estoque insuficiente impede a conclusão integralmente.
- Recebimento por parcela, com taxa da operadora e juros do cliente separados, prévia de líquido e confirmações individuais no caixa.
- Busca geral, filtros de situação/período e exportação de ordens em CSV.
- Navegação responsiva e notificações calculadas dos dados disponíveis.

## Como explorar o fluxo

1. Use Clientes e Veículos ou cadastre-os diretamente em uma nova OS.
2. Crie um orçamento, com ou sem cliente cadastrado, e adicione produtos e serviços.
3. Salve, vincule cliente/veículo antes de aprovar o orçamento. Avance para execução e pronta para entrega.
4. Finalize a OS para abrir o recebimento. Confira valores, parcelas e taxas.
5. Salve as condições e confirme as parcelas recebidas. A OS permanece a receber até a última parcela.
6. Recarregue a página para verificar persistência. Troque de oficina para conferir a separação dos dados.

## Organização

- `docs/01-inventario-referencias.md`: inventário por screenshot, limitações das evidências e fluxos.
- `docs/04-alteracoes-operacionais.md`: novos fluxos, taxas, permissões e ativação opcional da consulta por placa.
- `docs/02-arquitetura.md`: entidades, isolamento multiempresa, regras, rotas e design system.
- `src/pages`: telas e fluxos de interface.
- `src/components`: elementos compartilhados e tabela de ordens.
- `src/lib`: tipos, cliente HTTP e contexto da aplicação.
- `server/auth`: senhas e sessões.
- `server/domain`: regras de cálculo e transição.
- `server/services`: casos de uso transacionais.
- `server/db`: esquema, conexão e dados fictícios.
- `server/app.ts`: rotas HTTP e validação de entrada.
- `tests`: verificações de comportamento e isolamento.

## Limites e próximos módulos

Compras, fornecedores completos, venda rápida, contas a pagar, retiradas, adiantamentos, comissões, checklist, agenda, relatórios avançados e administração de usuários ficam para incrementos seguintes. Configurações apresenta taxas padrão, dados atuais e planejamento; edição da empresa e convites ainda não estão implementados. Tempario, consulta de tempo técnico e suas automações estão explicitamente fora desta fase.

O banco local SQLite e os dados de demonstração atendem à validação da fundação. A preparação comercial inclui migração para PostgreSQL, backups, monitoramento, HTTPS, recuperação de conta, permissões granulares e testes de concorrência. O endpoint inicial carrega os dados da oficina para simplificar a primeira fase; paginação e consultas específicas deverão preceder volumes comerciais. As fontes usam Google Fonts com fallback local; a consulta externa por placa usa chave por oficina, conforme `docs/04-alteracoes-operacionais.md`.

O modo `NODE_ENV=production` exige `APP_ORIGIN`, cookies seguros e não cria dados de demonstração em banco vazio; o provisionamento de oficinas/usuários de produção ainda será implementado. Não exponha o banco de demonstração como ambiente de produção.

## Dados reais, despesas e compartilhamento

Veja `docs/05-dados-reais-financeiro.md` para reconciliação e pendências dos arquivos.

- 231 OS históricas, 119 clientes, 143 veículos e 832 itens de catálogo.
- Contas a pagar em `/financeiro`, recebíveis em `/financeiro/receber` e caixa em `/financeiro/caixa`.
- 29 gastos importados no planejamento; gerar o mês correto cria contas em aberto sem duplicação. Valores variáveis ausentes permanecem a informar.
- Taxas Inter de débito e crédito em até 12 parcelas, com repasse opcional calculado pela taxa real e juros adicionais separados.
- Botão WhatsApp na visualização da OS/orçamento. Links aleatórios, revogáveis e com validade de 30 dias, sem custos internos nem dados pessoais completos na resposta pública.
- O endereço externo exige publicação e `PUBLIC_ORIGIN=https://seu-dominio` no servidor. Não foi publicado nesta etapa. Enquanto isso, o diálogo permite visualizar a página local e sinaliza a limitação antes de enviar.
- A chave de consulta de placa continua somente no servidor e não foi modificada.
