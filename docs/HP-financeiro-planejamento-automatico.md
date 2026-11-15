# Horse Power Definitiva — planejamento mensal automático

Porta o Financeiro validado no PR OSDrive #204 para a branch comercial `feat/hp-definitivo-sistema`. O worker da definitiva é independente de planos, cobranças e administração central.

## Destinos

- Vercel: horse-power-definitivo, prj_RJGlxZbbO3Wl4Vm3CdreT60G3FST.
- Supabase: rvlovjpquozbrsszsxwe. Não aplicar esta migração na homologação OSDrive.
- Domínio comercial: https://oficinahorsepower.com.br/sistema/financeiro.

## Migração preparada

20261115194031_hp_monthly_expenses.sql permite valor desconhecido em contas não pagas, exige valor em pagamentos e fixa a competência da geração. Valores, vencimentos, estados e pagamentos existentes não são reescritos. Para contas antigas, a competência é inferida do vencimento atual, pois não era armazenada separadamente; conferir contas que já tenham sido remarcadas antes da ativação.

A rotina SQL não usa platform_admin, assinaturas ou módulos do OSDrive. Cada conta mantém a oficina do próprio gasto; sem grants adicionais para papéis da aplicação. O scheduler usa a função sem parâmetros, não aceita SQL/tenant do navegador e não confirma pagamentos.

## Ativação — autorização específica obrigatória

Antes da migração, conferir o projeto e comparar contagem/hash dos lançamentos anteriores. Coordenar aplicação usando pg_advisory_xact_lock(721834110). Aplicar somente após CI aprovado e autorização do responsável para o banco definitivo e a publicação comercial.

Habilitar pg_cron se necessário, sem alterar credenciais. Agendamento do banco:

```sql
select cron.schedule('horse-power-monthly-expenses', '5 3 * * *', 'select horse_power.generate_current_expenses()');
```

Executa diariamente às 00:05 de São Paulo: gera o mês inteiro no dia 1 e repete sem duplicar para recuperar falhas. A ativação inicial também pode gerar as contas do mês corrente conforme os gastos existentes, somente após autorização. Gastos novos geram imediatamente o mês corrente pela API autenticada. Edições no modelo preservam o lançamento atual e valem para próximos lançamentos; contas em aberto são ajustadas individualmente.

## Recuperação e validação

Interromper gerações futuras: `select cron.unschedule('horse-power-monthly-expenses')`. Preservar as contas geradas; não excluir histórico. Não reverter nullable com contas sem valor existentes. Se houver falha de publicação, preservar o deployment anterior e documentar o estado do job. Validar RLS, ausência de execução da rotina por papéis operacionais, job ativo, implantação READY do SHA correto e domínio atualizado. Não executar testes financeiros reais na produção; testes gravadores usam somente dados fictícios em CI PostgreSQL 17.
