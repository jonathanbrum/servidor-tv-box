# 04 - Armazenamento e Boot Híbrido (SD 2 GB + HD 1 TB)

[⬅️ Voltar para a Wiki Principal](../README.md)

---

## 1. Diagnóstico Inicial dos Discos (`lsblk`)

Ao conectar o HD Externo USB de 1 TB na TV Box e executar `lsblk` via SSH, obtivemos o seguinte mapeamento:

```text
NAME         MAJ:MIN RM   SIZE RO TYPE MOUNTPOINTS
sda            8:0    0 931.5G  0 disk 
└─sda1         8:1    0   1.3G  0 part 
mmcblk0      179:0    0   1.8G  0 disk 
└─mmcblk0p1  179:1    0   1.7G  0 part /var/log.hdd
                                       /
zram0        251:0    0 489.2M  0 disk [SWAP]
zram1        251:1    0    50M  0 disk /var/log
zram2        251:2    0     0B  0 disk 
```

### Análise Técnica do Mapeamento:
* **`mmcblk0` (`1.8G`):** É o Cartão MicroSD de 2 GB onde o sistema está rodando atualmente (`/` em `mmcblk0p1` com `1.7G`).
* **`zram0` (`489.2M`) e `zram1` (`50M`):** Swap e logs comprimidos em memória RAM criados automaticamente pelo Armbian para proteger o cartão SD e otimizar os 1 GB de RAM.
* **`sda` (`931.5G`):** É o **HD Externo USB de 1 TB** reconhecido perfeitamente!
  * ⚠️ **Detalhe Crítico Detectado (`sda1` com `1.3G`):** Atualmente existe uma partição `sda1` de apenas **1,3 GB** no HD externo (resquício de quando uma imagem foi gravada nele anteriormente).
  * Se rodarmos o `armbian-install` diretamente sem recriar essa partição, o Armbian instalará o sistema dentro dessa partição de `1.3G` em vez de usar os **931,5 GB (1 TB)** totais do HD!

---

## 2. Reparticionamento do HD Externo para Usar 100% (931,5 GB) — ✅ Concluído

* **Modelo do HD Externo identificado:** `Seagate Backup+ BK` (`1000204885504 bytes` / `931.51 GiB`)

Antes de iniciar o `armbian-install`, a tabela de partições do `/dev/sda` foi recriada com `sfdisk` para ocupar 100% do disco de 1 TB:

```bash
echo 'type=83' | sfdisk /dev/sda && lsblk
```

### Resultado após o reparticionamento:
```text
Device     Boot Start        End    Sectors   Size Id Type
/dev/sda1        2048 1953525166 1953523119 931.5G 83 Linux

NAME         MAJ:MIN RM   SIZE RO TYPE MOUNTPOINTS
sda            8:0    0 931.5G  0 disk 
└─sda1         8:1    0 931.5G  0 part 
mmcblk0      179:0    0   1.8G  0 disk 
└─mmcblk0p1  179:1    0   1.7G  0 part /var/log.hdd
                                       /
zram0        251:0    0 489.2M  0 disk [SWAP]
zram1        251:0    0    50M  0 disk /var/log
zram2        251:2    0     0B  0 disk 
```

---

## 3. Transferência da Raiz (`/`) com `armbian-install`

Com a partição `sda1` exibindo `931.5G`:

1. Executar no terminal SSH:
   ```bash
   armbian-install
   ```
2. Na primeira tela (`Choose an option`), escolher a opção **`1`**:
   * **`1 Boot from SD - system on SATA, USB or NVMe`** *(Boot pelo SD - sistema no USB)*
3. Na tela de seleção de partição de destino:
   * Selecionar **`/dev/sda1`** (`931.5G`).
4. Na tela de confirmação de limpeza do disco (`It is highly recommended to wipe all partitions on the destination disk /dev/sda and leave installer to make them!`):
   * Selecionar **`<Proceed>`** (Enter) para que o instalador gerencie a partição limpa no `/dev/sda`.
