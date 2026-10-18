# HPDesenvolvimento

Ambiente independente de testes, iniciado a partir da main 1628c0ea12de50b8e7c1b824aa4400653983de32.

- Banco Supabase separado: rapvlvstqcqordttqrru, organização Horse Power.
- Aplicação Vercel separada: hpdesenvolvimento.
- Endereço: https://hpdesenvolvimento.vercel.app.
- Código de desenvolvimento na branch HPDesenvolvimento; não publicar essa branch no projeto de produção.
- Cópia dos dados operacionais de hp-centro, sem senhas de produção, sessões, ativações, conexões de extensão ou links públicos existentes. Assinaturas e fotos dos checklists não foram copiadas.
- Consultas externas pagas ficam desativadas até configuração específica para testes.
- Credenciais do banco são exclusivas e ficam nas variáveis protegidas da hospedagem.
- A trava de inicialização recusa banco e origens fora do ambiente de testes.

Alterações de dados neste ambiente não são sincronizadas com produção. Após homologar uma funcionalidade, transferir somente os commits funcionais e migrações revisadas; não substituir o banco em uso pelo banco de testes, nem levar esta configuração exclusiva para a main.

Para atualizar a cópia de dados, fazer nova captura consistente da produção e conferir vínculos, contagens e totais em destino isolado. Nunca restaurar uma cópia antiga sobre produção.
