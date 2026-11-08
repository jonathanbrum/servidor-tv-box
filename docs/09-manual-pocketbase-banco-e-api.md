# 09 - Manual Prático: PocketBase (Banco de Dados, Login e Código Prático)

[⬅️ Voltar para a Wiki Principal](../README.md) | [⬅️ Anterior: 08 - Manual do Portainer](08-manual-portainer-deploy-github.md)

O **PocketBase** (`http://<IP_DA_TV_BOX>:8090/_/`) é o seu "Firebase / Supabase" particular. Ele junta **Banco de Dados**, **Sistema de Login**, **Upload de Imagens** e **Hospedagem de Sites** em um painel super simples.

---

## 🗄️ 1. Como Criar uma Tabela Nova para um Projeto (`Collections`)

No PocketBase, cada tabela é chamada de **Collection** (Coleção).
Para manter vários projetos organizados no mesmo PocketBase, use sempre o nome do projeto na frente:

1. No menu esquerdo, clique no botão **`+ New collection`**.
2. Em **Name**, digite o nome da tabela com o prefixo do projeto (ex.: `jogo_ranking` ou `loja_produtos`).
3. Clique em **`+ New field`** para adicionar as colunas que você quer:
   * **`Plain text`:** Textos curtos ou longos (nome, descrição, mensagem).
   * **`Number`:** Números inteiros ou com vírgula (preço, pontuação, quantidade).
   * **`Bool`:** Verdadeiro ou Falso (`true` / `false`, ex.: `concluido`).
   * **`File`:** Upload de imagens, fotos de perfil, PDFs ou áudios (ele já cria o link da imagem pronto!).
   * **`Relation`:** Conecta uma tabela a outra (ex.: ligar uma tarefa ao usuário dono dela na tabela `users`).
   * **`JSON`:** Para salvar objetos ou listas livres em formato JSON.

---

## 🔓 2. O Segredo Mais Importante: Destravar as Permissões (`API Rules`)!

> ⚠️ **Atenção:** Por padrão, toda tabela nova que você cria vem **trancada** (`Superusers only`), ou seja, seu site vai receber erro de *"Acesso Negado"* se tentar ler ou salvar dados nela!

Para liberar o acesso ao seu site antes de clicar em *Create/Save*:
1. Na janela da sua tabela, clique na aba **`API Rules`** (no topo da janelinha, ao lado de *Fields*).
2. Você verá 5 ações: **List/Search** (listar), **View** (ver 1 item), **Create** (criar novo), **Update** (editar) e **Delete** (apagar).
3. Como configurar cada regra com 1 clique:
   * **Para deixar PÚBLICO (qualquer pessoa no site pode ler ou criar, ex.: ranking de jogo):**
     Clique no cadeado (`Unlock`) e deixe o campo **totalmente vazio** (`""`). Campo vazio = liberado para todos!
   * **Para liberar SÓ para usuários logados no seu site:**
     Deixe a regra padrão `@request.auth.id != ""` (significa: *"só aceite se o usuário estiver logado"*).
   * **Para bloquear (só você pelo painel Admin pode mexer):**
     Clique em `Lock` (`Superusers only`).
4. Clique em **`Create`** (ou **`Save changes`**).

---

## 💻 3. Como Usar o Banco no Seu Site (HTML / JS Puro ou React)

### Jeito Automático: O Botão `</> API Preview`
Dentro de qualquer tabela sua no PocketBase, clique no botão **`</> API Preview`** (no canto superior direito). Ele mostra os exemplos prontos de código com os nomes exatos das colunas que você criou!

### Modelo Pronto (Copie e Cole no seu `index.html`):
Você não precisa nem instalar nada com `npm` se não quiser! Basta importar o SDK do PocketBase via `<script>` e usar assim:

```html
<script type="module">
  import PocketBase from 'https://cdn.jsdelivr.net/npm/pocketbase@0.21.5/dist/pocketbase.es.mjs';

  // Conecta automaticamente no PocketBase da sua TV Box
  const pb = new PocketBase(window.location.origin);

  // 1. LISTAR DADOS DA TABELA (ex: 'jogo_ranking')
  async function carregarRanking() {
    const lista = await pb.collection('jogo_ranking').getFullList({
      sort: '-pontos', // Ordena do maior para o menor
    });
    console.log('Ranking:', lista);
  }

  // 2. SALVAR UM NOVO REGISTRO NA TABELA
  async function salvarPontuacao(nomeJogador, pontos) {
    const novo = await pb.collection('jogo_ranking').create({
      nome: nomeJogador,
      pontos: pontos
    });
    console.log('Salvo com sucesso!', novo);
  }

  // 3. LOGIN DE USUÁRIO (Tabela nativa 'users')
  async function fazerLogin(email, senha) {
    const authData = await pb.collection('users').authWithPassword(email, senha);
    console.log('Usuário logado:', pb.authStore.model);
  }
</script>
```

---

## 📁 4. Como Subir um Site Rápido sem GitHub (Direto pelo Mouse)

Se você fez um teste rápido em um arquivo `index.html` no seu PC e quer ver rodando na hora sem precisar criar repositório no GitHub:
1. Abra o painel do **CasaOS** (`http://<IP_DA_TV_BOX>`).
2. Abra o aplicativo **`Files` (Arquivos)**.
3. Entre em: `AppData` ➡️ `pocketbase` ➡️ `pb_public`.
4. Clique em **Nova Pasta** (ex.: `teste1`), entre nela e arraste seu `index.html` do Windows para dentro dela.
5. Abra no navegador: `http://<IP_DA_TV_BOX>:8090/teste1/` — já está no ar!
