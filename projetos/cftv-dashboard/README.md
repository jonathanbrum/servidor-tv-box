# 📹 CFTV Dashboard Local

Central de monitoramento web moderna, leve e 100% local para visualização em tempo real das câmeras de segurança (**Fundos** e **Entrada**). Funciona diretamente no navegador (Chrome, Edge, Firefox, celular) sem ActiveX, sem plugins legados e sem dependência da nuvem.

---

## ⚡ Como Rodar o Projeto

### 1. Pré-requisitos
- [Node.js](https://nodejs.org/) (versão 18 ou superior).

### 2. Configurar o `.env`
Se ainda não existir, crie o arquivo `.env` na raiz do projeto (ou copie de `.env.example`):

```bash
cp .env.example .env
```

Edite o `.env` com os IPs das suas câmeras:
```env
PORT=3333

CAM1_NAME=Fundos
CAM1_HOST=192.168.1.134
CAM1_PORT=34567
CAM1_USER=admin
CAM1_PASS=

CAM2_NAME=Entrada
CAM2_HOST=192.168.0.102
CAM2_PORT=34567
CAM2_USER=admin
CAM2_PASS=
```

### 3. Instalar as Dependências
No terminal, na pasta do projeto:
```bash
npm install
```

### 4. Iniciar o Servidor
```bash
npm start
```
*(Para modo de desenvolvimento com auto-reload: `npm run dev`)*

### 5. Acessar o Dashboard
- **No seu computador:**
  ```text
  http://localhost:3333
  ```
- **Na Smart TV (Navegador da TV / TV Box):**
  ```text
  http://192.168.1.150:3333/tv
  ```
  *(Abre diretamente no Modo TV: 100% tela cheia, sem barras, OSD grande legível à distância e anti-descanso de tela).*

---

## 🎮 Controles da Interface

- **📺 Modo Smart TV:** Botão no topo ou rota direta `/tv`. Otimizado para controle remoto, 100% tela cheia, sem barras ou rolagem, e anti-sleep (Wake Lock).
- **📸 Foto (PNG):** Captura instantânea em alta resolução do quadro atual e baixa direto no computador.
- **🔍 Zoom (+ / - / 1x):** Zoom digital interativo por câmera com suporte a arrastar (pan).
- **⛶ Tela Cheia:** Clique no botão "Maximizar" ou dê **duplo clique** sobre o vídeo da câmera.
- **📡 Diagnóstico de Rede:** Botão no cabeçalho ("Topologia & Rede") para testar conectividade e latência em tempo real.

---

## 📁 Estrutura do Projeto

```text
cftv-dashboard/
├── server/
│   ├── index.js            # Servidor Express HTTP, rotas da API e WebSockets
│   ├── config.js           # Leitura e sanitização das variáveis de ambiente (.env)
│   ├── stream-relay.js     # Motor de streaming WebSocket em tempo real
│   └── xmeye-client.js     # Cliente nativo do protocolo Sofia / DVR-IP (porta 34567)
├── public/
│   ├── index.html          # Interface do Dashboard (layout HUD Dark CCTV)
│   ├── css/style.css       # Estilização moderna responsiva
│   └── js/
│       ├── app.js          # Lógica da interface e injeção dinâmica via /api/config
│       └── player.js       # Player acelerado por hardware (Canvas + WebSocket)
├── DOCUMENTACAO.md         # Documentação técnica completa (rede, topologia e protocolos)
├── .env                    # Configurações locais ativas (ignorado no git)
├── .env.example            # Modelo de variáveis de ambiente
└── package.json            # Dependências e scripts de execução
```

---

## 📖 Documentação Técnica Completa

Para detalhes aprofundados sobre:
- Topologia de rede e os **3 roteadores em cascata** (Claro, TP-Link 1 e TP-Link Archer C50);
- Regra de **Port Forwarding** para acesso à Câmera 2;
- Protocolo binário **Xiongmai Sofia (porta 34567 vs RTSP 554)**;
- Especificação completa dos endpoints da API REST e WebSockets;

Consulte o arquivo: **[DOCUMENTACAO.md](DOCUMENTACAO.md)**.
