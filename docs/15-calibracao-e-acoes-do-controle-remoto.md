# 📡 Manual do Controle Remoto IR — Calibrador e Central de Ações

A TV Box `R001` (`X96Q v5.1`) possui um receptor infravermelho nativo integrado à placa mãe (`sunxi-ir`). Com a **Central do Controle Remoto Web**, você conta com um controle virtual interativo idêntico ao físico, gerenciador visual da trava de segurança, catálogo de APIs/ações locais e controle do LED físico de status frontal.

---

## 🎯 1. Como Acessar a Central do Controle Remoto

Você pode abrir o painel de calibragem e ações de duas formas:

1. **Pelo CasaOS:** Clique no atalho **"Controle Remoto"** na tela inicial do CasaOS (`http://tvbox.local` ou `http://<IP_DA_TV_BOX>`).
2. **Pelo Link Direto:** Acesse no navegador:
   - **`http://tvbox.local:1886`** (ou `http://<IP_DA_TV_BOX>:1886`).

---

## 🎮 2. Controle Virtual Interativo (Gêmeo Digital)

À esquerda da tela existe um controle simulado reproduzindo fielmente o layout do controle físico:

- **Botão Power ⏻ vermelho:** Ação de desligamento protegido.
- **Bloco TV Control:** Teclas `SET`, `IN`, `VOL-`, `VOL+` e `TV Power`.
- **Linha de Cores:** `SETUP` (laranja), `APP` (verde), `VOL-` (amarelo) e `VOL+` (azul).
- **Navegação & D-pad:** `Home` 🏠, `Back` ↩️, setas (`▲`, `▼`, `◀`, `▶`), `OK`, `Menu` ☰ e `Mouse` 🖱️.
- **Teclado Numérico 3x4:** `1` a `9`, `Mute` 🔇, `0` e `Delete` ⌫.

> Qualquer clique no controle virtual envia o comando ao servidor exatamente como o controle físico, piscando o LED virtual e o LED físico frontal da TV Box!

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

## 💡 5. Controle do LED Físico Frontal (Feedback de Standby e IR)

- **Circuito de Hardware:** No Allwinner H313 (`X96Q v5.1`), o LED vermelho é controlado pelo pino `PH6` (`gpio-230`) através da interface `/sys/class/leds/red:disk-activity/brightness`. O circuito opera em **Active Low** (lógica invertida: `0` = Aceso, `1` = Apagado).
- **Feedback ao Receber Sinal:** A cada clique no controle remoto (ou no controle virtual), o daemon pulsa o LED vermelho por 120ms, dando a resposta tátil que existia no Android original.
- **Indicação de Standby / Desligado:** Ao disparar o comando de desligar o servidor, o sistema trava o LED vermelho em `0` (aceso fixo). O LED permanece 100% vermelho enquanto a placa estiver em standby!
- **Aba de Diagnóstico de Luzes:** Permite ligar, desligar, piscar 5 vezes ou ativar o modo de feedback automático do kernel (`rc-feedback`).

---

## 🛠️ 6. Anatomia Técnica e Serviço em Background

- **Sensor e Driver:** O sensor `sunxi-ir` opera no barramento SoC da Allwinner H313 e entrega os eventos brutos em `/dev/input/event5`.
- **Protocolo de Rádio IR:** Configurado exclusivamente para o protocolo **`nec`** (`ir-keytable -p nec`), eliminando ruídos.
- **Filtro de Repetição (Debounce):** Configurado em `300ms`, evitando disparos repetidos acidentais.
- **Daemon do Sistema (`systemd`):**
  - O serviço roda em background como `tvbox-remote-hub.service`.
  - As ações funcionam **24/7 mesmo se nenhum navegador estiver aberto**.
  - Consome apenas **~13-15 MB de memória RAM**, respeitando rigorosamente o limite de 1 GB da TV Box.

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
