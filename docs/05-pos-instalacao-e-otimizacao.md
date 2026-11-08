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

* **Espaço Livre Real (`Avail`):** `904 GB` livres (de `869 GB` antes do `tune2fs`).
* **Consumo Base de RAM do Armbian Minimal:** Apenas **`199 MiB`** em uso, restando **`779 MiB` livres** para serviços e contêineres.
* **Swap Total Ativo:** **`2.5 GiB`** (`489.2 MiB` ZRAM de alta prioridade + `2.0 GiB` Swapfile no HD).

---

[➡️ Próxima Etapa: 06 - Arquitetura Home Lab e Instalação do CasaOS](06-arquitetura-homelab-e-servicos.md)
