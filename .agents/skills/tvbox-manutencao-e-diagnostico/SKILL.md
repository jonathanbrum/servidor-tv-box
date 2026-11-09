---
name: tvbox-manutencao-e-diagnostico
description: >-
  Runbook completo para manutenção preventiva, diagnóstico de saúde (RAM, Swap, ZRAM, S.M.A.R.T. do HD Seagate de 1 TB blindado em 300 GB, temperatura e containers Docker) e resolução de problemas via SSH no servidor Linux TV Box (R001 / X96Q v5.1 Armbian). Use esta skill sempre que o usuário pedir para verificar o status do servidor, investigar lentidão, checar o HD, limpar memória/disco ou realizar manutenção na TV Box.
---

# 🛠️ Manutenção e Diagnóstico — Servidor TV Box (`R001` / `X96Q v5.1`)

Use este guia passo a passo sempre que precisar inspecionar, diagnosticar ou fazer manutenção preventiva no servidor Linux da TV Box.

## 🔑 1. Como Obter o IP e Conectar via SSH

1. **Obter credenciais locais:** Antes de conectar, leia o arquivo `CREDENCIAIS_LOCAIS.md` na raiz do workspace para identificar o `<IP_DA_TV_BOX>` atual (nunca exponha senhas ou o IP privado em arquivos públicos rastreados pelo Git).
2. **Conexão SSH:**
   ```powershell
   ssh root@<IP_DA_TV_BOX>
   ```

---

## 🩺 2. Check-up Rápido de Saúde (Comando Único)

Para ter uma visão completa da máquina em 2 segundos, execute via SSH:

```bash
echo "=== MEMORIA E SWAP ===" && free -h && \
echo -e "\n=== DISCO E BOOT HIBRIDO ===" && df -h / /boot && lsblk && \
echo -e "\n=== TEMPERATURA E UPTIME ===" && uptime && cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null && \
echo -e "\n=== CONTAINERS RODANDO ===" && docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
```

### O que validar no resultado:
* **Memória (`free -h`):**
  * Total: `~978Mi`.
  * `available` deve estar saudável (idealmente `> 250Mi`).
  * Swap total deve ser **`2.5Gi`** (`489M` ZRAM de prioridade 100 + `2.0G` `/swapfile` de prioridade 5).
* **Partições (`df -h` e `lsblk`):**
  * `/` deve estar montado em **`/dev/sda1`** com tamanho **`~295G`** (partição de `300G` via *Short-Stroking* no HD de 1 TB).
  * `/boot` deve estar montado em **`/dev/mmcblk0p1`** (Cartão MicroSD de 2 GB).
* **Temperatura (`thermal_zone0/temp`):**
  * O valor dividido por 1000 indica os graus Celsius (ex.: `52000` = `52°C`). Entre `40°C` e `68°C` é normal para o Allwinner H313.

---

## 💾 3. Diagnóstico do HD Externo Seagate 1 TB (Blindado em 300 GB)

O HD (`Seagate ST1000LM024`, USB ID `0bc2:a003`) depende de duas proteções críticas que nunca podem ser desfeitas:
1. **Quirk USB (`usb-storage` em vez de `uas`):** Evita travamentos de fila SCSI (`uas_eh_abort_handler`).
2. **Isolamento *Short-Stroking* em 300 GB:** A partição `/dev/sda1` vai apenas até a marca de 300 GB (zona 100% limpa), mantendo os setores defeituosos (após 371 GB) fora de uso.

### Como verificar a saúde S.M.A.R.T. e erros USB:
```bash
# 1. Verificar se o Quirk USB está ativo (deve mostrar Driver=usb-storage, NUNCA Driver=uas)
usb-devices | grep -A 6 -B 2 "0bc2"

# 2. Verificar se há erros recentes de disco no kernel
dmesg | grep -iE "sda|uas|I/O error|ext4" | tail -n 25

# 3. Ler atributos S.M.A.R.T. e Temperatura do HD
smartctl -A /dev/sda
```

> ⚠️ **REGRA DE OURO DO `/boot/armbianEnv.txt`:**
> Se precisar editar `/boot/armbianEnv.txt`, **SEMPRE deixe uma linha em branco (`\n`) no final do arquivo!** O U-Boot ignora a última linha se não houver quebra de linha, o que desativaria o `usbstoragequirks=...,0x0bc2:0xa003:u` e faria o boot demorar 30 minutos.

---

## 🐳 4. Auditoria de Consumo de RAM por Container Docker

Se a TV Box estiver com pouca memória disponível, identifique qual container está consumindo mais RAM:

```bash
docker stats --no-stream --format "table {{.Name}}\t{{.MemUsage}}\t{{.CPUPerc}}"
```

### Limpeza Segura de Espaço e Cache Docker:
Para remover imagens antigas órfãs que ficaram no HD após atualizações do Portainer GitOps (sem apagar volumes nem containers parados que o usuário guarda no CasaOS):
```bash
docker image prune -f
apt clean
```

### 4.1. Diagnóstico do Erro `"Failed to load apps, please refresh later."` no CasaOS
Quando o painel do CasaOS carrega o status de CPU/RAM/Disco mas não exibe os ícones dos aplicativos e mostra o aviso `"Failed to load apps, please refresh later."`, a rota `/v2/app_management/web/appgrid` do serviço `casaos-app-management` está:
1. Demorando mais de 30 segundos para responder porque o `dockerd` está sobrecarregado por algum container pesado/incompatível com 1 GB de RAM em loop/`unhealthy` (ex.: `frigate` NVR com IA/OpenCV que exige 4 GB+ de RAM e eleva o *Load Average* para `20+`); ou
2. Perdendo o registro de rota no `casaos-gateway`.

**Comandos de Diagnóstico e Reparo Imediato:**
```bash
# 1. Checar se há containers em estado unhealthy ou Restarting travando o dockerd
docker ps -a

# 2. Se houver container pesado travando o sistema (ex: frigate), desativar restart e parar
docker update --restart=no <nome_do_container> && docker stop <nome_do_container>

# 3. Reiniciar o gerenciador de apps do CasaOS e medir o tempo da API appgrid (deve ser < 2s)
systemctl restart casaos-app-management
curl -s -o /dev/null -w 'appgrid HTTP: %{http_code} in %{time_total}s\n' http://127.0.0.1/v2/app_management/web/appgrid
```

### 4.2. Diagnóstico de Lentidão no `tvbox.local` (mDNS / Avahi), Wi-Fi Fallback e SSH
Para garantir que `http://tvbox.local` responda em milissegundos no PC e no celular tanto no cabo quanto no Wi-Fi, sem conflito com redes Docker ou atraso de IPv6:
* O `avahi-daemon` deve estar restrito às interfaces físicas (`allow-interfaces=end0,wlan0`) e apenas IPv4 (`use-ipv6=no`) em `/etc/avahi/avahi-daemon.conf`.
* **Não** ative `MulticastDNS=yes` no `systemd-resolved` simultaneamente com o `avahi-daemon` (evita disputa na porta UDP 5353).
* Mantenha `UseDNS no` em `/etc/ssh/sshd_config` para login SSH instantâneo.
* **Wi-Fi Interno (`wlan0` - Chip SSV6006C / SSV6256P SDIO `3030:3030`):**
  * Carregado pelo módulo `/lib/modules/6.12.64-current-sunxi64/kernel/drivers/net/wireless/ssv6256p/ssv6x5x.ko` via `/etc/modules-load.d/ssv6x5x.conf` (com os módulos conflitantes Unisoc `sprdwl_ng`, `sprdbt_tty` e `uwe5622_bsp_sdio` bloqueados em `/etc/modprobe.d/blacklist-unisoc-wifi.conf`).
  * Gerenciado pelo `NetworkManager` (`nmcli`) com `ipv4.route-metric 600` (fallback automático quando o cabo `end0` está desconectado) e painel visual Web na porta `1885` (`systemctl status tvbox-wifi-webui.service` / `http://tvbox.local:1885`).
* **Sensor Infravermelho do Controle Remoto (`sunxi-ir` em `/dev/input/event5`):**
  * Protocolo NEC nativo exclusivo (`ir-keytable -p nec`) e central web de mapeamento/ações rodando na porta `1886` (`systemctl status tvbox-remote-hub.service` / `http://tvbox.local:1886`), consumindo apenas ~11 MB de RAM para disparar `poweroff`, `reboot`, limpeza de RAM e containers.

---

## 🔄 5. Pós-Manutenção: Registrar na Documentação

Sempre que encontrar um problema novo ou realizar uma alteração permanente na configuração da TV Box durante o uso desta Skill:
1. Atualize o guia correspondente em `docs/` (ex.: `docs/04-armazenamento-e-boot-hibrido.md` ou `docs/05-pos-instalacao-e-otimizacao.md`).
2. Se aprendeu um comando de diagnóstico ou reparo novo, adicione-o a este arquivo `SKILL.md` para evoluir a manutenção automática do projeto!