5. Na tela `Warning: THIS OPERATION WILL WIPE ALL DATA ON DRIVE: /dev/sda`:
   * ⚠️ **Atenção:** Apertar a **Barra de Espaço** para marcar a caixinha `(*) Yes, I understand` e depois apertar **Enter** (`< OK >`).
6. Na tela `Select filesystem type for /dev/sda1` (`1 ext4` / `2 btrfs`):
   * Selecionar **`1 ext4`** e apertar **Enter** (`<OK>`).
   * *Por que `ext4` e não `btrfs`?* O `ext4` consome muito menos memória RAM (essencial para uma placa com 1 GB de RAM) e tem desempenho muito superior em HDs mecânicos USB 2.5" por não sofrer com a fragmentação de *Copy-on-Write* do `btrfs`.
7. Aguardar a formatação e cópia do sistema (`Transferring rootfs to /dev/sda1 (1168 MB)`):
   * **Observação sobre a lentidão na transferência inicial:**
     1. **Gargalo de leitura do MicroSD de 2 GB:** Cartões de 2 GB antigos (padrão SD padrão pré-UHS/Classe 2~4) têm leitura aleatória (IOPS) extremamente baixa ao ler as dezenas de milhares de pequenos arquivos do Linux (`/usr`, `/lib`).
     2. **`ext4lazyinit` em discos de 1 TB:** Logo após formatar 931,5 GB em `ext4`, o kernel executa a inicialização das tabelas de *inodes* em segundo plano (`ext4lazyinit`), fazendo a agulha do HD mecânico alternar entre a inicialização da tabela e a gravação do `rsync`.
     3. **Desempenho Pós-Migração:** Após o reboot, o cartão SD de 2 GB deixa de ser usado (serve apenas nos primeiros segundos do boot) e o sistema passa a operar 100% no HD Seagate (com taxas sequenciais de ~35–40 MB/s via USB 2.0 e cache de disco dedicado).
   * **Como monitorar em tempo real (opcional):** Abrindo uma segunda aba de SSH (`ssh root@<IP_DA_TV_BOX>`) e rodando `df -h` ou `ps aux | grep rsync` para ver os megabytes subindo no `/dev/sda1`.
8. Ao chegar em 100%, o script atualiza automaticamente:
   * `/boot/armbianEnv.txt` (no Cartão SD) apontando `rootdev=UUID=<UUID_DO_SDA1>`
   * `/etc/fstab` (no HD Externo) montando `/` no `/dev/sda1` e `/boot` no `/dev/mmcblk0p1`
9. Na tela final (`All done. Reboot`), apertar **Enter** diretamente em **`<Reboot>`** (mantendo **ambos** conectados na TV Box: Cartão SD de 2 GB + HD Externo de 1 TB).

---

## 4. Troubleshooting no Primeiro Boot do HD: `initramfs` / `fsck`

### Sintoma na Tela HDMI:
Ao reiniciar pela primeira vez após a cópia (especialmente se houve desligamento forçado enquanto o `ext4lazyinit` inicializava a partição de 1 TB), o boot híbrido encontra o `/dev/sda1`, mas pausa no prompt `(initramfs)` com a mensagem:

```text
/dev/sda1 contains a file system with errors, check forced.
Inode 31326209 has corrupt extent header.
/dev/sda1: UNEXPECTED INCONSISTENCY; RUN fsck MANUALLY.
Failure: File system check of the root filesystem failed
The root filesystem on /dev/sda1 requires a manual fsck
(initramfs)
```

### Solução Imediata (Direto no Teclado da TV Box):
No prompt `(initramfs)`, digitar:

```bash
fsck -y /dev/sda1
```

* **O que acontece durante o `fsck -y` (Efeito "Matrix" no `Pass 5`):**
  * O `fsck.ext4` possui 5 etapas (`Pass 1` a `Pass 5`).
  * Ao chegar no **`Pass 5: Checking group summary information`**, como o disco de 1 TB (~7.450 grupos de blocos) teve o `ext4lazyinit` interrompido no primeiro desligamento, o `fsck` percorre todos os grupos de blocos corrigindo os contadores de blocos/inodes livres (`Block bitmap differences` / `Free inodes count wrong`), fazendo milhares de números correrem rapidamente na tela.
  * Isso é totalmente normal e benéfico: ao terminar o `Pass 5`, toda a estrutura de 1 TB já fica 100% inicializada e verificada.

