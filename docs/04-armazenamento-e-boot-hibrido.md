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

* **`/` (Raiz do Sistema):** Montada em `/dev/sda1` (HD Externo de 1 TB), com `1.1G` usado (1%) e **`869G` livres** (expansível para `~906G` livres reduzindo a reserva de blocos do `ext4`).
* **`/boot` (Partição de Boot):** Montada em `/dev/mmcblk0p1` (Cartão MicroSD de 2 GB), atuando apenas como ignição de inicialização.

---

[➡️ Próxima Etapa: 05 - Pós-Instalação, Otimização e Serviços](05-pos-instalacao-e-otimizacao.md)
