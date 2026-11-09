# 📡 Manual do Controle Remoto IR — Calibrador e Central de Ações

A TV Box `R001` (`X96Q v5.1`) possui um receptor infravermelho nativo integrado à placa mãe (`sunxi-ir`). Com a **Central do Controle Remoto Web**, você conta com um controle virtual interativo idêntico ao físico, gerenciador visual da trava de segurança, catálogo de APIs/ações locais e controle do LED físico de status frontal.

---

## 🎯 1. Como Acessar a Central do Controle Remoto

Você pode abrir o painel de calibragem e ações de duas formas:

1. **Pelo CasaOS:** Clique no atalho **"Controle Remoto"** na tela inicial do CasaOS (`http://tvbox.local` ou `http://<IP_DA_TV_BOX>`).
2. **Pelo Link Direto:** Acesse no navegador:
   - **`http://tvbox.local:1886`** (ou `http://<IP_DA_TV_BOX>:1886`).

---

## 🎮 2. Controle Virtual Interativo & Mapeamento Inteligente

À esquerda da tela existe um controle simulado reproduzindo fielmente o layout do controle físico:

- **Botão Power ⏻ vermelho:** Ação de desligamento protegido.
- **Bloco TV Control:** Teclas `SET`, `IN`, `VOL-`, `VOL+` e `TV Power`.
- **Linha de Cores:** `SETUP` (laranja), `APP` (verde), `VOL-` (amarelo) e `VOL+` (azul).
- **Navegação & D-pad:** `Home` 🏠, `Back` ↩️, setas (`▲`, `▼`, `◀`, `▶`), `OK`, `Menu` ☰ e `Mouse` 🖱️.
- **Teclado Numérico 3x4:** `1` a `9`, `Mute` 🔇, `0` e `Delete` ⌫.

### ✨ Indicadores Visuais de Pareamento (Pontos Verdes):
- Todos os botões do controle virtual que já possuem mapeamento salvo recebem automaticamente um **ponto verde luminoso** no canto superior direito e borda realçada.
- Você bate o olho no simulador e sabe exatamente quais teclas já foram configuradas e quais faltam!

### 🎯 Como Mapear Teclas Sem Atrito (Dois Fluxos Suportados):
1. **Fluxo A — Clicar no Controle Virtual primeiro:**
   - Clique no botão desejado no simulador (ex: `1`). Ele ganha destaque ciano e o campo "Nome do Botão" é preenchido automaticamente como `"1"`.
   - Aponte o controle físico para a TV Box e aperte a tecla `1`. O código hex (ex: `0x101`) é capturado instantaneamente no campo Scancode **sem apagar nem sobrescrever o nome**.
   - Aperte **Enter** ou clique em **"💾 Salvar Mapeamento"**. O botão ganha o ponto verde na hora!
2. **Fluxo B — Apertar o Controle Físico primeiro:**
   - Aponte o controle para a TV Box e aperte qualquer botão. O código hex é preenchido no Scancode.
   - Em seguida, clique no botão correspondente no simulador (ex: `Menu`). O sistema associa o código capturado à tecla selecionada sem apagar o Scancode!
   - Aperte **Enter** ou clique em **"💾 Salvar Mapeamento"**.

---

## 🔐 3. Trava de Segurança por Sequência (Anti-Acidentes)

Como TV Boxes compartilham códigos infravermelhos com TVs da sala (como LG ou Samsung), o sistema vem blindado com uma **Sequência de Desbloqueio** antes de executar ações críticas (como desligar ou reiniciar):

### Dois Modos Fáceis de Gravar a Sequência:

1. **🖱️ Modo 1: Clicar no Controle Virtual:**
   - Clique em **"▶️ Gravar Clicando no Controle"**. O controle virtual se acenderá em ciano.
   - Clique nos botões na ordem desejada (ex: `1`, `2`, `3` ou `APP`, `OK`). As etiquetas aparecem em tempo real na tela.
   - Clique em **"💾 Salvar Esta Sequência"**.
2. **🔴 Modo 2: Gravar com o Controle Real:**
   - Clique em **"🔴 Gravar com Controle Real"**.
   - Aponte o controle físico para a TV Box e pressione as teclas. O receptor IR captura cada sinal e adiciona à sequência na hora!
   - Clique em **"💾 Salvar Esta Sequência"**.

### Como Funciona o Desbloqueio no Dia a Dia:

- Quando o servidor recebe a sequência correta (seja pelo controle físico ou clicando no simulador), a trava se abre instantaneamente.
- O topo da tela fica **verde com contador regressivo** (`🔓 DESBLOQUEADO (15s restantes)`).
- **Feedback Físico no LED Bicolor da TV Box:** Enquanto o controle estiver desbloqueado, a luz frontal da TV Box **pisca suavemente alternando entre Vermelho e Azul** a cada ~450ms. O indicador virtual no topo da tela pisca em sincronia exata!
- Quando os 15 segundos terminam (ou ao clicar em "Bloquear Agora"), a TV Box volta automaticamente a ficar **100% AZUL contínua**.
- Durante esses 15 segundos, qualquer ação protegida (como Power) é autorizada e executada com segurança!

