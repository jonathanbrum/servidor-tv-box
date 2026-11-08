# 07 - Como Ter uma Experiência "Estilo Vercel / Firebase" (100% Visual) em 1 GB de RAM

[⬅️ Voltar para a Wiki Principal](../README.md) | [⬅️ Etapa Anterior: 06 - Arquitetura Home Lab](06-arquitetura-homelab-e-servicos.md)

---

## 1. O Desafio Técnico: Por que não usar Coolify puro em 1 GB de RAM?
No mundo de servidores maiores (VPS de 4 GB ou 8 GB de RAM), ferramentas como o **Coolify** imitam a Vercel. Porém, o Coolify exige no mínimo **2 GB de RAM só para ficar parado** e, na hora de compilar um site React/Next.js (`npm run build`), consome mais de 1,5 GB de RAM, o que travaria uma TV Box de 1 GB.

### A Solução Inteligente para a Nossa TV Box:
Combinar **3 ferramentas 100% visuais e ultraleves** (que juntas gastam menos de **90 MB de RAM**!) para você fazer tudo pelo navegador:

---

## 2. A "Tríade Visual" para Seus Projetos

### 🚀 1. Portainer CE (ou Dockge) — Seu "Painel de Deploy Automático via Git" (~40 MB RAM)
Tanto o **Portainer** quanto o **Dockge** estão na Loja de Apps do CasaOS (1 clique para instalar) e têm interface 100% gráfica:
* **Deploy conectado ao seu GitHub (Estilo Vercel):**
  No **Portainer**, você clica em **Stacks ➡️ Add Stack ➡️ Repository**, cola o link do seu repositório do **GitHub** (ou do seu Gitea local) e ativa a chavinha **"GitOps updates"** (a cada 5 minutos ou via Webhook).
* **Como funciona no seu dia a dia:**
  Você altera o código no VS Code do seu PC, dá `git push` pro GitHub, e o Portainer na TV Box detecta a mudança sozinho e atualiza o seu projeto no ar automaticamente!

### ⚡ 2. PocketBase (ou Adminer + Postgres) — Seu "Firebase/Supabase Visual" (~15 MB RAM)
Se você quer criar bancos de dados, tabelas, sistema de login de usuários e até hospedar o front-end do seu site **tudo clicando na tela pelo navegador**:
* O **PocketBase** consome ridículos **15 MB de RAM**.
* Ele abre um painel administrativo lindo no navegador onde você cria tabelas, colunas, vê os dados em planilha, faz upload de arquivos e ele já gera a API pronta pro seu front-end consumir.

#### 📥 Como Instalar o PocketBase no CasaOS (via `Instalação personalizada`):
Como o PocketBase não vem listado com esse nome na loja padrão, você instala ele em 10 segundos colando este código no CasaOS:
1. Na **Loja de Apps** do CasaOS, clique no botão azul **`Instalação personalizada`** (canto superior direito).
2. Na janelinha que abrir, clique no ícone **`Importar`** (no topo direito da janela, ao lado do título).
3. Na aba **`Docker Compose`**, cole o código abaixo e clique em **Enviar** ➡️ **Instalar**:

```yaml
name: pocketbase
services:
  pocketbase:
    image: ghcr.io/muchobien/pocketbase:latest
    container_name: pocketbase
    restart: unless-stopped
    ports:
      - "8090:8090"
    volumes:
      - /DATA/AppData/pocketbase/pb_data:/pb_data
      - /DATA/AppData/pocketbase/pb_public:/pb_public
    x-casaos:
      title:
        en_us: PocketBase
      icon: https://pocketbase.io/images/logo.svg
      webui_port: "8090"
      index: /_/
```
* **Primeiro Acesso (Criar o Superuser no PocketBase v0.23+):**
  Por segurança, nas versões novas do PocketBase acessadas via IP da rede (`<IP_DA_TV_BOX>`), a tela `http://<IP_DA_TV_BOX>:8090/_/` pede login direto (`Superuser login`) em vez de deixar qualquer pessoa da rede criar o primeiro admin. Para criar sua conta de Superuser:
  * **Opção A (100% pelo navegador no CasaOS - Olhando os Logs):**
    1. No painel do CasaOS, passe o mouse sobre o ícone do **PocketBase**, clique nos **3 pontinhos (`⋮`)** ➡️ **Configurações**.
    2. No topo direito da janelinha, clique no ícone **`Terminal e Logs`** (quadradinho `>_`) e vá na aba **`Logs`**.
    3. Você verá um link grande parecido com `http://0.0.0.0:8090/_/#/pbinstal/eyJhbGci...`. Copie a parte final a partir de `/_/#/pbinstal/...` e abra no navegador trocando `0.0.0.0` pelo `<IP_DA_TV_BOX>` (ex.: `http://<IP_DA_TV_BOX>:8090/_/#/pbinstal/eyJ...`). Essa tela permite definir sua senha!
  * **Opção B (1 Comando Direto no Terminal):**
    Rode no seu terminal SSH (ou no terminal web do CasaOS):
    ```bash
    docker exec -it pocketbase pocketbase superuser upsert seu-email@email.com SuaSenhaForte123 --dir=/pb_data
    ```
