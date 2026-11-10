const http = require('http');
const fs = require('fs');
const path = require('path');

const cleanProjects = [
  {
    id: "casaos",
    nome: "CasaOS (Painel Geral)",
    icone: "🏠",
    categoria: "Sistema",
    status: "online",
    descricao: "Central de controle da TV Box, monitor de RAM/CPU, pastas de rede (NAS) e gestão dos containers.",
    detalhes: "Porta 80 | Base Linux Armbian | Painel do Homelab",
    url_local: "http://tvbox.local",
    url_publica: "https://tvbox.tailb6e36d.ts.net/",
    notas: "Login e senha configurados na instalação inicial."
  },
  {
    id: "filebrowser",
    nome: "File Browser (Drive Pessoal)",
    icone: "📁",
    categoria: "Nuvem & Arquivos",
    status: "online",
    descricao: "Nuvem de arquivos privada e de alta velocidade. Contas para amigos, upload/download e links públicos estilo Google Drive.",
    detalhes: "Porta 8082 | Go nativo | ~17 MB RAM | ⚡ Smart Turbo Gateway",
    url_local: "http://tvbox.local:8082",
    url_publica: "https://tvbox.tailb6e36d.ts.net:8443/turbo/drive",
    notas: "Link fixo permanente que redireciona automaticamente para o Cloudflare em SP!"
  },
  {
    id: "gestor_amigos",
    nome: "Gestor de Amigos & Cotas",
    icone: "👥",
    categoria: "Gestão & Nuvem",
    status: "online",
    descricao: "Painel visual para criar contas de amigos no File Browser com limite de espaço travado no HD (5GB, 10GB, 20GB...) com 1 clique.",
    detalhes: "Porta 1887 | Python 3 nativo | ~2.2 MB RAM | Loop mount ext4",
    url_local: "http://tvbox.local:1887",
    url_publica: "",
    notas: "Cria amigos com disco virtual restrito sem precisar do terminal."
  },
  {
    id: "telap2p",
    nome: "TelaP2P (Live Stream 60 FPS)",
    icone: "🖥️",
    categoria: "WebRTC",
    status: "online",
    descricao: "Compartilhamento de tela e áudio com latência zero e 60 FPS via WebRTC P2P (alternativa leve ao Discord).",
    detalhes: "Porta 8090/tela/ (LAN) e 8443 (Funnel) | Consumo: 0 MB RAM extra",
    url_local: "http://tvbox.local:8090/tela/",
    url_publica: "https://tvbox.tailb6e36d.ts.net:8443/tela/",
    notas: "Senha padrão da sala: 123456"
  },
  {
    id: "wiki",
    nome: "Wiki Docsify (Documentação)",
    icone: "📚",
    categoria: "Documentação",
    status: "online",
    descricao: "Documentação viva e interativa do servidor, com manuais operacionais, arquitetura e dicas de manutenção.",
    detalhes: "Porta 8090/wiki/ | Sincronização GitOps automática (60s)",
    url_local: "http://tvbox.local:8090/wiki/",
    url_publica: "https://tvbox.tailb6e36d.ts.net:8443/wiki/",
    notas: "Repositório sincronizado via container wiki-tvbox-sync."
  },
  {
    id: "controle_ir",
    nome: "Controle Remoto IR & APIs",
    icone: "📡",
    categoria: "Hardware",
    status: "online",
    descricao: "Calibrador em tempo real do sensor infravermelho e central de automações físicas (desligar, reiniciar, limpar RAM).",
    detalhes: "Porta 1886 | sunxi-ir nativo | Python/HTML",
    url_local: "http://tvbox.local:1886",
    url_publica: "",
    notas: "Mapeia botões do controle físico da TV Box para comandos Linux."
  },
  {
    id: "pocketbase",
    nome: "PocketBase (Banco & API)",
    icone: "⚡",
    categoria: "Banco & API",
    status: "online",
    descricao: "Backend tudo-em-um em Go + SQLite. Autenticação, banco em tempo real e hospedagem de sites estáticos.",
    detalhes: "Porta 8090/_/ | Arquivo único SQLite | ~15 MB RAM",
    url_local: "http://tvbox.local:8090/_/",
    url_publica: "",
    notas: "Painel Admin acessível na subpasta /_/"
  },
  {
    id: "nodered",
    nome: "Node-RED (Automação & APIs)",
    icone: "🧩",
    categoria: "Automação",
    status: "online",
    descricao: "Plataforma visual em blocos para criação de endpoints REST, bots de Telegram/Discord e automações.",
    detalhes: "Porta 1880 | NodeJS Alpine | ~60 MB RAM",
    url_local: "http://tvbox.local:1880",
    url_publica: "",
    notas: "Deploy de novos fluxos e rotinas com 1 clique."
  },
  {
    id: "portainer",
    nome: "Portainer (Docker & GitOps)",
    icone: "🐳",
    categoria: "DevOps",
    status: "online",
    descricao: "Gerenciamento visual completo de containers Docker, volumes, redes e Stacks com GitOps do GitHub.",
    detalhes: "Porta 9000 | Portainer CE | ~25 MB RAM",
    url_local: "http://tvbox.local:9000",
    url_publica: "",
    notas: "Acesse Stacks para associar novos repositórios Git."
  },
  {
    id: "cftv",
    nome: "CFTV Dashboard (Câmeras)",
    icone: "📹",
    categoria: "CFTV & Câmeras",
    status: "online",
    descricao: "Monitoramento em tempo real das câmeras (Fundos e Entrada) via WebSockets e protocolo Sofia/XMeye sem nuvem.",
    detalhes: "Porta 3333 | Modo TV (/tv) | Vigia IA (/ia) | ~90 MB RAM",
    url_local: "http://tvbox.local:3333",
    url_publica: "",
    notas: "Modo TV em tela cheia: http://tvbox.local:3333/tv"
  }
];

// 1. Atualizar arquivo local
const localPath = path.resolve(__dirname, '../projetos/hub/hub_projetos.json');
fs.writeFileSync(localPath, JSON.stringify(cleanProjects, null, 2), 'utf8');
console.log('Arquivo local atualizado em:', localPath);

// 2. Enviar para a API da TV Box com UTF-8 perfeito
const payload = JSON.stringify({ projetos: cleanProjects });
const postData = Buffer.from(payload, 'utf8');

const req = http.request({
  hostname: '192.168.1.118',
  port: 8090,
  path: '/api/hub/projetos',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': postData.length
  }
}, (res) => {
  let responseData = '';
  res.on('data', chunk => responseData += chunk);
  res.on('end', () => {
    console.log('Resposta do Servidor TV Box:', responseData);
  });
});

req.on('error', (e) => {
  console.error('Erro ao enviar:', e.message);
});

req.write(postData);
req.end();
