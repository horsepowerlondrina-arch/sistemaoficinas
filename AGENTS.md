# AGENTS.md — Sistema Oficinas

Estas instruções se aplicam a todo o repositório, salvo instruções mais específicas em subdiretórios que não as contradigam.

## Repositório e colaboração

- Para novas funcionalidades, trabalhe exclusivamente em `horsepowerlondrina-arch/sistemaoficinas`. O repositório `horsepowerlondrina-arch/horse-power` é histórico e contém o sistema Horse Power em produção; não o altere como parte de tarefas deste projeto.
- Use GitHub como fonte da versão atual. Antes de implementar, confira a `main`, as branches existentes, a branch de trabalho e o estado dos arquivos quando houver checkout. Não suponha que uma branch antiga esteja atualizada.
- Crie uma branch específica a partir da `main` atualizada. Não trabalhe diretamente na `main`; integre por Pull Request.
- Respeite o acordo de um único Codex implementando no repositório por vez. Se houver outra implementação ativa que possa tocar os mesmos arquivos ou branches, não faça alterações concorrentes.
- Mantenha o escopo aprovado. Preserve mudanças existentes, histórico, funcionalidades, dados e configurações; não descarte trabalho nem amplie a tarefa sem necessidade.
- Planejamento funcional e prioridades pertencem às conversas de planejamento do ChatGPT. Execute a tarefa aprovada e registre decisões técnicas no local apropriado.

## Fluxo de desenvolvimento

1. Consulte estas instruções, a documentação pertinente e o estado atual da `main`.
2. Crie uma branch específica e faça alterações pequenas e revisáveis.
3. Prefira GitHub, GitHub Actions e as integrações existentes de Vercel e Supabase. O computador do usuário, um checkout local, PostgreSQL local, worktree local ou arquivos `.env.local` não são pré-requisitos para implementar, versionar ou validar uma alteração.
4. Não solicite nem copie credenciais para o chat, código, commits, artifacts ou logs. Use apenas os mecanismos de autenticação já conectados e peça ao usuário que digite segredos diretamente em um prompt seguro quando isso for indispensável.
5. Revise o diff completo, caminhos staged, arquivos gerados e conteúdo sensível antes de abrir o PR.
6. Faça commit e push somente da branch da tarefa. Abra PR para `main`, acompanhe as verificações e corrija falhas reais na mesma branch.
7. Integre somente quando os controles aplicáveis e a aprovação exigida para a operação estiverem atendidos. Não ignore proteção ou revisão obrigatória.
8. Quando autorizado e aplicável, publique somente no projeto/ambiente de homologação identificado para a tarefa e valide o deployment. Registre o resultado e as limitações com evidências.

Resolva problemas técnicos rotineiros dentro do escopo e continue o trabalho independente de um bloqueio parcial. Não contorne controles de acesso, proteções de branch, falhas de teste ou autorizações necessárias. Se uma etapa depender de uma decisão humana ou acesso indisponível, complete tudo que não dependa dela, registre o bloqueio exato e pare somente a etapa afetada.

## Testes e dados

- Use GitHub Actions com PostgreSQL 17 temporário, isolado por execução, para build e testes de integração PostgreSQL. O ambiente de CI usa somente migrações locais e dados fictícios; nunca conecte CI a Supabase, Vercel ou bancos persistentes.
- Para alterações de backend aplicáveis, execute e confira `npm run build`, `npm test` e `npm run test:postgres` no workflow existente ou em workflow equivalente. Não declare um teste aprovado sem evidência do run correspondente ao commit/PR.
- Não exija banco PostgreSQL local, arquivos `.env.local` ou configuração do computador para versionar e validar o trabalho.
- Use somente dados fictícios em testes e demonstrações. Nunca use produção para teste.
- Não acrescente segredos, tokens, frases secretas, cookies, dados pessoais ou dumps de banco ao GitHub ou aos logs.

## Operações remotas e ambientes

- Confirme a identidade do projeto e ambiente antes de consultar ou alterar Vercel ou Supabase. O projeto atualmente registrado para homologação é Vercel `sistema-oficinas-homologacao` e Supabase `vnclahdnirqlcbamodqy`; revalide esses destinos antes de cada operação.
- Produção é separada da homologação. Nunca testar, migrar, importar, substituir dados, mudar permissões ou publicar em produção sem autorização explícita para a operação concreta.
- Migrações remotas, alterações de configuração persistente, escrita de dados e publicação que ainda não tenham autorização requerem autorização específica. Antes de pedir aprovação, revise o SQL/impacto, destino, compatibilidade, rollback/recuperação e evidências de teste.
- Não altere variáveis de ambiente, domínios, integrações Git ou configurações da Vercel como parte incidental de uma tarefa.
- Para operações autorizadas, limite as alterações ao ambiente identificado e verifique o resultado sem expor valores de segredo.
- Diferencie deployment pronto de funcionalidade verificada. Para validar um fluxo online, registre URL/ambiente, commit, endpoint ou ação e resultado observado; se autenticação, sessão ou acesso impedir o teste, diga isso claramente.

