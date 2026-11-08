# 🧠 Regras do Agente — Projeto Mini-VPS TV Box (`R001` / `X96Q v5.1`)

Este repositório é a **Central de Comando, Documentação Viva (Wiki Docsify) e Automação de Manutenção** do servidor doméstico Linux rodando na TV Box `R001` (`X96Q v5.1`, Allwinner H313 Quad-Core ARM64, 1 GB DDR3 RAM).

Sempre que atuar neste workspace, você (Agente) deve seguir rigorosamente as diretrizes abaixo para que o projeto se mantenha um **sistema vivo que se auto-documenta e evolui suas próprias Skills de manutenção**.

---

## 📌 1. Regra de Documentação Viva Contínua (Auto-Registro)

Sempre que você e o usuário:
* Descobrirem um comportamento novo, solução de bug (*troubleshooting*), ajuste de kernel/hardware ou comando útil de manutenção na TV Box;
* Instalarem um novo serviço/container, criarem uma nova automação no Node-RED, uma nova estrutura no PocketBase ou subirem um novo projeto via Portainer GitOps;
* Modificarem portas, caminhos de volume (`/DATA/AppData/...`), otimizações de memória RAM/Swap ou configurações de rede;

**Você DEVE proativamente:**
1. **Atualizar a documentação correspondente** na pasta `docs/` (ou criar um novo capítulo `docs/XX-nome-do-guia.md` se for um tema inédito).
2. **Manter a navegação sincronizada:** Se criar um documento novo ou alterar um atalho importante, atualize imediatamente o `_sidebar.md` e a tabela de atalhos rápidos do `README.md` para que a Wiki web (Docsify em `index.html`) reflita a mudança.
3. **Preservar o histórico técnico:** Nunca apague explicações de baixo nível ou diagnósticos passados (como o Boot Híbrido ou o *Short-Stroking* do HD de 1 TB); mantenha os guias práticos no topo e os detalhes técnicos organizados.

---

## 🛠️ 2. Regra de Evolução de Skills (`.agents/skills/`)

Este projeto utiliza **Skills do Antigravity** (em `.agents/skills/<nome-da-skill>/SKILL.md`) como *runbooks* operacionais para auxiliar na manutenção, diagnóstico e deploy na TV Box.

**Quando criar ou atualizar uma Skill:**
* Sempre que uma tarefa operacional se repetir ou envolver uma sequência específica de passos técnicos (ex.: diagnosticar saúde do HD e memória via SSH, criar um novo deploy GitOps, fazer backup do PocketBase/Node-RED, configurar túneis de rede ou recuperar o boot), **crie uma nova Skill ou enriqueça uma Skill existente** em `.agents/skills/`.
* Toda Skill deve conter instruções claras, comandos exatos testados na arquitetura `ARM64` (`aarch64`) com 1 GB de RAM e etapas de validação.

### Skills Atuais do Projeto:
* **`tvbox-manutencao-e-diagnostico`** (`.agents/skills/tvbox-manutencao-e-diagnostico/SKILL.md`): Runbook completo para inspeção de saúde via SSH (`free -h`, `df -h`, `smartctl`, `docker stats`), limpeza de memória/logs, verificação do Quirk USB (`0bc2:a003:u`) e recuperação de boot.
* **`tvbox-deploy-projetos`** (`.agents/skills/tvbox-deploy-projetos/SKILL.md`): Guia de arquitetura para hospedar novos projetos na TV Box respeitando o limite de 1 GB de RAM (Padrão 1: PocketBase `pb_public` 0 MB RAM; Padrão 2: Node-RED ~0.5 MB RAM; Padrão 3: Portainer GitOps Alpine).
* **`tvbox-gestao-conhecimento`** (`.agents/skills/tvbox-gestao-conhecimento/SKILL.md`): Procedimento padrão para documentar novas descobertas na Wiki Docsify, higienizar dados sensíveis e sincronizar com o GitHub/TV Box.

---

## 🔒 3. Segurança e Privacidade (Sanitização Obrigatória)

Este repositório é sincronizado com o GitHub público (`jonathanbrum/servidor-tv-box`) e puxado automaticamente pela TV Box a cada 60 segundos no container `wiki-tvbox-sync`. Portanto:
1. **NUNCA escreva senhas reais, tokens, chaves privadas ou o IP real privado** nos arquivos rastreados pelo Git (`README.md`, `docs/*.md`, `_sidebar.md`, `.agents/skills/**`).
2. Nos arquivos públicos de documentação e skills, utilize sempre os placeholders padronizados:
   * `<IP_DA_TV_BOX>` para o endereço IP do servidor;
   * `<SENHA_ROOT>` ou `<SUA_SENHA>` para credenciais;
   * `<FINGERPRINT_DO_SERVIDOR>` para chaves SSH.
3. Quando precisar consultar o IP real ou credenciais para executar comandos SSH ou testes na máquina do usuário, leia o arquivo local **`CREDENCIAIS_LOCAIS.md`** (que está protegido no `.gitignore` e nunca sobe para o GitHub).

---

## ⚙️ 4. Restrições de Hardware e Arquitetura (Contexto Permanente)

Ao sugerir qualquer código, comando Linux ou container Docker para este servidor, respeite sempre a anatomia física da máquina:
* **SoC / Arquitetura:** Allwinner H313 Quad-Core Cortex-A53 (`aarch64` / `arm64`). Só utilize imagens Docker compatíveis com `linux/arm64` (prefira sempre variantes `-alpine`).
* **Memória RAM:** `1 GB DDR3` (`978 MiB` úteis) + `489 MiB` ZRAM (prioridade 100) + `2 GiB` Swapfile no HD (`/swapfile`, prioridade 5). Evite serviços pesados em Java/ pesados em idle; priorize a Tríade Visual já instalada (**CasaOS** + **Portainer** + **PocketBase** + **Node-RED**).
* **Armazenamento Híbrido Blindado:**
  * `/boot` reside no **Cartão MicroSD de 2 GB** (`/dev/mmcblk0p1`). **Regra Crítica do U-Boot:** O arquivo `/boot/armbianEnv.txt` **DEVE sempre terminar com uma linha em branco (`\n`)**, caso contrário o U-Boot ignora a última linha (onde fica o quirk USB)!
  * `/` (Raiz e `/DATA`) reside no **HD Externo USB Seagate 1 TB (`ST1000LM024`)** em `/dev/sda1`, **blindado via *Short-Stroking* nos primeiros 300 GB** (`295 GB` formatados em `ext4`) para isolar fisicamente setores defeituosos após a marca de 371 GB, operando com o Quirk USB `0x0bc2:0xa003:u` (desativando `uas` em favor de `usb-storage`).
