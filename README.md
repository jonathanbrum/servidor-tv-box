# 🚀 Central da Mini-VPS — Guia Prático dos Apps

Bem-vindo ao painel de documentação do seu servidor pessoal! Aqui o foco é **como usar os aplicativos instalados no seu dia a dia** para subir projetos do GitHub, criar bancos de dados, hospedar sites e criar automações sem complicação.

---

## ⚡ O que Você Quer Fazer Agora? (Atalhos Rápidos)

| Quero fazer... | Qual App usar? | Guia Passo a Passo |
| :--- | :--- | :--- |
| **Associar um repositório novo do GitHub** (Deploy Automático) | **Portainer** (`Stacks` ➡️ `Repository`) | [👉 Abrir Manual do Portainer](docs/08-manual-portainer-deploy-github.md) |
| **Criar tabelas no Banco de Dados, Login ou subir um Site HTML/JS** | **PocketBase** (`:8090/_/`) | [👉 Abrir Manual do PocketBase](docs/09-manual-pocketbase-banco-e-api.md) |
| **Criar uma API rápida, Bot (Telegram/Discord) ou Automação** | **Node-RED** (`:1880`) | [👉 Abrir Manual do Node-RED](docs/10-manual-casaos-e-nodered.md#-parte-2-como-usar-o-node-red-backends-bots-e-automação-sem-código-pesado) |
| **Acessar meus sites e painéis pela Internet (sem abrir portas)** | **Cloudflare Tunnel** (`Zero Trust`) | [👉 Abrir Manual do Cloudflare](docs/11-manual-cloudflare-tunnel.md) |
| **Ligar/Desligar apps (RAM) ou abrir o HD de 1 TB no Windows** | **CasaOS** (`Painel Principal`) | [👉 Abrir Manual do CasaOS](docs/10-manual-casaos-e-nodered.md#-parte-1-como-usar-o-casaos-no-dia-a-dia-httpip_da_tv_box) |
| **Deixar 10, 20 ou 30 projetinhos ON ao mesmo tempo** | **Arquitetura Multi-Projetos** | [👉 Ver Regras de Ouro de RAM](docs/07-deploy-visual-estilo-vercel.md) |

---

## 🛠️ Resumo Rápido de Uso Diário

### 1. 🐳 Portainer — Subir um Projeto Novo do GitHub
1. Coloque um arquivo `docker-compose.yml` no seu repositório do GitHub (copie o modelo pronto no [Manual do Portainer](docs/08-manual-portainer-deploy-github.md)).
2. No Portainer, vá em **`Stacks`** ➡️ **`+ Add stack`** ➡️ selecione **`Repository`**.
3. Cole a URL do GitHub, mude a branch para **`refs/heads/main`**, ative **`GitOps updates`** e clique em **`Deploy the stack`**.

### 2. ⚡ PocketBase — Criar Banco de Dados para um Projeto Novo
1. Acesse `http://<IP_DA_TV_BOX>:8090/_/` e clique em **`+ New collection`**.
2. Dê o nome com o prefixo do seu projeto (ex.: `jogo_ranking`, `loja_itens`) e adicione as colunas (`+ New field`).
3. **Importante:** Vá na aba **`API Rules`** da tabela e destrave os cadeados (`Unlock`) das ações que seu site precisa acessar (deixe vazio `""` para acesso público ou `@request.auth.id != ""` para usuários logados).
4. Clique em **`</> API Preview`** no canto superior direito para copiar o código JavaScript pronto pro seu site!
   *(Veja exemplos completos no [Manual do PocketBase](docs/09-manual-pocketbase-banco-e-api.md)).*

### 3. 🧩 Node-RED — Criar Backends, Rotinas e Bots Visuais
1. Abra o **Node-RED** pelo CasaOS e crie uma **nova aba (`+`)** para o seu projeto.
2. Arraste um bloco de entrada (`http in` ou `inject`), ligue em um bloco de lógica (`function` ou `http request`) e em um bloco de saída (`http response` ou `debug`).
3. Clique no botão vermelho **`Deploy`** no topo direito para colocar no ar na hora!
   *(Veja o passo a passo no [Manual do CasaOS & Node-RED](docs/10-manual-casaos-e-nodered.md)).*

### 4. 🏠 CasaOS — Controle Geral, Arquivos e Pasta na Rede (NAS)
* **Pausar/Iniciar Projeto:** Passe o mouse no ícone do app ➡️ **3 pontinhos (`⋮`)** ➡️ **Desligar / Iniciar**.
* **Subir Site Sem GitHub (Arrastar e Soltar):** Abra o app **`Files`** ➡️ `AppData` ➡️ `pocketbase` ➡️ `pb_public` ➡️ crie uma pasta `meu-site` e jogue seu `index.html` lá dentro. Ele abre na hora em `http://<IP_DA_TV_BOX>:8090/meu-site/`!

### 5. ☁️ Cloudflare Tunnel — Liberar Acesso Externo com HTTPS
1. No painel [dash.cloudflare.com](https://dash.cloudflare.com) ➡️ **Zero Trust** ➡️ **Networks** ➡️ **Tunnels**.
2. Clique no seu túnel ➡️ **Configure** ➡️ **Public Hostname** ➡️ **+ Add a public hostname**.
3. Escolha o subdomínio e aponte para `HTTP` `127.0.0.1:<PORTA>` (ex.: `127.0.0.1:80` para CasaOS, `127.0.0.1:8090` para PocketBase).
   *(Veja o passo a passo ilustrado no [Manual do Cloudflare Tunnel](docs/11-manual-cloudflare-tunnel.md)).*

---

<details>
<summary><strong>🔧 Arquivo Técnico: Como a TV Box foi Transformada em Servidor (Clique para expandir)</strong></summary>

<br>

Toda a documentação técnica de baixo nível (caso algum dia você precise regravar o sistema, consultar como foi feito o Boot Híbrido no HD de 1 TB ou revisar as otimizações de memória) está preservada abaixo:

### Especificações da Máquina
* **Placa / SoC:** TV Box `R001` (`X96Q v5.1`) — Allwinner H313 Quad-Core ARM64
* **Memória:** 1 GB DDR3 + `2.5 GiB` Swap (`489M` ZRAM + `2G` Swapfile no HD)
* **Armazenamento Híbrido Blindado:** Boot (`/boot`) em MicroSD de 2 GB + Sistema (`/`) em HD Externo USB Seagate `ST1000LM024` — **Blindado em 300 GB** (`286 GB` livres nas trilhas iniciais 100% saudáveis via *Short-Stroking* + Quirk USB `0bc2:a003:u`)
* **Sistema Base:** Armbian Bookworm Minimal (Kernel `6.12.64`)

### Capítulos do Histórico de Instalação
1. [01 - Hardware e Diagnóstico da Placa (DDR3 v5.1)](docs/01-hardware-e-diagnostico.md)
2. [02 - Gravação do Armbian no Cartão SD de 2 GB](docs/02-instalacao-armbian-sd.md)
3. [03 - Rede Ethernet e Acesso SSH](docs/03-rede-e-acesso-ssh.md)
4. [04 - Particionamento, Boot Híbrido e Blindagem do HD em 300 GB (Short-Stroking + Correção UAS)](docs/04-armazenamento-e-boot-hibrido.md)
5. [05 - Pós-Instalação, Swap, Energia (Ligar/Desligar) e Guia de Clonagem Futura](docs/05-pos-instalacao-e-otimizacao.md)
6. [06 - Catálogo de Expansão (Servidores de Jogos, Gitea, Smart Home)](docs/06-arquitetura-homelab-e-servicos.md)
7. [Resumo Inicial do Projeto](resumo_do_projeto_r001_tv_box_para_servidor_linux.md)

</details>
