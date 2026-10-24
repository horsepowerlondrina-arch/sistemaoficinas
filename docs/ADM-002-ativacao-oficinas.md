# ADM-002 — Ativação e teste grátis

## Fluxo

1. Um administrador com `workshops:manage` cadastra a oficina no painel central. O cadastro permanece pendente e não cria usuário, associação operacional ou sessão.
2. O servidor cria um convite aleatório válido por 72 horas. O banco guarda apenas o hash SHA-256 do token. O token é enviado por e-mail e aparece somente no fragmento do link; não é gravado em auditoria nem devolvido ao painel.
3. O responsável abre `/ativar-oficina`, confere o nome da oficina e confirma o convite. Uma conta nova define uma senha de pelo menos 12 caracteres. Se o e-mail já tiver uma conta operacional, a senha e demais associações são preservadas; a oficina convidada recebe apenas a associação `owner`.
4. A confirmação consome o convite uma única vez, registra auditoria, confirma o e-mail e inicia o período de 14 dias. A conta nova recebe uma sessão operacional apenas para a oficina ativada; uma conta existente entra usando sua senha atual.

Alterar o e-mail responsável revoga convites abertos. Reenviar cria novo token e revoga os anteriores. Apenas oficinas administradas e ainda pendentes podem receber convite. Oficinas legadas e ativas não são alteradas.

## Configuração de e-mail

Configure apenas no ambiente do servidor, sem incluir os valores no Git:

- `RESEND_API_KEY`: chave de API do Resend.
- `WORKSHOP_ACTIVATION_FROM`: remetente pertencente a um domínio verificado pelo provedor.
- `APP_ORIGIN`: origem HTTPS do Sistema Oficinas usada para compor o link.

O ambiente de homologação deve ter suas próprias variáveis. Se o envio falhar, o cadastro permanece pendente, o painel indica falha e permite reenviar. A resposta e a auditoria não incluem a chave, o token ou o conteúdo retornado pelo provedor.

## Banco e publicação

A migração `supabase/migrations/20261024100000_workshop_activation.sql` cria a tabela de convites com RLS e funções `SECURITY DEFINER` estreitas para validar e consumir tokens. `local-postgres/010-workshop-activation.sql` é a versão local correspondente. O papel administrativo recebe apenas o acesso à tabela de convites e a execução dessas funções; o processo administrativo não recebe acesso direto às tabelas operacionais.

Antes de publicar o novo código na homologação, a migração precisa ser aplicada ao projeto Supabase de homologação. Ela ainda não foi executada remotamente. O código da lista de oficinas depende da tabela nova; portanto, não faça merge/publicação antes da migração aprovada e aplicada. A aplicação da migração remota exige autorização específica do responsável.

## Validação local

Após revisar a migração e ter o PostgreSQL local configurado:

```powershell
npm.cmd run db:local:migrate
npm.cmd run build
npm.cmd test
npm.cmd run test:postgres
```

Os testes de ativação criam schemas temporários com nomes aleatórios, usam somente endereços `example.test` e removem os schemas ao terminar. Não enviam e-mails.
