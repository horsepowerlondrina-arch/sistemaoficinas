# Fotos privadas — Horse Power definitiva

Destino exclusivo: Vercel `horse-power-definitivo`, Supabase `rvlovjpquozbrsszsxwe`.
Base: PR #184 validado na homologação, adaptado à branch definitiva sem gestão de usuários ou infraestrutura Cloudflare.

## Preservação e recuperação

- Novas fotos usam o bucket privado `checklist-photos`, caminho por oficina e objeto imutável, com conferência de tamanho e SHA-256 após upload.
- As fotos Base64 existentes continuam no banco, sem conversão automática. Sua leitura independe da disponibilidade do Storage.
- Snapshots emitidos permanecem imutáveis. Novos documentos e pacotes `.hptx` incorporam os bytes verificados, sem referências privadas externas.
- Não há migração de schema, lote, limpeza, lifecycle ou workflow destrutivo nesta publicação.
- Para suspender novos uploads privados, desligar `CHECKLIST_STORAGE_ENABLED`, conservando URL e segredo para leitura das referências existentes. Não remover o bucket nem retornar a um código que desconheça referências privadas.
- Reversão completa após novos uploads exige materialização verificada de volta em Base64, com autorização própria; não apagar objetos antes disso.

## Configuração restrita

Após aprovação específica, criar bucket privado com limite 1.600.000 bytes e MIME JPEG/PNG, sem políticas públicas ou acesso direto do navegador. Criar chave identificada exclusivamente para o servidor definitivo, guardar somente como segredo na Vercel Production desse projeto, nunca no GitHub ou frontend.

Configuração: `CHECKLIST_STORAGE_URL=https://rvlovjpquozbrsszsxwe.supabase.co`, `CHECKLIST_STORAGE_SECRET` sensível e `CHECKLIST_STORAGE_ENABLED=true`. O adaptador recusa projeto diferente de `EXPECTED_DATABASE_PROJECT`. Não reutilizar a chave da homologação.

## Validação

Build, testes gerais e PostgreSQL 17 descartável no GitHub Actions, com armazenamento fictício. Casos: legado e privado, falha de Storage/hash sem perda da origem, isolamento, snapshot e exportação portátil; leitura legada com configuração indisponível; referências privadas continuam legíveis ao suspender novos uploads; recusa de projeto incorreto.

Antes e depois da publicação, comparar contagens e assinatura agregada dos registros de fotos e revisões sem retornar bytes, dados pessoais ou caminhos. A inspeção inicial encontrou 24 fotos legadas e 30 revisões. Não usar dados reais para upload de teste: a validação gravadora do fluxo é feita somente em ambiente descartável/homologação com dados fictícios. No definitivo, conferir leitura autenticada das fotos existentes e logs.