* **Bônus (Hospedagem de Sites Automática):** Qualquer arquivo `index.html` / site estático que você jogar dentro da pasta `/DATA/AppData/pocketbase/pb_public` (pelo app **Files** do CasaOS) fica automaticamente no ar em `http://<IP_DA_TV_BOX>:8090/`!

### 🧩 3. Node-RED (ou n8n) — Criação Visual de Backends, Bots e Automação da Casa (~60 MB RAM)
Em vez de subir um servidor do zero toda vez que quiser criar uma automação, um bot de Telegram/Discord, uma integração de API ou controlar lâmpadas da casa:
* Você abre o painel web do **Node-RED**, arrasta bloquinhos na tela (ex.: *"Quando receber um clique no site ➡️ Salvar no Banco ➡️ Ligar luz da sala / Mandar mensagem no Telegram"*) e clica no botão vermelho **"Deploy"** no canto superior direito!

---

## 3. A Arquitetura de Ouro: Como Deixar 10, 20 ou 30 Projetinhos ON 24/7 em 1 GB de RAM

Se você subisse cada projetinho em um container Node.js separado (10 containers rodando `npm start`), cada um comeria ~70 MB de RAM e sua memória acabaria no 8º projeto.

Para manter **dezenas de projetos online 24 horas por dia ao mesmo tempo** sem gastar memória extra, dividimos seus projetos em **3 Padrões Inteligentes**:

| Tipo de Projeto | Onde Rodar | Gasto de RAM Base | Gasto por Projeto Novo | Quantos cabem ON 24/7? |
| :--- | :--- | :--- | :--- | :--- |
| **1. Sites, Web Apps (React/Vue/HTML) + Banco + Login + Upload** | **PocketBase Único** (`/pb_public/nome-do-projeto` + Collections) | ~15 MB (já ligado) | **0 MB** | **Ilimitados (50+ projetos)** |
| **2. Backends de API, Bots (Telegram/Discord), Webhooks e Automações** | **Node-RED Único** (1 Aba por Projeto) | ~60 MB (já ligado) | **~0.5 MB** | **Dezenas (20 a 40 fluxos)** |
| **3. Servidores dedicados (Jogos Multiplayer Socket.io, Python, Go)** | **Portainer GitOps** (Containers `alpine` separados por porta) | ~0 MB parado | **~25 a 50 MB cada** | **5 a 8 simultâneos** |

---

### 🏆 Padrão 1: "Motor Único" no PocketBase (Sites + Banco + Auth — 0 MB por projeto novo!)
Quase todo projeto web moderno (um app em React/Vite, um painel financeiro, um mini-game em HTML5/JS, um portfólio) é composto por **Front-end (arquivos HTML/JS/CSS)** + **Banco de Dados/Login**.
* **Como manter 20 projetos desses ON ao mesmo tempo:**
  1. **Front-end:** Dentro da pasta `/DATA/AppData/pocketbase/pb_public/`, crie uma subpasta para cada projeto:
     * `/pb_public/financas/` ➡️ fica ON 24/7 em `http://<IP_DA_TV_BOX>:8090/financas/`
     * `/pb_public/rpg-web/` ➡️ fica ON 24/7 em `http://<IP_DA_TV_BOX>:8090/rpg-web/`
     * `/pb_public/wiki/` ➡️ fica ON 24/7 em `http://<IP_DA_TV_BOX>:8090/wiki/`
  2. **Banco de Dados e Usuários:** No painel do PocketBase (`http://<IP_DA_TV_BOX>:8090/_/`), basta nomear as tabelas (Collections) com o prefixo de cada projeto:
     * `fin_transacoes`, `fin_categorias`
     * `rpg_personagens`, `rpg_inventario`
