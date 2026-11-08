# 06 - Arquitetura Home Lab ("Mini-VPS" Pessoal, Smart Home, Git, DB e Jogos)

[⬅️ Voltar para a Wiki Principal](../README.md) | [⬅️ Etapa Anterior: 05 - Pós-Instalação](05-pos-instalacao-e-otimizacao.md)

---

## 1. A Filosofia do Servidor: "1 TB de Disco + Gestão Inteligente de 1 GB de RAM"

Com **906 GB livres no HD** e **1 GB de RAM física (+ 2,5 GB de Swap total)**, você pode ter **dezenas de servidores e ferramentas instalados ao mesmo tempo** no disco.

Para que a TV Box nunca fique lenta, usamos a arquitetura baseada em **Docker + Painel de Controle Web (CasaOS)**:
* **Serviços 24/7 (Sempre Ligados):** Painel de Controle, Automação Residencial, Arquivos na Rede (NAS).
* **Serviços Sob Demanda (1 Clique Liga/Desliga pelo Navegador):** Vai programar hoje? Liga o contêiner do Banco de Dados e do Git pelo painel web. Vai jogar com os amigos? Pausa o banco de dados com 1 clique e dá "Play" no servidor do jogo!

---

## 2. O Painel de Controle Geral: **CasaOS** — ✅ Instalado!

* **URL de Acesso na Rede Local:** `http://<IP_DA_TV_BOX>` (Primeiro acesso em `http://<IP_DA_TV_BOX>/#/welcome`)

O **CasaOS** transforma o Armbian em uma interface web moderna que funciona exatamente como o painel de uma VPS doméstica:
* 📊 **Monitoramento em Tempo Real:** Gráficos de uso de CPU (H313), Memória RAM, Temperatura e Espaço do HD de 1 TB (`904 GB` livres).
* 📁 **Gerenciador de Arquivos Web + NAS (Samba):** Envie e baixe arquivos pelo navegador ou compartilhe pastas do HD de 1 TB direto no Windows Explorer com 1 clique.
* 🐳 **App Store (Docker Integrado):** Instale bancos de dados, Home Assistant, Gitea, Portainer, qBittorrent, Pi-hole e dezenas de apps com 1 clique, com botões visuais de **Start / Stop / Restart** para cada app.
* 💻 **Terminal integrado no navegador:** Acesse o terminal Linux direto pela página web.

### Comando de Instalação Executado:
```bash
curl -fsSL https://get.casaos.io | bash
```

### 🔥 Dica de Ouro: Expandir a Loja de Apps do CasaOS (de 153 para +400 Apps)
Na tela da **Loja de Apps** (que já vem com **153 apps** nativos), olhe na direita na mesma linha da barra `Pesquisar um aplicativo...` onde está escrito **`153 apps ⌄`**:
1. Clique no botão **`153 apps ⌄`**.
2. Clique em **Adicionar** e cole o repositório comunitário **BigBearCasaOS** (traz centenas de novos servidores prontos, como PocketBase, Node-RED, Gitea, bancos de dados e servidores de jogos):
   ```text
   https://github.com/bigbeartechworld/big-bear-casaos/archive/refs/heads/master.zip
   ```
3. Além disso, o botão azul **`Instalação personalizada`** (no topo direito) permite subir **qualquer imagem Docker do mundo** ou colar qualquer arquivo `docker-compose.yml` dos seus próprios projetos!

---

## 3. Catálogo do que Vamos Rodar na Sua "Mini-VPS"

### 🛠️ A. Desenvolvimento, Git e Bancos de Dados
| Serviço | Função | Consumo Médio de RAM |
| :--- | :--- | :--- |
| **Gitea** ou **Forgejo** | Seu próprio "GitHub particular" (repositórios Git privados, interface web, Issues, Pull Requests). | ~45 MB a 70 MB |
| **PostgreSQL (Alpine)** | Banco de dados relacional profissional para seus projetos. | ~35 MB a 80 MB |
| **MariaDB / MySQL** | Banco de dados clássico para sistemas web/PHP/Node. | ~90 MB a 150 MB |
| **Redis** | Banco em memória para cache e filas. | ~10 MB a 25 MB |
| **PocketBase** | Backend completo (Banco SQLite + Auth + API REST) em um único arquivo em Go. | ~15 MB |
| **Portainer CE** | Gerenciador avançado de contêineres, redes, volumes e logs Docker. | ~40 MB |
| **Code-Server / Webhook** | Ambiente para rodar e testar seus projetos em Python, Node.js, Go, etc. | Sob demanda |

### 🏠 B. Automação Residencial (Smart Home)
| Serviço | Função | Consumo Médio de RAM |
| :--- | :--- | :--- |
| **Home Assistant (Container)** | Central de automação residencial (integra lâmpadas Tuya/SmartLife, Sonoff, Tapo, TVs, sensores, Alexa/Google Home). | ~180 MB a 250 MB |
| **Node-RED** | Automação visual por fluxos (ligar coisas da casa + APIs + bots do Telegram/WhatsApp). | ~60 MB a 90 MB |
| **Mosquitto (MQTT)** | Broker super leve para placas ESP32 / ESP8266 / Sonoff / Tasmota. | ~5 MB a 10 MB |

### 🎮 C. Servidores de Jogos (Compatíveis com ARM64 e 1 GB de RAM)
Como o processador da TV Box é **ARM64 (`aarch64`)** e tem **1 GB de RAM**, o segredo para servidores de jogos é escolher motores otimizados:
* **Minecraft:**
  * **Cuberite:** Servidor de Minecraft escrito em **C++** que consome apenas **~60 a 100 MB de RAM** e voa em TV Box!
  * **Minetest / Luanti Server:** Servidor open-source estilo voxel extremante leve (~40 MB de RAM).
  * **PaperMC (Java):** É possível rodar versões leves/antigas ou com poucos jogadores desligando outros contêineres e alocando `-Xmx650M`.
* **OpenTTD / Freeciv / Wesnoth / Quake 3 (`ioquake3-server`):** Servidores dedicados clássicos que gastam menos de 30 MB de RAM.
* **Seus próprios jogos Multiplayer:** Qualquer servidor de jogo que você criar em **Node.js (Socket.io / Colyseus)**, **Go**, **Rust** ou **Python** vai rodar com folga absurda!

---

## 4. Rede: Dois Roteadores e IP Fixo / Acesso Externo

Como você mencionou ter **um roteador principal (da operadora)** e **o seu roteador secundário**, temos duas abordagens excelentes:
1. **IP Fixo Local (LAN):** Quando você decidir em qual roteador a TV Box vai morar em definitivo, fixamos o IP dela diretamente na amarração **DHCP / MAC Address** do roteador (ou via `nmtui` no Armbian).
2. **Acesso de Qualquer Lugar (Mesmo atrás de 2 roteadores / CGNAT):**
   * Instalando o **Tailscale** ou **Cloudflare Tunnel (`cloudflared`)** na TV Box, você consegue acessar seu painel, seus sites, seu Git e sua automação residencial pelo celular (no 4G/5G) ou de qualquer lugar **sem precisar abrir portas nos 2 roteadores**!
