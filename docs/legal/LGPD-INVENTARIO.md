# OSDrive — inventário inicial de dados pessoais

Data de referência: 15/11/2026. Código: `main` em `ff8f1af1c4a6a39761506c11f530039716a95686`.

Este inventário foi feito pela leitura do código e das migrações. Ele não comprova a configuração efetiva dos provedores nem substitui a revisão jurídica e operacional. A Horse Power definitiva usa outro projeto e outra finalidade; não publicar este texto como política da Horse Power.

| Fluxo | Dados identificados no código | Finalidade observada | Acesso e destino | Pontos a confirmar |
| --- | --- | --- | --- | --- |
| Cadastro da oficina e convite | Nome, responsável, e-mail, telefone, documento, token com hash, estado e datas | Criar e ativar a oficina | Painel central, PostgreSQL, Resend para convite | Identidade do fornecedor e prazo de conservação dos convites |
| Usuários e autenticação | Nome, e-mail, hash da senha, vínculos, sessões, tentativas, eventos de segurança | Acesso e auditoria | PostgreSQL; equipe autorizada | Prazo de logs e atendimento de pedidos do titular |
| Operação da oficina | Clientes, contatos, veículos e placas, OS, itens, profissionais, fornecedores, financeiro e documentos | Gestão da operação e atendimento | Usuários da oficina sob isolamento; links públicos quando emitidos | Papel de controlador da oficina e instruções contratuais ao OSDrive |
| Checklists e fotos | Veículo, estado, observações e imagens | Documentar o atendimento | PostgreSQL e bucket privado da oficina | Retenção dos objetos após encerramento da oficina |
| Consulta de placas | Placa e dados retornados pelo provedor | Preencher o cadastro do veículo | Provedor FipePlaca, quando habilitado | Acordo e política do provedor; necessidade e retenção da consulta |
| Catálogo e captura externa | Placa, peças, serviços, preços e identificadores de captura | Importar itens escolhidos | Provedores externos e extensão, quando usados | Aplicabilidade por oficina e contratos dos provedores |
| Cobrança | Identificadores de cliente, assinatura, pagamento, valores, período e e-mail de faturamento | Contratação e cobrança | Stripe em modo de teste no estado examinado | Prazo fiscal/contábil, passagem para produção e compartilhamento efetivo |
| Suporte e auditoria | Mensagens, e-mail, oficina, ações e horários | Atendimento, segurança e rastreabilidade | Painel central e oficina | Prazo de retenção e procedimento de acesso/correção |
| Exportação e backup | Pacote criptografado `.hptx` com registros operacionais e fotos portáteis | Portabilidade e recuperação | PostgreSQL hoje; R2 proposto para cópia antes da exclusão | Chave, acesso, restauração e eliminação após 15 dias |

Evidência principal: `supabase/migrations/20261003220749_horse_power_cloud.sql`, `supabase/migrations/20261023000500_platform_workshops.sql`, `server/services/dataTransferExport.ts`, `server/services/checklistPhotoStorage.ts`, `server/services/stripeBilling.ts`, `server/services/workshopActivation.ts` e `server/platformAdminApp.ts`.

## Lacunas a resolver antes da publicação comercial

1. Identificar a pessoa jurídica responsável pelo OSDrive, contato de privacidade e a relação contratual entre OSDrive e cada oficina. A classificação controlador/operador depende de quem decide finalidade e meios essenciais em cada fluxo; não pode ser inferida apenas do esquema do banco.
   O responsável informou em 15/11/2026 que ainda não tem razão social e CNPJ definidos. O endereço em `osdrive.com.br` também ainda precisa de uma caixa de entrada ou roteamento capaz de receber solicitações; o Resend configurado para envio não comprova recebimento.
2. Registrar as bases legais e prazos por categoria. Não assumir que a regra de exclusão de 90 dias elimina obrigações fiscais, contábeis ou de preservação de registros de acesso.
3. Publicar política do OSDrive distinta de `public/privacidade.html`, que hoje cobre apenas o Conector Horse Power.
4. Oferecer canal e procedimento para pedidos de acesso, correção, portabilidade e eliminação, inclusive para dados de clientes das oficinas.
5. Conferir contratos, regiões e configurações efetivas de Supabase, Vercel/Cloudflare, Resend, Stripe e FipePlaca antes de descrever transferência internacional ou retenção.
6. Testar exportação, restauração, integridade e eliminação de backups, bem como a revogação de links públicos e sessões na exclusão.

Referências: [ANPD — agentes de tratamento](https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/guia-orientativo-para-definicoes-dos-agentes-de-tratamento-de-dados-pessoais-e-do-encarregado), [ANPD — direitos dos titulares](https://www.gov.br/anpd/pt-br/assuntos/titular-de-dados-1/direito-dos-titulares) e [ANPD — término e conservação](https://www.gov.br/anpd/pt-br/acesso-a-informacao/perguntas-frequentes).
