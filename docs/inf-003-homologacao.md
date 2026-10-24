# INF-003 — Ambiente online de homologação

O ambiente de homologação é independente da produção:

- Vercel: `sistema-oficinas-homologacao`
- Supabase: `sistema-oficinas-homologacao` (`vnclahdnirqlcbamodqy`)
- Branch Git: `sistema-oficinas-homologacao`
- Acesso: `https://sistema-oficinas-homologacao.vercel.app`
- Painel central: `https://sistema-oficinas-homologacao.vercel.app/admin`

Use somente as contas e registros fictícios deste ambiente. Não copie cadastros operacionais da Horse Power. Consultas externas pagas ficam desativadas.

## Contas fictícias

As credenciais são geradas aleatoriamente e ficam somente no arquivo local ignorado pelo Git `data/homologation-credentials.json`, com permissões restritas à conta atual do Windows. Abra esse arquivo localmente para consultar a senha da conta administrativa (`admin@plataforma.local`) e as contas das oficinas fictícias. Não anexe nem compartilhe o arquivo.

O login administrativo continua exigindo senha e TOTP. Para obter um código temporário no computador local, execute:

```powershell
npm.cmd run admin:totp:homologation
```

Esse comando lê o segredo TOTP do arquivo local e exibe somente o código atual. Não há endpoint para consultar credenciais ou contornar MFA.

## Publicação e isolamento

O projeto Vercel de homologação tem suas próprias variáveis criptografadas e utiliza papéis PostgreSQL distintos: `horse_power_app` para operações da oficina e `hp_platform_admin_app` para o schema `platform_admin`. O papel administrativo não possui acesso aos schemas operacionais. O banco usa conexão Supabase compartilhada em modo transaction pooler com TLS.

O projeto Supabase antigo `HPDesenvolvimento` permanece pausado e pode ser restaurado. O banco de produção `cbdwgocofigrdigfgwkp`, a branch `main` e o projeto Vercel `horse-power` não fazem parte da publicação desta branch.
