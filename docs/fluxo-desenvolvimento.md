# Fluxo de desenvolvimento e validação

1. Atualize a referência `main` do GitHub e crie uma branch de tarefa a partir dela.
2. Implemente em uma branch separada, preservando alterações locais existentes.
3. Execute `npm run build` e `npm test` localmente quando o ambiente estiver disponível.
4. Faça commit e push da branch de tarefa; não é necessário ter `.env.local` para versionar.
5. Abra um Pull Request para `main`. O GitHub Actions cria PostgreSQL 17 descartável, gera credenciais aleatórias apenas durante o job, aplica as migrações locais e executa build, testes gerais e `npm run test:postgres`.
6. Corrija falhas na mesma branch e acompanhe as verificações obrigatórias do PR. A solicitação de implementação já autoriza criar o PR e integrar na `main` quando CI estiver aprovado e as proteções/revisões obrigatórias forem satisfeitas; não solicite aprovação rotineira adicional.
7. Siga a [política de publicação](PUBLICACAO.md) para classificar a tarefa, validar e publicar automaticamente nos destinos aplicáveis.
8. Migrações remotas, alterações de dados persistentes, ações destrutivas e mudanças sensíveis de credenciais, autenticação ou permissões continuam exigindo autorização específica. CI usa PostgreSQL 17 descartável.
9. Registre commits, verificações, efeitos de banco, deployment, validação e limitações. Respeite proteções e confirmações obrigatórias da plataforma; não as contorne.

O serviço PostgreSQL do workflow é isolado por execução e descartado pelo GitHub Actions. O workflow aplica as migrações e cria as duas oficinas fictícias exigidas pelas integrações; as credenciais randômicas do seed ficam somente no workspace efêmero do runner e nunca são impressas. Não armazena credenciais em arquivos versionados nem exige arquivos `.env` do computador. O preparo recusa execução fora do GitHub Actions, fora de loopback ou sobre banco/roles preexistentes. O job não configura produção, homologação, Vercel ou Supabase.

## Alterações de interface e referência visual

- Antes de mudar uma interface, consulte docs/mapeamento-visual/README.md, INDEX.md e CHECKLIST.md.
- Atualize capturas apenas para o módulo afetado (npm run visual:capture -- --module <id>) ou para os módulos detectados pelos arquivos alterados (npm run visual:capture -- --affected); evite refazer o acervo inteiro sem necessidade.
- A automação autentica somente com os usuários fictícios criados pelo seed local de teste e recusa alvos fora de loopback. Em CI, o PostgreSQL 17 do job é descartável; não usa Supabase ou Vercel.
- Inclua imagens reais geradas, metadados e índices no mesmo PR da interface. Depois rode npm run visual:index e npm run visual:check. O workflow captura as telas atuais em artefato temporário; ele não faz commit automático e não cria loops de CI.
- Consulte a biblioteca somente na pasta privada docs/mapeamento-visual/ do GitHub. Ela não integra a aplicação da oficina e não deve ser publicada.
- Registre no relatório final se o mapeamento foi atualizado, os módulos, imagens criadas/substituídas, capturas ainda pendentes e resultado dos testes visuais.

## INF-010 — Modalidade local e integração sem publicação imediata (14/11/2026)

O desenvolvimento Linux pode usar o Supabase de homologação com conexões restritas e MFA existentes, sem instalar PostgreSQL. GitHub Actions continua no PostgreSQL 17 temporário, sem banco remoto. Duas execuções usam branches, diretórios, portas, perfis de navegador e oficinas fictícias independentes; manutenção remota é sequencial.

O modo consolidado da INF-010 é histórico. Com eventos Git pausados, o agente inicia os deployments previstos na política vigente e registra separadamente o SHA integrado e o publicado.
