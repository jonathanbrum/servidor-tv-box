# 05 - Pós-Instalação, Otimização do HD de 1 TB e Preparação do Servidor

[⬅️ Voltar para a Wiki Principal](../README.md) | [⬅️ Etapa Anterior: 04 - Boot Híbrido](04-armazenamento-e-boot-hibrido.md)

---

## 1. Liberar +37 GB Extras no HD de 1 TB (`tune2fs`)
Por padrão, ao formatar uma partição `ext4`, o Linux reserva **5% da capacidade total** exclusivamente para emergência do sistema (`root`). Em um disco pequeno isso não faz diferença, mas em um HD de **1 TB (`916G`)**, 5% significam **~46 GB bloqueados** (por isso o `Avail` mostra `869G` em vez de `906G`).

Reduzindo essa reserva de 5% para **1%** (que já é mais que suficiente, ~9 GB):

```bash
tune2fs -m 1 /dev/sda1 && df -h /
```
* **Ganho imediato:** O espaço livre disponível (`Avail`) salta de **`869G`** para **`~906G`** instantaneamente!

---

## 2. Atualização dos Pacotes do Sistema (Debian 12 Bookworm)
Com o sistema rodando direto no HD externo de 1 TB, já podemos atualizar a lista de repositórios e os pacotes instalados:

```bash
apt update && apt upgrade -y
```

> ⚠️ **Dica Importante para TV Box (`apt-mark hold` no Kernel/DTB):**
> Como usamos uma imagem comunitária específica para a revisão de memória DDR3 (`x96q-v5-1`), caso queira evitar que futuras atualizações automáticas substituam o bootloader/kernel por uma versão genérica, você pode congelar os pacotes de kernel no `armbian-config` (ou via `apt-mark hold linux-image-current-sunxi64 linux-dtb-current-sunxi64`).

---

## 3. Criação de Arquivo de Swap Adicional no HD (Segurança para 1 GB de RAM)
A placa conta com **1 GB de RAM física** + **489 MB de ZRAM** (swap comprimida na RAM). Como agora temos um HD de 1 TB sobrando espaço, criar um **Swapfile de 2 GB no HD** com baixa prioridade (`swappiness`) garante que o servidor nunca trave por falta de memória (*Out Of Memory*) se você abrir vários serviços ou contêineres pesados ao mesmo tempo:

```bash
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw,pri=5 0 0' >> /etc/fstab
free -h
```
*(Com `pri=5`, o Linux continuará usando primeiro a ZRAM ultrarrápida na memória RAM que tem prioridade `100`, e só usará os 2 GB do HD se a RAM realmente encher!).*

---

## 4. Resultado Consolidado das Otimizações — ✅ Concluído!

Saída verificada após `tune2fs`, criação do `/swapfile` de 2 GB e atualização do sistema:

```text
root@x96q-v5-1:~# df -h / && free -h
Filesystem      Size  Used Avail Use% Mounted on
/dev/sda1       916G  3.3G  904G   1% /
               total        used        free      shared  buff/cache   available
Mem:           978Mi       199Mi       318Mi       460Ki       548Mi       779Mi
Swap:          2.5Gi       4.3Mi       2.5Gi
```

