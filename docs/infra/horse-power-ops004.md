# OPS-004 — Horse Power definitiva

Base exclusiva: `feat/hp-definitivo-sistema`, commit `c47682625249060d50dd25907e9946cbfd984a71`. Integração preparada dos PRs #168, #169 e #172, sem incorporar a main inteira, a gestão central, cobrança de planos, suporte ou Cloudflare. PR #192 pertence a outra execução e não foi alterado.

Preservados: site na raiz, sistema em /sistema, Premium definitivo, extensão Sky Peças, financeiro e recebimentos existentes, fotos privadas e 30 revisões. A navegação compartilhada entre Início/menu filtra as permissões efetivas; links internos e convites respeitam /sistema.

## Banco e autorização

Migração necessária: `supabase/migrations/20261113000100_workshop_users.sql`, espelhada em `local-postgres/038-workshop-users.sql`. Oito tabelas novas, perfis e limites, vagas/convites, funcionários, equipe das OS, aprovações e autenticação recente. RLS e funções privadas com grants restritos a horse_power_app, herdados pelo login definitivo. O vínculo owner existente recebe perfil Master, sem mudar ID, senha ou proprietário. Não cria colaboradores nem envia convites automaticamente. Triggers preservam o último Master e a contagem de vagas. Aprovações não aplicam descontos automaticamente nem reabrem recebimentos pagos.

Prévia somente leitura: uma oficina, um usuário, um vínculo, 312 OS, 24 fotos e 30 revisões. As duas funções administrativas modificadas pela migração têm os trechos esperados. Nenhum registro foi modificado na preparação. Revalidar antes de aplicar; aplicar exclusivamente em rvlovjpquozbrsszsxwe após CI e autorização específica. Não publicar código dependente antes de validar a migração.

A reversão preserva as tabelas, auditoria e vínculos. Após usar desativações ou permissões, não voltar ao autenticador antigo que ignora esses controles. Não apagar tabelas ou perfis para fazer rollback.

## E-mail

A leitura dos NOMES das configurações Production encontrou APP_ORIGIN e EXPECTED_DATABASE_PROJECT; RESEND_API_KEY e WORKSHOP_ACTIVATION_FROM não estão configurados. Convites reais exigem configurar o envio com autorização específica. Nenhuma chave foi consultada ou copiada. O CI simula o provedor e não envia e-mails reais. Sem configuração, a interface deve informar falha de envio e permitir retentativa, preservando o convite; não declarar o envio real validado.

## Validação

CI obrigatório: build, TypeScript, testes gerais, PostgreSQL 17 descartável, concorrência, RLS, revogação, último Master, privacidade, documentos, atribuição e aprovação de descontos, fotos privadas e regressões financeiras/visuais. A suíte de interface OPS-004 usa oficinas fictícias em banco descartável. Capturas da versão portada devem ser revisadas no artefato antes de atualizar os PNGs do catálogo. Nunca capturar dados reais para a biblioteca do GitHub.

Após autorização e publicação: validar por leitura autenticada a conta atual como Master, Configurações → Usuários e funcionários, vagas, equipe/aprovações e preservação das fotos/documentos. Não criar usuários reais, convites, descontos ou movimentações para testar em produção.
