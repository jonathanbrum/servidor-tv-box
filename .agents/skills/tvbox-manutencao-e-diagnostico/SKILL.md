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

---

## 🔄 5. Pós-Manutenção: Registrar na Documentação

Sempre que encontrar um problema novo ou realizar uma alteração permanente na configuração da TV Box durante o uso desta Skill:
1. Atualize o guia correspondente em `docs/` (ex.: `docs/04-armazenamento-e-boot-hibrido.md` ou `docs/05-pos-instalacao-e-otimizacao.md`).
2. Se aprendeu um comando de diagnóstico ou reparo novo, adicione-o a este arquivo `SKILL.md` para evoluir a manutenção automática do projeto!
