# Fluxo de desenvolvimento e validação

1. Atualize a referência `main` do GitHub e crie uma branch de tarefa a partir dela.
2. Implemente em uma branch separada, preservando alterações locais existentes.
3. Execute `npm run build` e `npm test` localmente quando o ambiente estiver disponível.
4. Faça commit e push da branch de tarefa; não é necessário ter `.env.local` para versionar.
5. Abra um Pull Request para `main`. O GitHub Actions cria PostgreSQL 17 descartável, gera credenciais aleatórias apenas durante o job, aplica as migrações locais e executa build, testes gerais e `npm run test:postgres`.
6. Corrija falhas na mesma branch. Integre somente após as verificações obrigatórias do PR estarem aprovadas.
7. Quando aplicável, revise e aprove migrações Supabase separadamente antes de aplicar; CI nunca usa Supabase.
8. Publique na homologação somente depois da integração e da autorização de migração/publicação aplicável. Valide com oficinas e dados fictícios.
9. Registre commits, verificações, migrações e validação de homologação.

O serviço PostgreSQL do workflow é isolado por execução e descartado pelo GitHub Actions. Não armazena credenciais em arquivos versionados nem exige arquivos `.env` do computador. O preparo recusa execução fora do GitHub Actions, fora de loopback ou sobre banco/roles preexistentes. O job não configura produção, homologação, Vercel ou Supabase.
