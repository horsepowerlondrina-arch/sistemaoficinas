# Planejamento mensal automático

Destino exclusivo: homologação OSDrive, Supabase vnclahdnirqlcbamodqy e Vercel sistema-oficinas-homologacao. Horse Power definitiva fora do escopo.

## Migração e ativação (exigem autorização específica)

Aplicar a migração 20261115030000_monthly_expenses somente após testes e aprovação. Ela permite valor desconhecido em contas não pagas; os valores, estados e pagamentos existentes são preservados. O mês de geração das contas antigas é inferido do vencimento atual, pois o histórico não armazenava outro mês. Contas antigas já remarcadas devem ser conferidas antes da ativação. A referência passa a ser imutável; remarcar uma conta não autoriza nova geração da mesma competência.

A função de geração não concede acesso adicional à aplicação e não aceita IDs de oficina ou SQL externo. Executar exclusivamente pelo agendador do banco, sem autenticação pública. Habilitar pg_cron se necessário e, após autorização, agendar:

```sql
select cron.schedule('osdrive-monthly-expenses', '5 3 * * *', 'select horse_power.generate_current_expenses()');
```

Roda diariamente às 00:05 de São Paulo (03:05 UTC), gerando o mês inteiro no dia 1 e repetindo com idempotência para recuperar falhas. Apenas gastos ativos de oficinas com Financeiro habilitado são gerados. Não confirma pagamentos nem gera meses retroativos. Novos cadastros geram imediatamente o mês corrente por transação autenticada. Ao editar, gera a competência corrente com a configuração anterior antes de modificar o modelo, preservando contas; ao reativar, gera se ainda não existe.

## Conferência e recuperação

Conferir schema, job ativo em cron.job e sucesso em cron.job_run_details. Acompanhar quantidade de contas geradas sem consultar descrições reais. Não disparar a função manualmente em banco persistente como teste. As próximas execuções reais criam contas em aberto conforme os cadastros existentes.

Para interromper próximas gerações sem apagar contas: `select cron.unschedule('osdrive-monthly-expenses')`. Em caso de falha de aplicativo, preservar o schema aditivo e o deployment anterior; não reverter nullable enquanto existirem contas sem valor. Reaplicar a rotina é seguro por mês/oficina/modelo. A função não envia dinheiro nem altera recebimentos.
