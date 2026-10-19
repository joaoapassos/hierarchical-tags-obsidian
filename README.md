# Hierarchical Tags

Plugin Obsidian que mantém uma tag hierárquica baseada no diretório de cada nota Markdown, preservando as tags manuais.

Por exemplo, `Estudos/Programacao/Golang/Interfaces.md` recebe:

```yaml
---
tags:
  - Estudos/Programacao/Golang
auto_path_hierarchical_tags_obsidian: Estudos/Programacao/Golang
---
```

## Funcionamento

- Atualiza notas criadas ou movidas e notas descendentes de pastas movidas ou renomeadas.
- Renomear somente o arquivo não altera sua tag.
- Não sincroniza o Vault automaticamente na inicialização.
- O comando **Synchronize hierarchical tags** sincroniza as notas existentes, mesmo com atualização automática desativada.
- Operações repetidas não escrevem quando não há mudanças necessárias.

`auto_path_hierarchical_tags_obsidian` é uma propriedade reservada que registra a última tag adicionada pelo plugin. Somente uma tag com correspondência exata com esse registro válido pode ser removida. Não edite essa propriedade manualmente: ela é a prova de propriedade do plugin, não uma autenticação da origem da tag.

Uma tag já existente, inclusive com outra capitalização ou prefixo `#`, não é duplicada nem assumida pelo plugin. Tags manuais com hierarquias semelhantes são preservadas. Se uma tag gerenciada for removida, ela poderá ser recriada na próxima sincronização. Mover para a raiz sem tag ou para uma pasta excluída remove somente a tag comprovadamente gerenciada e limpa seu registro.

## Instalação local

Requer Node.js/npm para compilar e Obsidian 1.5.7 ou superior para executar.

```sh
npm install
npm run build
```

Crie `<Vault>/.obsidian/plugins/hierarchical-tags-obsidian/` e copie `main.js` e `manifest.json` para essa pasta. Recarregue o Obsidian e ative **Hierarchical Tags** nos plugins da comunidade. Utilize um Vault de teste inicialmente. Nenhum CSS adicional é necessário.

## Desenvolvimento

```sh
npm run dev        # recompila main.js ao salvar; recarregue o plugin no Obsidian
npm run typecheck  # TypeScript estrito
npm run check      # lint e formatação com Biome
npm run check:fix  # aplica correções e formatação
npm run build      # typecheck e bundle de produção
```

O bundle inclui o código do plugin; a API `obsidian` é fornecida pelo aplicativo. Não há testes automatizados ou infraestrutura de publicação.

## Configurações

- **Automatic updates**: ativado por padrão; acompanha criação e movimentação após o Vault estar pronto.
- **Excluded folders**: caminhos relativos ao Vault, um por linha; padrão `_system/`. Inclui descendentes, sem excluir pastas com apenas prefixo semelhante. Barras nas extremidades são opcionais; a comparação diferencia maiúsculas e minúsculas.
- **Root behavior**: nenhuma tag por padrão, ou `root`.

Alterações nas configurações são persistidas, mas não iniciam uma varredura. Execute o comando para aplicá-las às notas existentes.

## Verificação manual

1. Crie `Estudos/Programacao/Golang/Interfaces.md` e confira o YAML acima.
2. Adicione uma tag manual, mova a nota para outro diretório e confira que somente a tag gerenciada foi substituída. Renomeie o arquivo e depois a pasta.
3. Crie outra nota com uma tag manual igual ao diretório, sem `auto_path_hierarchical_tags_obsidian`; sincronize e mova a nota. Essa tag deve permanecer manual.
4. Mova notas para a raiz e para `_system/`; confira a limpeza somente das tags gerenciadas. Experimente a opção `root`.
5. Desative as atualizações automáticas, crie uma nota e execute o comando manual. Repita o comando para conferir que o conteúdo e a data de modificação não mudam novamente.
6. Experimente `tags` com uma estrutura inválida e um diretório com espaços; confira que a nota permanece intacta e o console registra o motivo.

## Limitações

- `FileManager.processFrontMatter()` pode reformatar o YAML, incluindo comentários e apresentação. Os valores das propriedades não gerenciadas e o corpo da nota são preservados.
- `tags` deve estar ausente ou ser uma lista de strings. Formatos escalares, valores nulos e estruturas inesperadas são ignorados com aviso no console, sem conversão automática.
- Metadados `auto_path_hierarchical_tags_obsidian` inválidos fazem a nota ser ignorada. Um registro válido é considerado prova de propriedade; não é possível distinguir alterações manuais feitas nesse registro.
- Caminhos não são normalizados para gerar tags. A validação conservadora aceita letras, marcas Unicode, números, símbolos Unicode, `_`, `-` e `/` entre segmentos, com ao menos um caractere não numérico. Espaços, pontuação não suportada e segmentos vazios causam aviso e preservação integral da nota, inclusive da tag anterior.
- Mudanças manuais nas notas não disparam sincronização automática. A recriação de uma tag removida ocorre no próximo comando ou evento de criação/movimentação aplicável.
- A serialização evita escritas simultâneas deste plugin no mesmo arquivo; não coordena outros plugins ou editores externos. Operações já iniciadas podem terminar durante a desativação.

Licença MIT; autor: joaoapassos.
