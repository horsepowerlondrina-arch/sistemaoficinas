# Restauração operacional da Horse Power definitiva

Destino exclusivo: Supabase vazio `rvlovjpquozbrsszsxwe`. Origem exclusiva: backup criptografado da Horse Power Car Service, oficina `59c85eea-7112-40de-b77f-c5627c541b48`, guardado na homologação `vnclahdnirqlcbamodqy`. O arquivo aprovado tem 9.320.665 bytes e SHA-256 `f0c8a897919c61dd912a711c0c6d9ac6149638c9a423d3c1da22aa76592154a1`. Há outra cópia privada no Drive. Não usar o banco histórico.

O pacote excede o limite de 4 MiB da Function Vercel, portanto a restauração não usa upload HTTP. O workflow manual lê somente esse pacote e os dados do único proprietário por uma função PostgreSQL temporária com escopo fixo. A senha em texto nunca é lida: transfere-se somente seu hash scrypt. Sessões, tokens, permissões administrativas e dados de outras oficinas não são transferidos.

## Preparação e autorização

1. Conferir que a origem ainda tem exatamente um proprietário, que o backup não expirou, que seu SHA-256 confere e que o destino continua sem oficinas, usuários ou vínculos.
2. Aprovar especificamente as duas rotinas SQL em `ops/horse-power-definitive-restore/source.sql` e `target.sql`. Elas criam logins temporários inicialmente sem acesso, uma função de leitura limitada ao backup aprovado e uma função de provisionamento que só opera no destino vazio. O usuário do destino herda o papel operacional com RLS, sem bypass ou superusuário.
3. Definir senhas fortes diretamente no Supabase para `hp_restore_source_login` e `hp_restore_target_login`; habilitar LOGIN somente após essa configuração.
4. Criar o ambiente GitHub Actions `horse-power-operational-restore`, limitado à branch `infra/horse-power-definitive-restore-ci`. Inserir ali, diretamente no GitHub, `HP_RESTORE_SOURCE_PASSWORD`, `HP_RESTORE_TARGET_PASSWORD` e `HP_RESTORE_PASSPHRASE`. Nunca incluir valores em chat, commits, artifacts ou logs.
5. Executar o workflow primeiro com `preflight-only`. Essa operação lê, descriptografa e confere o pacote em memória do runner; não grava no destino. Conferir contagens, formato, identidade e integridade. Comparar as contagens com a origem atual e pausar a operação da Horse Power antes do corte para evitar perda de alterações posteriores ao backup.
6. Executar `restore-definitive` apenas com prévia aprovada e origem congelada. O provisionamento da única oficina, do proprietário existente e do plano Premium vitalício, seguido da importação em modo Oficina vazia, ocorre em uma transação. Qualquer falha reverte a transação. O workflow não cria deployment nem altera DNS.
7. Validar no destino quantidades, chaves, vínculos, valores históricos, documentos, perfil da oficina e plano. Conferir que a origem continua intacta. Depois desabilitar os dois logins temporários, revogar as funções e excluir os três segredos do GitHub.
8. Configurar a conexão permanente da aplicação no projeto Vercel definitivo e validar o acesso por URL protegida antes de vincular `oficinahorsepower.com.br`. Publicação comercial e mudança de domínio exigem autorização separada.

A importação existente não transporta sessões, links públicos ativos ou eventos históricos de auditoria da origem. Os links deverão ser recriados, e a auditoria da restauração ficará no destino. Os documentos e dados operacionais do pacote são preservados conforme o contrato `.hptx`. O catálogo técnico global já foi carregado separadamente e não faz parte deste pacote.

Após a restauração, a oficina fica em `active` com plano `premium` e política ativada, sem prazo de teste ou cobrança Stripe. O aplicativo definitivo exclui as rotas de administração central e cobrança. A chave FipePlaca e outras integrações externas precisam de configuração separada no projeto Vercel definitivo.
