# Decisões de arquitetura e operação

Este documento consolida as decisões vigentes acordadas para desenvolvimento. Uma mudança requer decisão explícita e registro de atualização.

## Código e colaboração

1. `horsepowerlondrina-arch/sistemaoficinas` é a fonte oficial de código; `main` é a branch de integração.
2. `horse-power` é repositório histórico. Mudanças novas não são feitas nele sem decisão explícita.
3. Cada tarefa trabalha em branch própria derivada da versão atualizada de `main`; a integração ocorre por PR.
4. Até dois Codex podem implementar simultaneamente tarefas independentes, cada um em branch e ambiente isolado (worktree próprio ou execução remota independente), sem modificar o mesmo diretório. Antes de iniciar, ambos verificam a `main` atualizada e evitam arquivos, configurações, migrações e fluxos compartilhados. O planejamento funcional fica nas conversas específicas do ChatGPT; Codex executa o escopo aprovado.
5. A solicitação de implementação do responsável autoriza, dentro do escopo pedido, branch, desenvolvimento, testes, PR, integração após CI obrigatório aprovado e proteções satisfeitas, e publicação automática na homologação. Não se pede autorização rotineira adicional para essas etapas. Migrações/alterações persistentes remotas, operações destrutivas, mudanças sensíveis de credenciais, segredos, autenticação ou permissões, produção e ações fora do escopo exigem autorização específica.

6. Cada tarefa mantém PR e testes próprios. Integrações na `main` são coordenadas e sequenciais. Se outro PR entrar primeiro, o PR remanescente verifica conflitos, atualiza a branch com segurança e repete testes invalidados. Depois do deployment correspondente, confirma que seu commit está presente na homologação. Capturas visuais compartilhadas exigem coordenação para não sobrescrever imagens/índices recentes.

## Ambientes

- Desenvolvimento local utiliza PostgreSQL e exclusivamente dados fictícios. O computador local é uma opção de desenvolvimento; não é requisito para versionar ou executar CI.
- CI usa banco PostgreSQL 17 temporário e isolado por execução. CI não deve conectar a Supabase, Vercel ou dados de produção/homologação.
- O projeto Vercel `sistema-oficinas-homologacao` e o Supabase identificado pelo projeto `vnclahdnirqlcbamodqy` são tratados como homologação conforme o registro atual. Confirmar referências antes de ações; não inferir que outros projetos sejam produção.
- Produção, se/onde configurada, é ambiente separado. Identidade, domínio ou target “production” exibido pela Vercel não basta para classificar o uso do sistema.

## Segurança e oficinas

- Toda operação de dados de oficina deriva o tenant da identidade/sessão validada no servidor. Um `tenant_id` enviado pelo navegador não é autoridade.
- Isolamento entre oficinas é obrigatório em consultas, escrita, chaves e documentos. Testes devem cobrir tentativas cruzadas.
- A administração central usa autenticação, sessão e permissões próprias; não deve ganhar acesso operacional irrestrito às oficinas.
- Testes, demonstrações e validações utilizam apenas dados fictícios. Credenciais, sessões, tokens e segredos não entram no Git nem em logs.

## Dados e banco

- Preservar dados existentes e históricos. Não apagar/recriar bancos para simplificar testes ou implantação.
- Preferir migrações aditivas, compatíveis e revisáveis. Operações destrutivas ou que possam remover/reatribuir dados exigem análise explícita e plano de recuperação.
- Não alterar banco de produção. Migrações em qualquer Supabase remoto exigem revisão do SQL, identificação inequívoca do ambiente, impacto/recuperação documentados e autorização específica antes da execução. Alterações em bancos remotos persistentes são sempre sequenciais, mesmo com duas tarefas em andamento.
- Dados financeiros e documentos emitidos devem manter precisão, vínculos e snapshots históricos; não reconstruir história com configuração atual.

## Qualidade e liberação

- Antes da integração: revisar diff e segredos, executar `npm run build`, `npm test` e `npm run test:postgres` quando definidos/aplicáveis; resolver falhas ou registrar bloqueio externo.
- CI obrigatório deve passar antes da integração. Revisões e aprovações que as proteções de branch ou a plataforma tornem obrigatórias continuam válidas; não podem ser contornadas.
- A solicitação da tarefa autoriza a publicação automática e a validação na homologação dentro do escopo. Migrações remotas e alterações persistentes exigem autorização específica e devem ser aprovadas antes da aplicação.
- Produção não pode ser modificada, migrada ou publicada sem autorização explícita para a operação concreta.

## Planejamento

Decisões funcionais, escopo e prioridade são definidos nas conversas de planejamento correspondentes do ChatGPT. Registrar decisões técnicas neste arquivo e tarefas/estado em `docs/GESTAO-PROJETO.md` e `docs/ESTADO-ATUAL.md`. Não tratar a existência de uma sugestão como aprovação de implementação.
