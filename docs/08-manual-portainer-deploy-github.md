# 08 - Manual Prático: Portainer (Como Associar um Repositório Novo do GitHub)

[⬅️ Voltar para a Wiki Principal](../README.md)

Este guia é o seu **passo a passo de bolso** para toda vez que você criar um projeto novo no seu PC, subir pro GitHub e quiser colocar ele no ar na TV Box com atualização automática.

---

## 🎯 Passo 1: Colocar o arquivo `docker-compose.yml` no seu Projeto

Para o Portainer saber o que fazer com o seu repositório do GitHub, basta criar um arquivo chamado **`docker-compose.yml`** na raiz do seu projeto (junto com o `README.md` ou `index.html`).

Escolha **um dos 2 modelos prontos abaixo** de acordo com o tipo do seu projeto:

---

### 📦 Modelo A: Para Sites, Jogos Web (HTML/CSS/JS) ou React/Vite Compilado (Gasta ~0 MB de RAM!)
Use este modelo quando seu projeto for um site ou aplicativo front-end. Ele sincroniza seu repositório do GitHub a cada 60 segundos direto para dentro do **PocketBase**, sem gastar memória RAM extra!

> **O que trocar no código abaixo:**
> 1. Troque `meu-projeto` pelo nome do seu projeto (em `container_name` e no final de `/pb_public/meu-projeto`).
> 2. Troque a URL `https://github.com/jonathanbrum/meu-projeto.git` pelo link do seu repositório novo.

```yaml
services:
  sync-site:
    image: alpine/git:latest
    container_name: sync-meu-projeto
    restart: unless-stopped
    entrypoint: /bin/sh
    command: >
      -c "while true; do
            if [ -d /dest/.git ]; then
              cd /dest && git fetch --all -q && git reset --hard origin/main -q;
            else
              rm -rf /dest/* /dest/.[!.]* 2>/dev/null;
              git clone -q https://github.com/jonathanbrum/meu-projeto.git /dest;
            fi;
            sleep 60;
          done"
    volumes:
      - /DATA/AppData/pocketbase/pb_public/meu-projeto:/dest
```
* **Onde seu site vai abrir:** `http://<IP_DA_TV_BOX>:8090/meu-projeto/`

---

### ⚙️ Modelo B: Para Servidor Node.js (API Express, Bot ou Jogo Multiplayer Socket.io)
Use este modelo quando o projeto precisar rodar `node index.js` ou `npm start` o tempo todo no servidor (ex.: um servidor multiplayer com WebSockets).

> **O que trocar no código abaixo:**
> 1. Troque `meu-servidor-node` pelo nome do seu projeto.
> 2. Troque a URL do GitHub pelo link do seu repositório.
> 3. Escolha uma porta livre para ele (ex.: `3001:3000` para o projeto 1, `3002:3000` para o projeto 2).

```yaml
services:
  app:
    image: node:20-alpine
    container_name: meu-servidor-node
    restart: unless-stopped
    working_dir: /app
    ports:
      - "3001:3000"
    volumes:
      - /DATA/AppData/projetos/meu-servidor-node:/app
    command: >
      sh -c "apk add --no-cache git &&
             if [ ! -d /app/.git ]; then
               git clone https://github.com/jonathanbrum/meu-servidor-node.git /app;
             else
               git fetch --all && git reset --hard origin/main;
             fi &&
             npm install &&
             npm start"
```
* **Onde seu servidor vai abrir:** `http://<IP_DA_TV_BOX>:3001`

---

## 🚀 Passo 2: Associar o Repositório no Portainer (Em 1 Minuto)

Depois de dar `git push` no seu projeto com o `docker-compose.yml` lá dentro:

1. Abra o **CasaOS** e clique no ícone do **Portainer**.
2. Clique em **`local`** (a baleiazinha) ➡️ no menu esquerdo clique em **`Stacks`**.
3. Clique no botão azul **`+ Add stack`** (canto superior direito).
4. Preencha os campos:
   * **Name:** Digite o nome do projeto tudo minúsculo e sem espaços (ex.: `meu-projeto`).
   * **Build method:** Selecione o quadradinho **`Repository`**.
   * **Repository URL:** Cole o link do GitHub (ex.: `https://github.com/jonathanbrum/meu-projeto.git`).
   * **Repository reference:** Digite `refs/heads/main`.
   * **Compose path:** Deixe `docker-compose.yml`.
   * **GitOps updates:** Ligue a chavinha 🟢 (deixe em `Polling` / `5m`).
5. Role até o fim da página e clique em **`Deploy the stack`**.

Pronto! Seu projeto novo já está no ar! 🎉

---

## 🛠️ Passo 3: Como Gerenciar Seus Projetos no Dia a Dia (No Portainer)

* **Forçar Atualização Imediata:**
  Entrou na sua Stack (`Stacks` ➡️ clique no nome do projeto) ➡️ clique no botão **`Pull and redeploy`** (ou reinicie o container).
* **Ver se deu algum erro no código (Logs):**
  No menu esquerdo do Portainer, clique em **`Containers`** ➡️ na linha do seu projeto, clique no primeiro ícone da coluna *Quick Actions* (**`Logs`**, ícone de folhinha de papel). Ali aparece tudo o que o `console.log` do seu projeto imprimiu!
* **Pausar um projeto para economizar RAM:**
  Em **`Containers`**, marque a caixinha do projeto e clique no botão vermelho **`Stop`** no topo. Quando quiser ligar de novo, é só clicar em **`Start`**!
