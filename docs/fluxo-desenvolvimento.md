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

O serviço PostgreSQL do workflow é isolado por execução e descartado pelo GitHub Actions. O workflow aplica as migrações e cria as duas oficinas fictícias exigidas pelas integrações; as credenciais randômicas do seed ficam somente no workspace efêmero do runner e nunca são impressas. Não armazena credenciais em arquivos versionados nem exige arquivos `.env` do computador. O preparo recusa execução fora do GitHub Actions, fora de loopback ou sobre banco/roles preexistentes. O job não configura produção, homologação, Vercel ou Supabase.

## Alterações de interface e referência visual

- Antes de mudar uma interface, consulte docs/mapeamento-visual/README.md, INDEX.md e CHECKLIST.md.
- Atualize capturas apenas para o módulo afetado (npm run visual:capture -- --module <id>) ou para os módulos detectados pelos arquivos alterados (npm run visual:capture -- --affected); evite refazer o acervo inteiro sem necessidade.
- A automação autentica somente com os usuários fictícios criados pelo seed local de teste e recusa alvos fora de loopback. Em CI, o PostgreSQL 17 do job é descartável; não usa Supabase ou Vercel.
- Inclua imagens reais geradas, metadados e índices no mesmo PR da interface. Depois rode npm run visual:index e npm run visual:check. O workflow captura as telas atuais em artefato temporário e testa navegação, pesquisa, filtros, imagem protegida, zoom, navegação entre imagens e layout mobile; ele não faz commit automático e não cria loops de CI.
- A galeria do produto fica em /biblioteca-visual, protegida pela sessão da oficina e pelo perfil administrador. Imagens não são servidas de public/.
- Registre no relatório final se o mapeamento foi atualizado, os módulos, imagens criadas/substituídas, capturas ainda pendentes e resultado dos testes visuais.
