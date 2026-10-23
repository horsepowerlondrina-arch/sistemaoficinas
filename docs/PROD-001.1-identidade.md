# PROD-001.1 — Identidade do software e das oficinas

## Entrega local

Branch: `prod-001-1-identidade`, criada a partir de `postgres-local`.
As alterações PostgreSQL anteriores estavam sem commit e foram preservadas.
Não houve push, publicação, acesso Supabase, importação de catálogo nem alteração
em main ou HPDesenvolvimento.

A instalação deste computador é PostgreSQL 18.6, aprovada e configurada na etapa
anterior. Esta tarefa não trocou sua versão nem recriou o banco.

## Comportamento

- Identificação provisória descritiva: **Sistema Oficinas**, sem adoção de Boxmotor
  ou de qualquer nome comercial definitivo.
- Login, carregamento, ativação e favicon usam marca neutra própria, criada em SVG.
  A fotografia e as logos da Horse Power não são usadas nessas telas.
- A barra lateral destaca nome e document_logo da oficina retornada na sessão.
  Sem imagem ou com falha ao carregá-la, usa monograma neutro e mantém o nome.
- O rodapé da barra lateral mostra o software em tamanho menor. A navegação
  tem rolagem própria para preservar o rodapé e a identidade no celular.
- Salvar Dados da oficina atualiza a sessão e a barra lateral imediatamente.
  O componente é identificado pela oficina, sem cache global de logos.
- A aba mostra nome da oficina + Sistema Oficinas; ao sair, volta ao título
  neutro. O favicon é neutro e não guarda a logo de outra oficina.
- Links públicos mantêm o cabeçalho da oficina correspondente e passam a usar
  seu nome no título quando carregados.
- Orçamentos, OS e checklists continuam usando o DocumentHeader existente,
  sem substituir a marca cadastrada pela identidade da plataforma.
- Textos fixos de Início, Dashboard, Despesas, configurações e nomes de arquivos
  exportados foram neutralizados.
- O site institucional, a política de privacidade e os arquivos originais da
  Horse Power permanecem preservados. O nome oficial do conector externo para
  Chrome permanece nas instruções de instalação; isso não representa a marca
  padrão do software ou das oficinas. Protocolos da extensão não foram alterados.

## Correção adicional necessária no PostgreSQL local

O novo teste de links públicos identificou a ausência da coluna token_value na
baseline local já aplicada. O backend existente utiliza essa coluna para reutilizar
links. Foi adicionada a migração local **002-public-share-identity.sql**, apenas
com ADD COLUMN IF NOT EXISTS. Nenhum dado ou link existente foi apagado.

O executor local agora descobre migrações numeradas e confere o checksum de
cada uma. A 001-local não foi alterada. Para outra instalação local desta branch:

```powershell
npm.cmd run db:local:migrate
```

Não reaplicar seed nem recriar o banco. Não executar essa pasta de migrações
em Supabase ou em qualquer banco remoto.

## Arquivos desta tarefa

Identidade e navegação:
- shared/platformIdentity.ts
- public/brand/platform.svg
- src/components/PlatformBrand.tsx
- src/components/WorkshopBrand.tsx
- src/App.tsx, src/main.tsx, index.html, src/styles.css

Telas e referências:
- src/pages/Login.tsx, Activate.tsx, Home.tsx, Dashboard.tsx, Expenses.tsx,
  Management.tsx e PublicOrder.tsx
- src/components/WorkshopProfile.tsx e CapturePanel.tsx
- src/lib/cashWorkbook.ts e reportWorkbook.ts

Validação e correção local:
- tests/platformIdentity.test.ts
- tests/fixtures/workshopLogo.ts
- tests/localPostgres.integration.ts
- scripts/local-migrate.ts
- local-postgres/002-public-share-identity.sql

## Resultados

- npm.cmd run build: aprovado, incluindo TypeScript.
- npm.cmd test: **152 aprovados**, zero falhas.
- npm.cmd run test:postgres: **8 aprovados**, zero falhas após a migração local.
- git diff --check: aprovado.
- Revisão React: hooks sem condicionais, componentes pequenos, valores da sessão,
  texto escapado, imagem com alternativa identificada e marca decorativa sem
  leitura duplicada; sem biblioteca nova nem mudança no mecanismo de autenticação.
- Isolamento testado com duas logos sintéticas diferentes, tentativa de salvar
  em outra oficina, documentos e links públicos. As mutações PostgreSQL desse
  teste ficam em transação revertida.
- Conferência visual no navegador integrado: login e oficinas A/B em computador
  (1440x1000 / 1366x800) e celular (390x844), incluindo menu, rodapé, favicon,
  título da aba, upload pelas Configurações, atualização imediata e logout.
  Nenhum transbordamento horizontal foi observado.
- A oficina A recebeu uma logo sintética temporária no teste visual. Depois ela
  foi removida pelas Configurações, restaurando o cadastro inicial. Nenhum dado
  operacional ou credencial foi alterado. Os eventos de auditoria do salvamento
  fictício permanecem como registro normal do teste.

## Como conferir no navegador

1. Na raiz do projeto, execute `npm.cmd run dev`.
2. Abra http://127.0.0.1:5173. Confira marca neutra, favicon e ausência de nome
   de oficina antes de entrar.
3. Entre com a conta fictícia A usando o arquivo local data/local-credentials.json
   (não copie senhas para o código, commits ou mensagens).
4. Abra Configurações → Dados da oficina. Envie uma imagem e salve. Confira
   imediatamente nome/logo na barra lateral e na prévia do documento.
5. Saia da conta. O login e o título voltam à identidade neutra.
6. Entre com a conta fictícia B. Ela deve manter seu nome e seu próprio logo,
   ou monograma se estiver sem imagem. Nenhuma imagem da A deve aparecer.
7. Confira um orçamento/OS, checklist e link público: o cabeçalho é o da oficina.
8. Em largura de celular, abra o menu. Identidade no topo, navegação rolável e
   identificação menor do software no rodapé devem permanecer acessíveis.

## Limites e riscos

O nome e o símbolo da plataforma são provisórios. O aviso já existente de ambiente
de testes foi neutralizado e permanece nesta branch; uma futura publicação deve
revisar esse aviso e as configurações específicas do ambiente.

O build mantém o aviso de chunk JavaScript acima de 500 kB, sem falha.
Não há nova dependência. A identidade dos documentos usa os dados atuais da
oficina, como antes; não cria histórico de versões da marca.

As evidências visuais estão na pasta local:
C:/Users/horse/.codex/visualizations/2026/10/21/01a15c06-5bdf-7fb0-82c6-02bc6e9bf8ab/prod-001-1/
