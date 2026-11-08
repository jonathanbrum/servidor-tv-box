# 🖥️ Wiki do Projeto: Servidor Doméstico Linux (TV Box R001 / Allwinner H313)

Bem-vindo à documentação central (Wiki) da transformação de uma **TV Box genérica Android (`R001` / `REDONE`)** em um **Servidor Doméstico Linux (Armbian Bookworm)** com arquitetura de **Boot Híbrido** (Bootloader em Cartão MicroSD de 2 GB + Sistema Operacional em HD Externo USB de 1 TB).

---

## 📌 Painel Rápido do Servidor

| Propriedade | Valor / Especificação |
| :--- | :--- |
| **Hostname** | `x96q-v5-1` |
| **Repositório Oficial (GitHub)** | https://github.com/jonathanbrum/servidor-tv-box |
| **Site da Wiki na TV Box (GitOps)** | `http://<IP_DA_TV_BOX>:8090/wiki/` |
| **Painel de Controle Web (CasaOS)** | `http://<IP_DA_TV_BOX>` |
| **PocketBase (Banco + Auth + API + Hosting)** | `http://<IP_DA_TV_BOX>:8090/_/` (Admin) / `http://<IP_DA_TV_BOX>:8090/` (Sites) |
| **Portainer CE (Deploy Automático GitOps)** | Acessível via ícone no painel do CasaOS |
| **Node-RED (Automação & Fluxos Visuais)** | Acessível via ícone no painel do CasaOS |
| **Comando de Acesso SSH** | `ssh root@<IP_DA_TV_BOX>` |
| **SoC / CPU** | Allwinner H313 (`sun50iw9p1`) Quad-Core Cortex-A53 |
| **Memória RAM** | 1 GB DDR3 (`199 MiB` em uso / `779 MiB` livres) + `2.5 GiB` Swap (`489M` ZRAM + `2G` HD) |
| **Disco de Boot (`/boot`)** | MicroSD 2 GB (`/dev/mmcblk0p1` - `1.7G` montado em `/boot`) |
| **Disco do Sistema (`/`)** | HD Externo USB 1 TB Seagate `Backup+ BK` (`/dev/sda1` - `916G` totais / **`904G` livres**) |
| **Sistema Operacional** | Armbian Unofficial 26.02.0-trunk (Debian 12 Bookworm) - Kernel `6.12.64` |

---

## 📚 Índice da Wiki (Ramificações)

1. **[01 - Hardware e Diagnóstico](docs/01-hardware-e-diagnostico.md)**
   * Identificação real da placa, SoC Allwinner H313, descoberta do padrão DDR3 (`v5.1`) e limitações da Boot ROM de fábrica.
2. **[02 - Instalação do Armbian e Primeiro Boot](docs/02-instalacao-armbian-sd.md)**
   * Seleção da imagem comunitária compatível (`X96q-v5-1`), gravação no cartão MicroSD de 2 GB via Rufus e criação do acesso `root`.
3. **[03 - Rede Ethernet e Acesso Remoto (SSH)](docs/03-rede-e-acesso-ssh.md)**
   * Conexão cabeada, obtenção de IP via DHCP, validação de chave ED25519 e comandos de acesso via Windows PowerShell.
4. **[04 - Armazenamento e Boot Híbrido (SD + HD 1 TB)](docs/04-armazenamento-e-boot-hibrido.md)**
   * Diagnóstico do `lsblk`, reparticionamento do HD de 1 TB (`sda`), migração da raiz (`/`) via `armbian-install` e reparo inicial `fsck`.
5. **[05 - Pós-Instalação, Otimização e Serviços](docs/05-pos-instalacao-e-otimizacao.md)**
   * Liberação de +37 GB extras no `ext4` (`tune2fs`), criação de Swap de 2 GB de segurança e atualização do sistema.
6. **[06 - Arquitetura Home Lab ("Mini-VPS", Smart Home, Git, DB e Jogos)](docs/06-arquitetura-homelab-e-servicos.md)**
   * Painel de Controle Geral (**CasaOS**), servidores de Bancos de Dados, Git próprio (**Gitea**), Automação Residencial (**Home Assistant**), Servidores de Jogos e estratégia para 2 roteadores.
7. **[07 - Deploy Visual "Estilo Vercel / Firebase" em 1 GB de RAM](docs/07-deploy-visual-estilo-vercel.md)** *(📍 Etapa Atual)*
   * Como fazer deploy automático via GitHub (**Portainer GitOps**), banco de dados visual estilo Firebase (**PocketBase** / **Adminer**) e automação visual (**Node-RED**) tudo pelo navegador sem terminal.

---

## 🗺️ Status das Etapas

- [x] **Fase 1:** Identificação de Hardware e Revisão de Placa (`v5.1` DDR3)
- [x] **Fase 2:** Boot do Armbian Minimal via MicroSD de 2 GB
- [x] **Fase 3:** Conexão de Rede Ethernet e Acesso SSH pelo PC
- [x] **Fase 4:** Migração Híbrida Concluída (`/` no HD Seagate de 1 TB + `/boot` no MicroSD de 2 GB)
- [x] **Fase 5:** Otimização pós-instalação concluída (`904 GB` livres, `2.5 GiB` Swap, pacotes atualizados)
- [x] **Fase 6 (Ativa):** Painel **CasaOS + Docker + Portainer + PocketBase + Node-RED** instalados — Configurando serviços (Git, DB, Automação, Jogos)
