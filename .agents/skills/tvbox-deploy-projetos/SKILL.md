---
name: tvbox-deploy-projetos
description: >-
  Guia operacional para subir, configurar e manter novos projetos (sites, apps web, bancos de dados, bots e servidores multiplayer) na Mini-VPS TV Box respeitando a arquitetura de 1 GB de RAM (PocketBase, Node-RED e Portainer GitOps). Use esta skill sempre que o usuário quiser criar um projeto novo para rodar na TV Box, associar um repositório do GitHub no Portainer, criar tabelas no PocketBase ou fluxos no Node-RED.
---

# 🚀 Deploy de Projetos na Mini-VPS TV Box (Arquitetura 1 GB RAM)

Sempre que o usuário quiser hospedar um projeto novo na TV Box, aplique a **Regra dos 3 Padrões Inteligentes** para garantir que dezenas de projetos rodem 24/7 simultaneamente sem esgotar os 1 GB de RAM.

---

## 🧭 1. Árvore de Decisão: Onde Hospedar o Projeto Novo?

Antes de criar um container Docker pesado, classifique o projeto em um dos 3 padrões abaixo:

| Padrão | Tipo de Projeto | Onde Hospedar | Custo Adicional de RAM |
| :--- | :--- | :--- | :--- |
| **Padrão 1 (Motor Único)** | Site estático, SPA (React/Vite/Vue compilado), Jogo HTML5/JS, PWA com Banco de Dados, Login e Upload de Arquivos | **PocketBase existente** (`/DATA/AppData/pocketbase/pb_public/<projeto>` + Collections com prefixo) | **0 MB** |
| **Padrão 2 (Fluxo Visual)** | Backend de API REST simples, Webhook, Bot de Telegram/Discord, Cronjob/Scraper periódico ou Automação Smart Home | **Node-RED existente** (`:1880`, criando 1 nova aba para o projeto) | **~0.5 MB** |
| **Padrão 3 (Container Dedicado)** | Servidor persistente em tempo real (Jogo Multiplayer WebSocket/Socket.io, servidor Python/Go específico) | **Portainer GitOps** (Container `alpine` dedicado em porta própria `:3001`, `:3002`, etc.) | **~25 a 50 MB** |

---

## 📦 2. Receitas Prontas de `docker-compose.yml` (Portainer GitOps)

### Opção A: Deploy Automático do GitHub para o PocketBase (`0 MB RAM` em execução)
Se o usuário criou um repositório com um site/app (`index.html`, CSS, JS) e quer que a TV Box puxe atualizações automaticamente do GitHub a cada 60 segundos:

```yaml
services:
  sync-site:
    image: alpine/git:latest
    container_name: sync-<nome-do-projeto>
    restart: unless-stopped
    entrypoint: /bin/sh
    command: >
      -c "while true; do
            if [ -d /dest/.git ]; then
              cd /dest && git fetch --all -q && git reset --hard origin/main -q;
            else
              rm -rf /dest/* /dest/.[!.]* 2>/dev/null;
              git clone -q https://github.com/jonathanbrum/<nome-do-repo>.git /dest;
            fi;
            sleep 60;
          done"
    volumes:
      - /DATA/AppData/pocketbase/pb_public/<nome-do-projeto>:/dest
```
* **URL final no ar:** `http://<IP_DA_TV_BOX>:8090/<nome-do-projeto>/`

### Opção B: Servidor Node.js Dedicado (`node:20-alpine`)
Para servidores multiplayer ou backends que exigem processo Node próprio:

```yaml
services:
  app:
    image: node:20-alpine
    container_name: <nome-do-projeto>
    restart: unless-stopped
    working_dir: /app
    ports:
      - "<PORTA_EXTERNA>:3000"
    volumes:
      - /DATA/AppData/projetos/<nome-do-projeto>:/app
    command: >
      sh -c "apk add --no-cache git &&
             if [ ! -d /app/.git ]; then
               git clone https://github.com/jonathanbrum/<nome-do-repo>.git /app;
             else
               git fetch --all && git reset --hard origin/main;
             fi &&
             npm install &&
             npm start"
```

---

## 🗄️ 3. Checklist para Banco de Dados no PocketBase (`:8090/_/`)

Sempre que um projeto usar o PocketBase como backend:
1. **Prefixo nas Collections:** Nomeie todas as tabelas do projeto com um prefixo claro (ex.: `fin_transacoes`, `rpg_jogadores`) para manter o banco compartilhado limpo.
2. **Destravar `API Rules`:** Lembre sempre o usuário (ou configure via API) as regras da tabela na aba **API Rules** (por padrão vêm trancadas como `Superusers only`):
   * Público: `""` (vazio, cadeado destravado).
   * Somente usuários logados: `@request.auth.id != ""`.
3. **Conexão no Front-end:**
   * Se o site está hospedado dentro do `pb_public`, use `const pb = new PocketBase(window.location.origin);`.
   * Se está em outra porta, use `const pb = new PocketBase('http://' + window.location.hostname + ':8090');`.

---

## 📝 4. Registro na Documentação

Quando um novo serviço importante ou padrão de deploy for implementado na TV Box:
* Documente a porta utilizada, o caminho em `/DATA/AppData/` e como acessá-lo na Wiki (`docs/`), mantendo o catálogo do servidor sempre atualizado!