Ao finalizar e exibir `FILE SYSTEM WAS MODIFIED`, voltando ao prompt `(initramfs)`, digitar:

```bash
exit
```

*(O comando `exit` sai do `initramfs` e prossegue imediatamente com o carregamento normal do Armbian a partir do HD de 1 TB).*

---

## 5. Validação Pós-Boot (Confirmando a Raiz de 1 TB) — ✅ Concluído!

Após o sistema subir e reconectar via SSH (`ssh root@<IP_DA_TV_BOX>`), o comando `df -h / && lsblk` confirmou o sucesso absoluto da arquitetura de **Boot Híbrido**:

```text
root@x96q-v5-1:~# df -h / && lsblk
Filesystem      Size  Used Avail Use% Mounted on
/dev/sda1       916G  1.1G  869G   1% /
NAME         MAJ:MIN RM   SIZE RO TYPE MOUNTPOINTS
sda            8:0    0 931.5G  0 disk 
└─sda1         8:1    0 931.5G  0 part /var/log.hdd
                                       /
mmcblk0      179:0    0   1.8G  0 disk 
└─mmcblk0p1  179:1    0   1.7G  0 part /boot
                                       /media/mmcboot
zram0        251:0    0 489.2M  0 disk [SWAP]
zram1        251:1    0    50M  0 disk /var/log
zram2        251:2    0     0B  0 disk 
```

* **`/` (Raiz do Sistema):** Inicialmente montada em `/dev/sda1` com 1 TB, posteriormente otimizada e blindada para **300 GB** (`295G` úteis / `286G` livres) após diagnóstico avançado de USB e S.M.A.R.T. (ver Seção 6 abaixo).
* **`/boot` (Partição de Boot):** Montada em `/dev/mmcblk0p1` (Cartão MicroSD de 2 GB), atuando apenas como ignição de inicialização.

---

## 6. Engenharia de Blindagem do HD: Correção do Bug `UAS` (Seagate) + Isolamento *Short-Stroking* de 300 GB — ✅ Concluído!

Durante os testes de estresse e leitura do log do kernel (`dmesg`), identificamos dois fatores críticos que causavam lentidão extrema no boot (~32 minutos) e erros de E/S (`I/O error` / `Structure needs cleaning`):

### 6.1. O Bug do Protocolo `UAS` na Ponte USB Seagate (`0bc2:a003`) e a Regra da Quebra de Linha do U-Boot
1. **Sintoma no `dmesg`:**
   ```text
   sd 0:0:0:0: [sda] tag#29 uas_eh_abort_handler 0 uas-tag 18 inflight: CMD
   sd 0:0:0:0: [sda] tag#17 uas_zap_pending 0 uas-tag 1 inflight: CMD
   ```
   A controladora USB da Seagate (`ID 0bc2:a003 Seagate RSS LLC Backup Plus`) engasga ao receber 30 comandos simultâneos do driver `uas` (*USB Attached SCSI*) na porta USB 2.0 da TV Box.
2. **Por que o Quirk do `armbian-install` não havia funcionado de primeira?**
   O `armbian-install` adicionou `,0x0bc2:0xa003:u` na última linha do `/boot/armbianEnv.txt` **sem quebra de linha (`\n`) no final**. O comando `env import` do U-Boot ignora a última linha do arquivo se ela não terminar com `\n`!