## Segurança, permissões e isolamento

- Todo acesso operacional deriva da oficina e identidade autenticadas no servidor. Nunca confie em `tenant_id` recebido do navegador para conceder acesso.
- Preserve isolamento entre oficinas em consultas, gravações, arquivos, documentos, links públicos, filas e relatórios. Inclua testes negativos de acesso cruzado quando houver impacto multi-oficina.
- Preserve autenticação, MFA quando configurado, sessões, permissões administrativas, RLS, auditoria e segregação de funções. Não introduza bypass, grants amplos ou contas/vínculos artificiais para contornar uma falha.
- O Painel Administrativo Central não recebe acesso irrestrito aos dados operacionais. Use escopos explícitos e privilégios mínimos.
- Prefira migrações aditivas e compatíveis. Não apague ou recrie bancos, não remova dados e não altere histórico para simplificar a implementação. Para operações potencialmente destrutivas, exija autorização, prévia, backup recuperável e plano de restauração.
- Mantenha snapshots e vínculos históricos de documentos, valores financeiros em precisão exata e autoria rastreável. Não reconstrua documentos antigos com configurações atuais.

## Importações de grande volume

Para CAT-008 ou outras cargas grandes, não dependa do computador do usuário, de uma única requisição HTTP, nem de inserir registros um a um sem controle de volume. Escolha e documente um mecanismo compatível com limites atuais do Supabase e da aplicação, como carga em lotes no servidor ou job controlado, com:

- lotes limitados e parametrizáveis, transações de tamanho seguro e progresso observável sem dados sensíveis;
- idempotência, retomada após falha, validação de schema e contagens/hash de integridade;
- dados de origem e destino identificados, sem sobrescrever registros fora do escopo;
- ensaio com dados fictícios, limites de tempo/tamanho avaliados e plano de interrupção/recuperação;
- autorização específica antes de qualquer carga em banco remoto persistente.

Não faça importação real como parte de testes automatizados.

## Mapeamento visual de interfaces

- A biblioteca visual oficial fica em docs/mapeamento-visual/; consulte README.md, INDEX.md e CHECKLIST.md antes de alterar interfaces.
- Quando uma tarefa modificar a interface, identifique as interações afetadas e atualize suas capturas no mesmo PR: use npm run visual:capture -- --module <id> ou npm run visual:capture -- --affected. Inclua os PNGs e execute npm run visual:index e npm run visual:check.
- Use somente sessões e dados fictícios em ambiente local de teste ou no PostgreSQL 17 descartável do GitHub Actions. A automação recusa URLs fora de loopback e não pode gravar no Supabase de homologação ou em produção.
- Uma tela só está capturada quando o PNG existe e seu estado está como capturada; informe data e commit. Registre motivo nas entradas pendentes ou bloqueadas. Não crie telas ou imagens simuladas para funcionalidades inexistentes.
- A biblioteca visual é somente a pasta privada docs/mapeamento-visual/ no GitHub. Não adicione galeria, rota, API ou imagens públicas à aplicação da oficina.
- No relatório final de tarefas de interface, informe: mapeamento atualizado (sim/não), módulos afetados, imagens criadas/substituídas, capturas pendentes e resultado dos testes visuais.

## Relato de conclusão

Ao encerrar uma tarefa, informe de forma concisa e verificável:

- identificador e objetivo, branch, commit e PR;
- arquivos alterados e decisões relevantes;
- comandos/workflows executados, resultado e link do CI;
- migrações e efeitos remotos, com ambiente explicitamente identificado;
- deployment e validação funcional, quando aplicável;
- problemas conhecidos, riscos, limitações e etapas bloqueadas.

Diferencie claramente: implementado, testado, integrado, publicado, validado online e planejado. Não afirme resultados que não foram observados.

## Documentação de referência

Consulte e mantenha coerência com:

- `docs/GESTAO-PROJETO.md` — módulos, estados e registros de tarefas;
- `docs/DECISOES-ARQUITETURA.md` — decisões de arquitetura, ambientes e autorizações;
- `docs/ESTADO-ATUAL.md` — inventário datado das evidências atuais;
- `docs/fluxo-desenvolvimento.md` — CI e fluxo de PR.

Esses documentos podem conter registros históricos ou estado desatualizado. Verifique datas e referências antes de usá-los como evidência atual. Não altere sua auditoria ou inventário ao atualizar estas instruções, salvo se a tarefa também autorizar essa documentação.
