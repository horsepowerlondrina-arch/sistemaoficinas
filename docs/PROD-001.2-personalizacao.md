# PROD-001.2 — Personalização dos dados da oficina

## Configuração da oficina

O perfil administrativo da oficina combina as colunas legadas de `tenants` com o objeto `profile_data`. O endpoint autenticado deriva sempre `tenant_id` da sessão; o identificador enviado pelo navegador serve apenas para detectar uma tela aberta em outra oficina e nunca escolhe o destino da gravação. Somente owner/admin edita o perfil. Dados de contato, endereço, documento fiscal, inscrições, URLs, cor, horários, termos comerciais e recebimento são validados no servidor. CPF e CNPJ numérico validam os dígitos verificadores; o CNPJ alfanumérico lançado em 2026 usa o cálculo publicado pela [Receita Federal](https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/documentos-tecnicos/cnpj).

O telefone e o WhatsApp são independentes. O botão de cópia é uma ação local no formulário. A consulta de CEP é opcional, envia apenas o CEP ao ViaCEP, preenche somente campos ainda vazios e mantém todos os campos editáveis. A logo continua sendo um único PNG normalizado para cada oficina; a validação de conteúdo e o limite de tamanho são executados no servidor. Sem logo, a interface e documentos usam iniciais e nome da oficina. O texto usa preto ou branco com base no contraste da cor escolhida.

Os horários são informativos, por dia da semana, com fechamento e intervalo opcionais; não controlam acesso nem incluem feriados. Os termos de pagamento, garantia, validade comercial em dias, observações, rodapé, Pix e instruções de recebimento aparecem somente em novas emissões. Não acionam contas ou lançamentos. O aviso de garantia ressalva os direitos legais. A prévia do orçamento usa os dados ainda não salvos e não emite documento.

## Migração aditiva

`server/db/migrations/023-workshop-customization.sql` e `local-postgres/003-workshop-customization.sql` adicionam `profile_data`, marcadores de legado, o vínculo de revisão dos links e `document_revisions`. Não removem nem reescrevem endereços, ordens, itens, recebimentos ou assinaturas. Registros que já existiam recebem `identity_legacy=1`; novos recebem zero. Na instalação local em que faltavam tabelas de checklist, a migração PostgreSQL só as cria se ausentes, usando as definições existentes da aplicação.

As revisões são somente leitura para o usuário da aplicação: há permissão de `SELECT` e `INSERT`, política RLS de backend, e gatilho que rejeita `UPDATE`/`DELETE`. O runtime continua responsável por autorizar cada leitura pela oficina autenticada.

## Emissão e legado

Ao concluir um checklist assinado, o snapshot é criado na mesma transação. Ao emitir ou compartilhar pela primeira vez uma ordem, o sistema salva uma revisão. O snapshot contém a identidade e preferências da oficina, endereço e horários, itens e valores da ordem, dados de cliente/veículo usados na impressão, resumo de pagamentos visível ao cliente, assinatura e bytes das fotos do checklist. Custos, contas bancárias e taxas internas não são expostos no link público. Cada registro inclui SHA-256 do JSON persistido e número sequencial de revisão.

Editar o perfil, a ordem ou pagamentos não altera revisões já emitidas. Reimprimir e compartilhar de novo pode selecionar uma revisão anterior. Owner/admin pode emitir uma nova revisão explicitamente; isso preserva as antigas e seus links. A validade configurada é calculada na emissão de um orçamento e não altera a validade/revogação independente do link público.

Para linhas legadas sem snapshot não existe identidade confiável no histórico. A migração não reconstrói esses dados a partir do perfil atual: links antigos informam que o conteúdo histórico não foi registrado, e a emissão exige ação explícita de nova revisão, identificada como nova emissão de legado. Itens, valores, pagamentos e assinaturas operacionais ficam intactos.

## Validação

Na branch local `prod-001-2-personalizacao`, executar `npm.cmd run build`, `npm.cmd test` e `npm.cmd run test:postgres`. O teste PostgreSQL usa as duas oficinas fictícias existentes e reverte as alterações de validação; não executar migrações de produção/homologação. Para conferir a interface, iniciar o desenvolvimento local, abrir **Configurações → Dados da oficina**, revisar as seções e a prévia em cada sessão fictícia. Testar a tela estreita e larga; para conferir documentos, emitir um documento de teste e validar revisão, reimpressão e compartilhamento da revisão escolhida.