* **Vantagem Brutal:** Você pode ter **50 projetos completos com banco de dados e login no ar ao mesmo tempo**, e todos juntos vão consumir apenas os **15 MB de RAM** do único PocketBase que já está aberto!

---

### 🧩 Padrão 2: "Um Backend por Aba" no Node-RED (APIs, Bots e Cronjobs — Quase 0 MB extra!)
Sabe quando você quer fazer um projetinho que precisa rodar lógica no servidor (ex.: um bot de Discord/Telegram, um raspador de preços que roda de hora em hora, ou um endpoint `/api/sortear`)?
* Em vez de subir um servidor Node.js inteiro só pra isso:
  1. Abra o **Node-RED** (que já está rodando na TV Box).
  2. Clique no botão **`+`** no topo para criar uma **nova aba** com o nome do projeto (ex.: `Projeto Bot Preços`).
  3. Arraste um bloco `HTTP In` (para criar uma rota de API) ou `Telegram` / `Cron`, escreva sua função em JavaScript se precisar, e clique em **Deploy**.
* **Vantagem:** Você pode deixar **20 bots e micro-APIs rodando 24/7**, todos dividindo os mesmos ~60 MB de RAM do Node-RED!

---

### 🚀 Padrão 3: Deploy Automático via GitHub no Portainer (GitOps)
Para projetos que você edita no VS Code e dá `git push` pro GitHub, você tem duas formas de automatizar pelo **Portainer** (`Stacks ➡️ Add Stack ➡️ Repository`):

#### Opção 3A: Sincronizar Vários Sites do GitHub Direto para o PocketBase (Mais Leve do Mundo!)
Você pode ter um repositório no GitHub para cada site (ou um repositório "monorepo" com vários projetinhos) e usar um container `alpine/git` super leve no Portainer que puxa seu código do GitHub automaticamente e joga dentro de `/DATA/AppData/pocketbase/pb_public/nome-do-projeto`!

#### Opção 3B: Um Container por Projeto (Para Servidores Multiplayer / Node.js / Python)
Quando o projeto precisa de um servidor próprio em tempo real (ex.: um joguinho multiplayer usando `Socket.io` ou `Colyseus`):
1. No seu repositório do GitHub, você deixa um `docker-compose.yml` usando imagens leves (`node:20-alpine` ou `python:3.12-alpine`).
2. No **Portainer**, vai em **Stacks ➡️ Add stack ➡️ Repository**, cola a URL do repositório do GitHub, ativa **`GitOps updates`** e escolhe uma porta livre (ex.: `:3001` pro Jogo 1, `:3002` pro Jogo 2).
3. Sempre que der `git push`, o Portainer atualiza aquele servidor sozinho!

---

## 4. Exemplo Real: Transformando Esta Wiki em Nosso 1º Projeto no Git + No Ar na TV Box!

Esta própria pasta (`Projeto TV BOX`) está configurada como um repositório Git com um arquivo `index.html` (usando **Docsify**), permitindo que:
1. Ela fique salva e versionada no seu **GitHub** (`jonathanbrum`).
2. Ela rode ao vivo como um **site de documentação interativo** direto na sua TV Box em `http://<IP_DA_TV_BOX>:8090/wiki/` (via Portainer GitOps)!

Se você fez um site (HTML/JS/React compilado, Node.js ou Python) no seu PC e quer colocar no ar na TV Box usando só o mouse:
1. Abra o app **Files (Arquivos)** no painel do CasaOS (`http://<IP_DA_TV_BOX>`).
2. Arraste a pasta do seu projeto do Windows direto para dentro de `/DATA/AppData/meus-projetos/`.
3. Na Loja de Apps (ou no **Portainer** / **Dockge**), clique no seu container web e aponte para essa pasta — pronto, já está rodando na sua rede!