---

## ⚡ 4. Catálogo de Funções & APIs Locais

A Central possui uma área dedicada para gerenciar todas as automações e APIs do servidor:

1. **Ações do Sistema Pré-configuradas:**
   - 🛑 **Desligar Servidor (`poweroff`)**: Executa `sync` duplo, desliga o Linux com segurança e mantém o LED vermelho aceso fixo (Standby).
   - 🔄 **Reiniciar TV Box (`reboot`)**: Reinicia o sistema operacional.
   - 🧹 **Limpar Memória RAM (`drop_caches`)**: Executa `echo 3 > /proc/sys/vm/drop_caches`.
2. **APIs e Contêineres Locais:**
   - 🖥️ **Ligar/Desligar TelaP2P**: Alterna o contêiner Docker `tela` (WebRTC).
   - 🧩 **Webhook Node-RED**: Dispara `http://127.0.0.1:1880/api/remote-action`.
3. **Criar Nova Ação ou API Personalizada (`➕ Nova API / Ação`):**
   - Você pode cadastrar qualquer endpoint HTTP (`GET`), contêiner Docker (`start`/`stop`) ou script Bash customizado.
   - Cada ação na biblioteca possui um botão **⚡ Testar** para validar a execução direto pelo navegador antes de associar a qualquer botão físico!

---

## 💡 5. Controle do LED Físico Frontal Bicolor (Azul & Vermelho)

A placa da TV Box `X96Q v5.1` possui um LED frontal duplo (**Bicolor**) comutado pelo pino **`PH5` (GPIO 229)** do SoC Allwinner H313, controlado nativamente em Python via `python3-libgpiod` (`gpiochip0`):

- **Lógica de Hardware Complementar:**
  - **Pino 229 = `1` (HIGH) ➔ LED AZUL:** Indica que o sistema Linux está ligado e operando normalmente.
  - **Pino 229 = `0` (LOW) ➔ LED VERMELHO:** Indica modo **Standby / Desligado**.
- **Feedback Visual de Sinal IR:** A cada comando recebido do controle remoto (ou clicado no simulador web), o daemon pulsa o pino para `0` (Vermelho) por 120ms e retorna para `1` (Azul). Esse comportamento reproduz exatamente o sinal visual original do Android de fábrica!
- **Indicação de Standby / Desligamento:** Ao executar o comando de desligar (`poweroff`), o daemon aciona o pino em `0` (Vermelho fixo) antes de desmontar os discos, mantendo a TV Box em standby com a luz vermelha contínua.
- **Aba "💡 Luzes Bicolor" no Painel Web:** Permite testar manualmente as cores:
  - 🔵 **Deixar Azul:** Força estado ativo normal (`val = 1`).
  - 🔴 **Deixar Vermelho:** Força estado de repouso (`val = 0`).
  - ✨ **Simular Piscar IR:** Dispara o pulso de 120ms (Azul ➔ Vermelho ➔ Azul).
  - 🚨 **Alternar Cores 4x:** Efeito de alarme/alerta alternando azul e vermelho.

---

## 🛠️ 6. Anatomia Técnica e Serviço em Background

- **Sensor e Driver:** O sensor `sunxi-ir` opera no barramento SoC da Allwinner H313 e entrega os eventos brutos em `/dev/input/event5`.
- **Protocolo de Rádio IR:** Configurado exclusivamente para o protocolo **`nec`** (`ir-keytable -p nec`), eliminando ruídos.
- **Filtro de Repetição (Debounce):** Configurado em `300ms`, evitando disparos repetidos acidentais.
- **Servidor Web Dual-Stack (IPv4 + IPv6):** O daemon roda um servidor HTTP multithread assíncrono em `[::]:1886` com `IPV6_V6ONLY = 0`, garantindo conexão instantânea sem timeouts seja resolvido via IPv4 (`http://<IP_DA_TV_BOX>:1886`) ou via mDNS IPv6 do Windows (`http://tvbox.local:1886`).
- **Daemon do Sistema (`systemd`):**
  - O serviço roda em background como `tvbox-remote-hub.service`.
  - As ações e o controle do LED funcionam **24/7 mesmo se nenhum navegador estiver aberto**.
  - Consome apenas **~11-13 MB de memória RAM**, respeitando rigorosamente o limite de 1 GB da TV Box.

---

## 🩺 7. Comandos de Manutenção via SSH

```bash
# Ver status do serviço
systemctl status tvbox-remote-hub.service

# Reiniciar o serviço
systemctl restart tvbox-remote-hub.service

# Inspecionar arquivo de configurações e botões salvos
cat /etc/tvbox-remote/config.json

# Testar pulso do LED vermelho manualmente
echo 0 > /sys/class/leds/red:disk-activity/brightness && sleep 0.2 && echo 1 > /sys/class/leds/red:disk-activity/brightness
```
