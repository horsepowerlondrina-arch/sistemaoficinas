# OPS-002 — Máquinas de cartão

## Comportamento

Configurações → Taxas e parcelamento permite cadastrar, editar, ativar/desativar máquinas e selecionar uma única padrão. Nome é único na oficina inclusive entre desativadas. Operadora é informativa. Nenhuma máquina é apagada pela aplicação.

Taxas são percentuais totais por operação, em pontos-base inteiros. Campo vazio significa modalidade indisponível; zero é taxa explicitamente cadastrada. Crédito suporta 1–24 parcelas conforme o limite da máquina; débito apenas 1. Reduzir o limite remove somente taxas futuras acima dele, não registros históricos.

Recebimentos simples e divididos sugerem a padrão e permitem selecionar outra ativa. O servidor valida oficina, estado, modalidade, parcelas e taxa. Taxa divergente após atualização exige nova revisão do recebimento. Repasse começa desligado e usa aritmética inteira para preservar o líquido após arredondamento. Cada parcela nova guarda identificação/nome/operadora, taxa, repasse e número de parcelas, junto aos valores existentes. Alterar/desativar máquinas não recalcula planos já salvos; reconfigurá-los exige uma máquina válida. Planos recebidos continuam imutáveis.

Permissões atuais preservadas: recebimentos são exclusivos de owner com Financeiro habilitado; administrar máquinas exige também Configurações. RLS deriva a oficina do contexto validado pelo backend. A administração central não recebe acesso operacional adicional.

## Migração e liberação

- SQLite: `server/db/migrations/031-card-machines.sql`.
- PostgreSQL descartável: `local-postgres/029-card-machines.sql`.
- Homologação, somente após autorização específica: `supabase/migrations/20261101123801_ops_002_card_machines.sql`.
- Backfill cria uma máquina legada por oficina que já possui taxas. Taxas por parcela têm precedência sobre os padrões de débito/crédito 1x. Não inventa taxas para parcelas sem cadastro. Taxa antiga de 100% fica preservada na tabela original, mas indisponível na nova máquina por inviabilizar repasse.
- Juros padrão continuam preservados e editáveis; são sugeridos para boleto parcelado. Cartão inicia sem juros e sem repasse; alterações explícitas de juros permanecem disponíveis no recebimento.
- Recebimentos históricos não são atualizados: máquina/taxa desconhecidas permanecem nulas, valores existentes intactos.
- Aplicar uma vez via histórico de migrações, em transação, antes de publicar o código. Não executar manualmente duas vezes. Não existem migrações automáticas remotas no runtime.
- Recuperação: rollback da transação se a aplicação falhar. Depois de uso, preferir correção aditiva; não remover tabelas/colunas com histórico. Código anterior pode operar sobre as tabelas originais, mas não administra as novas taxas; evitar rollback operacional após novos recebimentos sem análise.
- Migração remota, merge e publicação aguardam autorização conforme a solicitação OPS-002. Nenhum dado persistente remoto foi alterado.

Pacotes de transferência incluem máquinas e taxas e remapeiam os vínculos das parcelas. A mesclagem bloqueia conflitos de máquina padrão; a substituição utiliza o fluxo existente de backup e autorização. Pacotes legados continuam preservando suas taxas originais; quando não trazem máquinas, cadastre-as antes de configurar novos recebimentos.

## Verificação

`tests/cardMachines.test.ts` cobre cálculos, snapshots, isolamento, campos ausentes, taxa desatualizada e permissões de APIs. `tests/cardMachines.postgres.integration.ts` verifica backfill, precedência, histórico e RLS em PostgreSQL temporário. Regressões de caixa, pagamentos mistos, crédito, descontos e relatórios são mantidas.

`capture-card-machines.mjs` valida seleção padrão, troca de máquina, modalidade sem taxa, repasse, edição/salvamento e descarte de rascunho, com dados fictícios e URLs loopback. Salva um plano de três parcelas no PostgreSQL descartável, confere máquina/taxa/repasse e líquido de R$ 100,00, e reabre a edição. `ops002-visual-cleanup.ts` remove somente as OS e o produto criados pela captura, após verificar oficina, identificação da fixture e ausência de pagamentos recebidos. A biblioteca permanece exclusivamente em `docs/mapeamento-visual/` no GitHub privado.

Validação local: build e 299 testes gerais aprovados. O CI executa as mesmas verificações, capturas desktop/mobile, migração, RLS e integrações no PostgreSQL 17 temporário. As evidências e o resultado final ficam vinculados ao PR #82.
