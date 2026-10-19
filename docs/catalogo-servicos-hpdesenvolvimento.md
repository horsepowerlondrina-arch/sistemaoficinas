# Catálogo operacional de serviços — HPDesenvolvimento

Publicado exclusivamente no Supabase `rapvlvstqcqordttqrru`, no schema privado `service_catalog`. Nenhuma migração ou importação foi executada no banco da oficina em produção.

## Conteúdo publicado

Versão `1.2-operacional`: 102 marcas, 14 portes, 7.534 modelos, 928 famílias, 928 bases compartilhadas, 6.491 identificadores de serviços e 836.093 registros de tempos. São 7.292.579 aplicações lógicas entre modelos e serviços, consultadas pelos vínculos de bases e possíveis diferenças por modelo, sem materializar milhões de linhas repetidas.

Não contém peças, quantidades ou histórico técnico de coleta. O catálogo original completo permanece como referência externa. Modelos, portes, códigos FIPE, identificadores, exclusões, serviços, nomes específicos de aplicação e tempos foram preservados. FIPE não é chave única; correspondências ambíguas exigirão confirmação na integração do veículo.

Arquivo operacional validado por SHA-256: `5557e09a16362452e1a5716164e9cc0e13d48a26140c1682ffdc5ae48b0eefaa`.

## Acesso

- As tabelas pertencem ao administrador do banco. O backend `horse_power_app` recebe somente SELECT, sem CREATE, INSERT, UPDATE, DELETE ou gestão de planos nessa área.
- Todas as tabelas possuem RLS habilitada e forçada. O schema não recebe permissões para `PUBLIC`, `anon`, `authenticated` ou `service_role`.
- A consulta exige versão ativa e liberação válida para a oficina atual em `service_catalog.tenant_access`. A condição identifica explicitamente `app.tenant_id`, além da RLS da própria tabela de liberações.
- A integração futura deverá iniciar uma transação e definir `set_config('app.tenant_id', tenantIdDaSessaoAutenticada, true)` nessa mesma transação. Nunca aceitar a oficina do corpo da requisição nem usar um SET persistente em uma conexão compartilhada.
- Sem contexto de oficina, sem liberação, com liberação desabilitada ou vencida, a política não permite consultar o catálogo. O contexto do tenant é definido somente pelo servidor; não há credencial SQL no navegador.
- A oficina `hp-centro` foi liberada apenas para testes de desenvolvimento. Não foi contratada assinatura nem habilitado faturamento. Novas oficinas não recebem liberação automática. Somente a administração da plataforma pode gerenciar liberações, por procedimento administrativo, nunca pelo CRUD do proprietário da oficina.
- Serviços particulares continuam no cadastro existente, separado do catálogo central e vinculado à oficina. Esta importação não copiou serviços particulares para a base compartilhada.

## Publicação e validação

As migrações `20261019215935_service_catalog_operational_structure.sql` e `20261019220654_activate_readonly_service_catalog.sql` registram a estrutura e a ativação. Entre ambas é necessária a importação administrativa do pacote validado: a ativação recusa um catálogo incompleto. A migração `20261019220939_optimize_catalog_tenant_policy.sql` faz a identificação da oficina ser calculada uma vez por consulta, preservando a autorização explícita por tenant. Não executar essas migrações isoladamente em produção como parte de um deploy rotineiro.

A carga utilizou uma credencial específica de importação, sem acesso aos dados de atendimento. Após a validação, suas permissões foram revogadas, o login foi desabilitado, a senha removida e a cópia local da credencial excluída.

Todos os campos operacionais foram comparados entre SQLite e PostgreSQL usando SHA-256 por registro e por grupo ordenado, sem depender apenas de contagens. A primeira tentativa de conferência por transferência integral sofreu timeout; a conferência por hashes calculados no banco foi concluída com sucesso.

Resultados da publicação:

- Banco completo: aproximadamente 240 MB; catálogo com índices: aproximadamente 224 MB. Limite gratuito considerado: 500 MB, deixando cerca de 260 MB para crescimento. O consumo real deve ser acompanhado ao adicionar dados e índices.
- Testes com o backend normal: sem oficina e sem liberação não há leitura; oficina de testes liberada consulta modelos e serviços; INSERT, UPDATE, DELETE e tentativa de autoliberação retornam `42501`.
- Login, leitura do workspace e criação/remoção de um cadastro temporário passaram após a importação. Permanecem 277 OS, 164 veículos e 1.008 itens no cadastro existente.
- Auditoria de segurança do Supabase sem alertas após a ativação.

## Limite desta etapa e próximos passos acordados

Esta publicação disponibiliza os dados no banco e suas proteções. Não adiciona ainda a busca do novo catálogo à interface da OS nem migra ou remove serviços antigos. Não altera OS históricas, preços, estoque, produtos, extensão ou regras atuais de atendimento.

A próxima integração deverá manter o planejamento: serviços separados dos produtos; confirmação do modelo correto sem inferir tempos por marca ou porte; associação persistida no veículo; busca paginada no servidor apenas das aplicações compatíveis; preço por minutos/60 × valor-hora do porte; serviços particulares por oficina; alternância interno/terceirizado na OS; terceiros com custo e acréscimo configurado, inicialmente 30%; cadastro rápido de serviços; tempos ou preço informados de forma consistente; preservação de nome, minutos, porte, valor-hora, custo, acréscimo, preço final e versão do catálogo em cada item da OS. Atualizações de catálogo e perda de assinatura não poderão alterar nem impedir a leitura de OS antigas. Tempos iguais a zero exigirão informação complementar antes da inclusão, sem assumir serviço gratuito.

Peças permanecem fora deste catálogo operacional e não geram produtos ou movimentos de estoque. A retirada da captura de serviços pelo Tempario e a adaptação dos cadastros antigos seguem como etapas próprias do plano, sem afetar a captura de produtos do Sky Peças.
