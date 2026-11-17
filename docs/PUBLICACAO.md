# Publicação do Sistema Oficinas

Política vigente desde 16/11/2026 para toda tarefa no repositório oficial. Usar os nomes abaixo nas conversas, PRs e relatórios. Os identificadores técnicos existentes continuam identificando os recursos de cada ambiente.

| Nome | Endereço | Projeto Vercel | Projeto Supabase |
| --- | --- | --- | --- |
| OSDrive Testes | `sistema-oficinas-homologacao.vercel.app` (sem domínio próprio) | `sistema-oficinas-homologacao` | `vnclahdnirqlcbamodqy` |
| OSDrive | `osdrive.com.br` | `osdrive-comercial` | `fbsydwogucicfjwwbtts` |
| Horse Power | `oficinahorsepower.com.br` (site na raiz, sistema em `/sistema`) | `horse-power-definitivo` | `rvlovjpquozbrsszsxwe` |

## Destinos por tipo de mudança

- **Correção ou alteração de algo existente**, inclusive de interface: o Codex publica automaticamente nos três ambientes, em sequência. Confira em cada um o comportamento que já oferece. Se o componente só existir em uma das aplicações, registre a ausência nos demais destinos e preserve o perfil de cada instalação.
- **Funcionalidade nova:** publique automaticamente no OSDrive Testes. Valide o fluxo completo com dados fictícios e registre o resultado. Ao passar, publique no OSDrive. Publique também na Horse Power quando o recurso servir à operação dessa oficina. Exemplos aplicáveis incluem melhorias de OS, estoque e checklists. Cadastro de outras oficinas, painel central, planos e cobranças pertencem ao OSDrive. A Horse Power mantém acesso Premium vitalício e a integração Sky Peças exclusiva.
- Para mudanças mistas, identifique a parte nova e aplique a ela o critério de validação e de utilidade. Documentação sem alteração da aplicação é entregue pelo GitHub.
- A solicitação da tarefa autoriza as publicações de código acima. O Codex executa e acompanha cada etapa na mesma tarefa, inclusive quando deve iniciar o deployment via Vercel. Uma restrição explícita do responsável para determinada tarefa prevalece. Respeite as proteções das ferramentas e branches. Migrações remotas, manipulação de dados persistentes, operações destrutivas e mudanças sensíveis de autenticação, permissões, segredos ou integrações exigem autorização específica.
- O ambiente de testes pode conter trabalho de outros PRs. Confira o diff em relação ao SHA servido por **cada** destino. Leve apenas as alterações validadas e suas dependências. Na Horse Power use a linha de publicação própria, identificada na Vercel (em 16/11/2026, `feat/hp-definitivo-sistema`). Transporte a alteração por PR nessa linha e execute CI também sobre o resultado. Preserve o site, as rotas, extensões, banco e configurações da oficina.

## Publicar com o sistema em uso

1. Registre o projeto, a branch, o SHA e o ID do deployment atendendo ao domínio. Confirme o acesso à versão estável para reversão. Serialize as promoções de cada destino e confira novamente a versão em uso antes de promover.
2. Aguarde build, testes gerais, PostgreSQL 17 descartável e demais verificações obrigatórias do PR. Após publicar no OSDrive Testes, valide o fluxo afetado. Para um bug, reproduza o cenário corrigido. Registre evidência, SHA e resultado antes de promover.
3. Em cada produção, prepare um deployment do SHA selecionado com as configurações daquele projeto, **sem atribuir o domínio** (por exemplo, `vercel deploy --prod --skip-domain`). A versão em uso continua atendendo durante o build. Espere READY e confira os arquivos estáticos e as rotas seguras permitidas no endereço da versão preparada. Se a proteção de origem exigir o domínio final, valide o que for possível antes e complete a conferência logo após a troca. Preserve MFA e as listas de origens autorizadas.
4. Promova o **mesmo deployment já preparado** para o domínio, sem reconstruir, trocar DNS ou desligar o projeto. No OSDrive, confira login da oficina, entrada do painel e resposta da API. Na Horse Power, confira o site na raiz, `/sistema` e a API. Faça verificações de leitura, observe erros do servidor e confirme o SHA efetivamente servido. Só então avance ao próximo destino.
5. Mantenha compatibilidade entre abas já abertas, sessões, API, arquivos estáticos, tarefas agendadas e webhooks durante a troca. Para mudanças de esquema use expansão compatível, migração de dados separada e remoção de estruturas antigas em entrega posterior, depois da janela de reversão. Evite bloqueios longos. Se a versão antiga deixar de funcionar sobre o banco atualizado ou a alteração exigir interrupção, suspenda a promoção e combine recuperação e janela com o responsável.
6. Se o candidato falhar antes da promoção, mantenha a versão atual. Se falhar após a troca, interrompa a sequência, restaure o deployment estável do **mesmo projeto**, confira novamente o domínio e registre o incidente. A reversão da aplicação não desfaz alterações no banco. Registre por destino o SHA, deployment, comportamento verificado e eventuais bloqueios.

Em 16/11/2026, a configuração versionada da `main` tem `git.deploymentEnabled: false`. O agente deve iniciar as publicações autorizadas pela Vercel e confirmar o resultado. Um merge sozinho não executa esta política. A disponibilidade depende também da Vercel, do banco e das integrações. A estratégia evita parada programada nas entregas compatíveis.

Referências operacionais da Vercel: [preparação e promoção](https://vercel.com/docs/deployments/promoting-a-deployment) e [reversão de deployment](https://vercel.com/docs/deployments/instant-rollback).