3. **Solução Definitiva no `/boot/armbianEnv.txt`:**
   Adicionamos a quebra de linha final e passamos os parâmetros também via `extraargs` (incluindo `systemd.gpt_auto=0` para evitar leitura do setor final do disco):
   ```ini
   verbosity=1
   bootlogo=false
   console=both
   disp_mode=1920x1080p60
   overlay_prefix=sun50i-h616
   rootdev=UUID=f92447b4-a725-4dbb-a5d0-1218125ff5e7
   rootfstype=ext4
   extraargs=systemd.gpt_auto=0 usb-storage.quirks=0x2537:0x1066:u,0x2537:0x1068:u,0x0bc2:0xa003:u
   usbstoragequirks=0x2537:0x1066:u,0x2537:0x1068:u,0x0bc2:0xa003:u
   ```
4. **Resultado Imediato:**
   * O Kernel confirmou: `usb 1-1: UAS is ignored for this device, using usb-storage instead`.
   * O tempo de montagem da raiz no boot caiu de **1.920 segundos (32 minutos)** para **11,5 segundos**!
   * O suporte a diagnóstico **S.M.A.R.T. (`smartctl -a /dev/sda`)** foi automaticamente desbloqueado!

---

### 6.2. Raio-X S.M.A.R.T. e Isolamento Físico de Superfície (*Short-Stroking* em 300 GB)

Com o `smartctl -a /dev/sda` desbloqueado, descobrimos as especificações internas do disco:
* **Disco Interno:** `Seagate Samsung SpinPoint M8 (ST1000LM024 HN-M101MBB)` — 5400 RPM
* **Horas de Uso (`Power_On_Hours`):** Apenas **`906 horas`** (~37 dias de uso total!)
* **Taxa de Leitura Sequencial (`dd`):** **`39.5 MB/s`** (limite máximo físico do barramento USB 2.0!)
* **Diagnóstico de Superfície (`Current_Pending_Sector`):** Foram identificados `1833` setores pendentes concentrados **após a marca de ~371 GB** (a partir do setor LBA `725616640`), enquanto os primeiros **300 GB** (trilhas externas do disco) passaram com **100% de perfeição e zero erros** nos testes de leitura (`10 GB`, `100 GB`, `200 GB` e `300 GB`).

#### Como o HD foi blindado em 300 GB sem perder nenhum arquivo:
1. Demos boot temporariamente pelo Cartão MicroSD (`rootdev=/dev/mmcblk0p1`).
2. Encolhemos o sistema de arquivos `ext4` de 931,5 GB para dentro da zona limpa com `resize2fs -p /dev/sda1 290G`, realocando todos os blocos usados para o início saudável do disco.
3. Redimensionamos a partição `/dev/sda1` na tabela de partições para cravar em **300 GB** (`start=2048, size=300G` via `sfdisk`) e ajustamos o `ext4` com `resize2fs /dev/sda1`, deixando o restante do disco (300 GB a 1000 GB) **não alocado e fisicamente isolado**.
4. Reparamos os *inodes* corrompidos das pastas `/proc` e `/sys` com `debugfs` (`unlink proc` / `unlink sys`) + `e2fsck -fy /dev/sda1` e validamos **100% dos 68.407 arquivos** do sistema.

#### Estado Final Blindado (`df -h / && lsblk && free -h`):
```text
Filesystem      Size  Used Avail Use% Mounted on
/dev/sda1       295G  5.4G  286G   2% /
NAME        MAJ:MIN RM   SIZE RO TYPE MOUNTPOINTS
sda           8:0    0 931.5G  0 disk
└─sda1        8:1    0   300G  0 part /var/log.hdd
                                      /
mmcblk0     179:0    0   1.8G  0 disk
└─mmcblk0p1 179:1    0   1.7G  0 part /boot
                                      /media/mmcboot
zram0       251:0    0 489.2M  0 disk [SWAP]
zram1       251:1    0    50M  0 disk /var/log
zram2       251:2    0     0B  0 disk
               total        used        free      shared  buff/cache   available
Mem:           978Mi       447Mi        59Mi       3.0Mi       550Mi       530Mi
Swap:          2.5Gi        24Mi       2.5Gi
```

---

[➡️ Próxima Etapa: 05 - Pós-Instalação, Otimização, Energia e Clonagem](05-pos-instalacao-e-otimizacao.md)