* **Espaço Livre Real (`Avail`):** Inicialmente `904 GB` (posteriormente blindado em **300 GB** / **`286 GB` livres** para isolar fisicamente os setores finais do disco — ver [Seção 6 do Doc 04](04-armazenamento-e-boot-hibrido.md#6-engenharia-de-blindagem-do-hd-correção-do-bug-uas-seagate--isolamento-short-stroking-de-300-gb--concluído)).
* **Consumo Base de RAM do Armbian Minimal:** Apenas **`199 MiB`** em uso, restando **`779 MiB` livres** para serviços e contêineres.
* **Swap Total Ativo:** **`2.5 GiB`** (`489.2 MiB` ZRAM de alta prioridade + `2.0 GiB` Swapfile no HD).

---

## 5. Operação no Dia a Dia: Ligar, Desligar e Monitorar Saúde do HD

### 5.1. Como Ligar e Desligar sem o Controle Remoto?
Diferente do Android original (que ficava em *Standby* aguardando o controle infravermelho), no Armbian Linux a TV Box opera como um servidor dedicado:
* **Consumo 24/7:** A placa Allwinner H313 consome apenas **3W a 5W** (menos que uma lâmpada LED pequena), sendo projetada para ficar ligada 24/7.
* **Para DESLIGAR com segurança (sem corromper o HD):**
  * **Via SSH:** Executar `poweroff` (ou `shutdown -h now`) e aguardar ~15 segundos até o HD parar de girar antes de tirar da tomada.
  * **Via Navegador (CasaOS):** Clicar no botão de **Desligar / Reiniciar** no painel web (`http://<IP_DA_TV_BOX>`).
* **Para LIGAR novamente:**
  * Toda TV Box possui *Auto Power-On* físico: basta conectar a fonte na tomada (ou acionar uma **Tomada Inteligente Wi-Fi**) que ela inicia o boot automaticamente sem precisar do controle remoto.
* **E se ligar a TV Box com o HD USB desconectado?**
  * **Não estraga nada!** O Cartão MicroSD carrega o kernel, procura o `UUID` do HD por ~30 segundos e, não encontrando, estaciona em segurança na tela `(initramfs)`. Basta desligar, plugar o HD USB e ligar novamente.
  * **Sistema Reserva no Cartão SD:** O sistema original no Cartão MicroSD de 2 GB (`/dev/mmcblk0p1`) permanece intacto! Se um dia precisar iniciar sem o HD, basta digitar no `(initramfs)`:
    ```bash
    mount -t ext4 /dev/mmcblk0p1 /root
    echo "rootdev=/dev/mmcblk0p1" >> /root/boot/armbianEnv.txt
    echo "" >> /root/boot/armbianEnv.txt
    reboot -f
    ```

### 5.2. Como Monitorar a Saúde e Temperatura do HD (S.M.A.R.T.)
Graças ao desbloqueio do driver `usb-storage` (`0x0bc2:0xa003:u`), você pode consultar a saúde física e a temperatura do HD a qualquer momento via SSH:
```bash
smartctl -a /dev/sda
```

### 5.3. Desligamento do HD USB: Por que ele continuava girando e como foi solucionado?

Se ao desligar o servidor (seja pelo CasaOS, pelo Controle Remoto IR ou via SSH `poweroff`) você notou que o HD continuava girando ou com a luz acesa, isso se devia a uma conjunção entre a eletrônica da TV Box e o driver USB do Linux:

#### 1. A Linha de 5V das Portas USB é Contínua (Hardware)
* Em computadores convencionais (ATX), a placa-mãe corta a alimentação elétrica dos barramentos USB no desligamento (*Soft Off* / S5).
* Em TV Boxes chinesas (como a `X96Q v5.1` / Allwinner H313), o conector de 5V da fonte DC é ligado diretamente aos conectores USB sem chaves MOSFET de corte de energia.
* **Consequência:** Enquanto a fonte estiver conectada na tomada, haverá **5 Volts contínuos** alimentando o case USB. O HD só para se o sistema operacional mandar o comando de repouso antes do processador congelar.

#### 2. A Armadilha do `armbian-ramlog` e a Falha do `hdparm`
* **Por que desligar antes não funcionava:** O serviço `armbian-ramlog`, ao encerrar, sincroniza mais de 30 MB de logs comprimidos da ZRAM para o HD (`/var/log.hdd/` em `/dev/sda1`). Qualquer tentativa de mandar o disco parar prematuramente fazia o HD **acordar novamente** para salvar os logs!
* **A incompatibilidade do `hdparm -y`:** Com o quirk USB `usb-storage` ativado para blindar o Seagate ST1000LM024, o comando ATA `hdparm -y` é ignorado pela controladora USB da Seagate (o drive permanece em estado `active/idle`). O que o hardware Seagate realmente aceita é o **comando SCSI nativo `START STOP UNIT`** (`sdparm --command=stop`).

#### 3. Arquitetura Definitiva de Desligamento Seguro — ✅ 100% Ativa!

Implementamos a solução em camadas que funciona uniformemente para **CasaOS**, **Controle Remoto IR** e **terminal SSH**:

1. **Parâmetros de Kernel SCSI (`udev`):**
   A regra `/etc/udev/rules.d/60-scsi-manage-start-stop.rules` instrui o driver SCSI `sd` do Linux a emitir `START_STOP_UNIT` no encerramento:
   ```udev
   ACTION=="add", SUBSYSTEM=="scsi_disk", ATTR{manage_shutdown}=1, ATTR{manage_system_start_stop}=1
   ```
2. **Gancho de Desligamento Tardio (`/lib/systemd/system-shutdown/spindown-hdd.sh`):**
   O `systemd-shutdown` executa este script no **último milissegundo antes de congelar a CPU**, quando todos os serviços (incluindo `armbian-ramlog` e `journald`) já foram encerrados e o sistema de arquivos raiz `/` já foi remontado como somente-leitura (`ro`):
   ```bash
   #!/bin/bash
   case "$1" in
       poweroff|halt)
           /bin/sync
           if [ -x /usr/bin/sdparm ]; then
               /usr/bin/sdparm --command=stop /dev/sda >/dev/null 2>&1
           fi
           /bin/sleep 1
           for auth in /sys/bus/usb/devices/*/authorized; do
               [ -f "$auth" ] && echo 0 > "$auth" 2>/dev/null || true
           done
           /bin/sleep 1
           ;;
   esac
   ```
   * **Resultado:** O motor magnético desacelera suavemente até parar (`sdparm`) e, logo em seguida, a porta USB do host é desautorizada (`authorized=0`), cortando o enlace lógico USB e **apagando o LED do case Seagate**!

---

## 6. Guia de Migração / Clonagem Futura (Trocar o HD por um SSD ou Outro Disco)

Como o sistema utiliza **Boot Híbrido** e está confinado em uma partição limpa de **300 GB** (usando atualmente apenas `~5.4 GB`), você **não precisa clonar setor por setor** de 1 TB. Você pode migrar para **qualquer SSD SATA em Case USB (ex: 120 GB, 240 GB, 480 GB) ou outro HD** copiando apenas os arquivos reais via `rsync`!

> 💡 **Recomendação de Upgrade Futuro:** Prefira um **SSD SATA em Case USB** em vez de Pen Drive comum, pois Pen Drives aquecem e desgastam rápido com gravações constantes de logs/Docker 24/7, enquanto um SSD é silencioso, consome menos energia da porta USB e é até 10x mais rápido em leituras aleatórias (IOPS).

### 6.1. Laboratório de Recuperação do SSD SATA de 240 GB (Roteiro para Desktop)

Durante os testes de laboratório com um SSD SATA de 240 GB sob um adaptador USB de case Seagate, identificou-se o sintoma clássico de degradação de escrita:
* **Escrita rápida de 100 MB:** `~97 MB/s` (dentro da janela de cache inicial).
* **Escrita sustentada de 500 MB sem cache:** Despencou para **`2.06 MB/s`** (levando mais de 4 minutos).
* **Diagnóstico da Ponte USB:** O chip do case externo Seagate bloqueou comandos ATA/SCSI de descarte (`TRIM` / `UNMAP`), impedindo o sistema operacional de instruir a memória flash a limpar blocos sujos.

#### 📋 Passo a Passo para Recuperação via Porta SATA Nativa no Desktop:
Quando o SSD for conectado diretamente a uma porta SATA da placa-mãe de um PC Desktop (com cabo SATA e energia da fonte):

1. **Inspeção de Saúde Real (S.M.A.R.T.):**
   - Abrir o **CrystalDiskInfo** para verificar:
     - Modelo e fabricante real do chip controlador (Phison, Silicon Motion, Realtek, Maxio, etc.);
     - Porcentagem de saúde restante da memória flash NAND;
     - Contadores de `Retired Blocks`, `Reallocated Sectors` e `CRC Error Count` (mau contato no cabo).
2. **Atualização de Firmware do Fabricante:**
   - Baixar o utilitário oficial do fabricante (ex: *Kingston SSD Manager*, *Crucial Storage Executive*, *SanDisk Dashboard*, etc.).
   - Verificar se há atualizações de firmware pendentes (muitos modelos antigos corrigiram problemas de colapso de velocidade no cache SLC via patch de firmware).
3. **Execução do *ATA Secure Erase* via Hardware:**
   - Pela porta SATA nativa, executar o comando **ATA Secure Erase** (pelo software do fabricante ou via pendrive *Parted Magic / Linux Live* com `hdparm --user-master u --security-set-pass NULL /dev/sdX` e `hdparm --user-master u --security-erase NULL /dev/sdX`).
   - Isso emite um pulso elétrico em todas as células NAND simultaneamente, zerando a tabela interna FTL e restaurando o SSD ao estado de fábrica.
4. **Aplicação do *Over-Provisioning Manual* (Reserva de 20%):**
   - Criar uma partição de **190 GB** e deixar **~48 GB livres (espaço não alocado)**.
   - O controlador usará esse espaço oculto para o algoritmo de *Garbage Collection* e *Wear Leveling*, evitando travamentos.
5. **Teste de Validação:**
   - Rodar um teste de escrita sustentada de 1 GB. Se mantiver taxas acima de **150 a 300 MB/s**, o SSD está curado e 100% apto para ser clonado e assumir o servidor TV Box com consumo e ruído zero!

---

### Passo a Passo para Clonar/Migrar para um Disco Novo no Futuro:
1. Conecte o disco novo na **segunda porta USB** da TV Box (ele será reconhecido como `/dev/sdb`).
2. Crie uma partição Linux e formate em `ext4`:
   ```bash
   echo 'type=83' | sfdisk /dev/sdb
   mkfs.ext4 -L armbian_ssd /dev/sdb1
   ```
3. Monte o disco novo e copie todo o sistema ao vivo com `rsync`:
   ```bash
   mkdir -p /mnt/novo
   mount /dev/sdb1 /mnt/novo
   rsync -aAXHv --exclude={"/dev/*","/proc/*","/sys/*","/tmp/*","/run/*","/mnt/*","/media/*","/lost+found"} / /mnt/novo/
   mkdir -p /mnt/novo/{dev,proc,sys,tmp,run,mnt,media}
   chmod 555 /mnt/novo/proc /mnt/novo/sys
   ```
4. Descubra o novo código `UUID` com `blkid /dev/sdb1` e substitua o `UUID` antigo do HD em dois lugares:
   * No arquivo `/mnt/novo/etc/fstab` (na linha do `/`)
   * No arquivo `/boot/armbianEnv.txt` (na linha `rootdev=UUID=...`, mantendo sempre uma linha em branco no final do arquivo!)
5. Desligue com `poweroff`, remova o HD antigo, deixe apenas o SSD/disco novo conectado e ligue na tomada!

---

## 7. IP Fixo (Reserva DHCP) e Acesso por Nome (`http://tvbox.local`)

Para nunca mais perder o acesso aos painéis quando o roteador reiniciar e poder abrir o servidor pelo nome **`http://tvbox.local`** tanto no computador quanto no celular:

### 7.1. Reserva de IP no Roteador (DHCP Static Lease)
A interface Ethernet (`end0`) da placa possui endereço MAC físico fixo de fábrica (`addr_assign_type = 0`). Basta associar o MAC da interface `end0` ao IP `<IP_DA_TV_BOX>` na tabela **LAN > Reserva de DHCP** do roteador.

### 7.2. Configuração do Hostname e mDNS (`avahi-daemon`) sem Conflito
Para que o endereço `http://tvbox.local` responda instantaneamente no Windows, Android e iOS sem atraso de IPv6 ou conflito com as pontes virtuais do Docker (`docker0`, `br-*`, `veth*`):

```bash
# 1. Definir o hostname para tvbox
hostnamectl set-hostname tvbox
sed -i 's/x96q-v5-1/tvbox/g' /etc/hosts

# 2. Instalar o Avahi Daemon (mDNS padrão para PC e Celular)
apt-get update && apt-get install -y avahi-daemon

# 3. Isolar o Avahi apenas nas placas de rede físicas (end0 e wlan0) e apenas em IPv4
sed -i 's/^#allow-interfaces=.*/allow-interfaces=end0,wlan0/' /etc/avahi/avahi-daemon.conf
sed -i 's/^allow-interfaces=.*/allow-interfaces=end0,wlan0/' /etc/avahi/avahi-daemon.conf
sed -i 's/use-ipv6=yes/use-ipv6=no/' /etc/avahi/avahi-daemon.conf

# 4. Evitar atraso de DNS reverso no login SSH
grep -q '^UseDNS no' /etc/ssh/sshd_config || echo 'UseDNS no' >> /etc/ssh/sshd_config

systemctl restart avahi-daemon ssh
```

> ⚠️ **Importante:** Não ative `MulticastDNS=yes` no `systemd-resolved` quando o `avahi-daemon` estiver instalado, pois ambos disputam a porta UDP `5353` e causam lentidão na resolução de rede. Deixe apenas o `avahi-daemon` gerenciar o `.local`.

---

[➡️ Próxima Etapa: 06 - Arquitetura Home Lab e Instalação do CasaOS](06-arquitetura-homelab-e-servicos.md)
