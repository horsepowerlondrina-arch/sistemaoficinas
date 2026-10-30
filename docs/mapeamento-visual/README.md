# Biblioteca visual — Sistema Oficinas

Referência compartilhada de telas reais do Sistema Oficinas. As capturas foram feitas em ambiente local com dados fictícios; cada registro mantém seu estado, data e commit de origem, quando conhecido. Funcionalidades sem imagem aparecem como pendentes ou bloqueadas.

- [Índice visual navegável](./INDEX.md)
- [Checklist completo](./CHECKLIST.md)
- [Catálogo de capturas](./catalog.json)

## Acesso

Consulte esta pasta no repositório privado do GitHub. O índice mostra as miniaturas e abre os PNGs completos. A biblioteca é exclusiva do desenvolvimento e não integra nem é publicada com a aplicação da oficina.

## Manutenção

- visual:capture — percorre as rotas catalogadas e atualiza as capturas, data e commit. Faça o commit do código da interface primeiro; a captura gravadora exige checkout limpo para registrar a revisão correta. Requer aplicação local de teste e o arquivo ignorado data/local-credentials.json, gerado pelo seed local.
- visual:capture -- --module 08-financeiro — limita a execução a um módulo.
- visual:capture -- --affected — seleciona módulos conforme os arquivos alterados em relação a origin/main.
- visual:check — confere PNGs, metadados, caminhos, estados e índices.
- visual:index — regenera este índice e o checklist a partir do catálogo JSON.

Capturas que criem, editem ou finalizem registros só podem usar base PostgreSQL efêmera de CI ou outra base descartável configurada. Nunca rode capturas gravadoras na homologação compartilhada.

## Coleta atual

O acervo inclui 53 PNGs de telas reais, capturados em 22/10/2026. O commit da sessão original não foi registrado; a recaptura automatizada está pendente. Imagens administrativas de auditoria, credenciais, tokens e identidade de oficina não relacionada foram excluídas.
