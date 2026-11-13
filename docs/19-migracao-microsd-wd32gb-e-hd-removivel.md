# 💾 Migração para MicroSD WD 32 GB (Principal) + HD Externo Removível

> **Atualização de Arquitetura:** A TV Box deixou de depender do HD Externo USB para dar boot. Agora **todo o sistema operacional, `/boot`, `/DATA`, Docker e `/swapfile` (2 GB)** rodam diretamente no **microSD Western Digital 32 GB** no slot nativo (`mmcblk0`), enquanto o **HD Seagate 1 TB** passou a ser um **armazenamento opcional e removível** dedicado ao **FileBrowser** (com opção de montar/ejetar com segurança pelo Controle Remoto IR).

---

## 1. Validação de Originalidade do MicroSD (`CID` de Fábrica)

A leitura direta do barramento SD/MMC nativo da TV Box (`/sys/block/mmcblk0/device/`) confirmou a autenticidade do cartão:

| Propriedade | Valor Lido no Hardware | Significado |
| :--- | :--- | :--- |
| **`cid`** | `035344575833324780592aaaad019785` | Registro único de identificação do cartão |
| **`manfid`** | `0x000003` | **SanDisk / Western Digital** (ID oficial SD Association) |
| **`oemid`** | `0x5344` (`"SD"`) | OEM oficial SanDisk/WD |
| **`name`** | `WX32G` | Código de produto oficial WD 32 GB |
| **`date`** | `07/2025` | Data de fabricação |
| **`serial`** | `0x592aaaad` | Número de série de fábrica |

---

## 2. Comparativo de Velocidade (Benchmarks Reais)

Todos os testes na TV Box foram executados com `hdparm -tT` e `dd` de `128 MiB` em modo direto (`oflag=direct` / `iflag=direct`, sem cache de RAM):

| Armazenamento | `hdparm` Buffered Read | `dd` Escrita Sequencial (128 MiB) | `dd` Leitura Sequencial (128 MiB) |
| :--- | :---: | :---: | :---: |
| **HD Seagate 1 TB USB (`/dev/sda`, quirk `usb-storage`)** | `12,50 MB/s` | `29,8 MB/s` | `33,4 MB/s` |
| **microSD 2 GB antigo (`/dev/mmcblk0`)** | `14,60 MB/s` | — | `20,0 MB/s` |
| **microSD WD 32 GB (`WX32G`, `/dev/mmcblk0`)** | **`20,93 MB/s`** *(+67%)* | `17,5 – 18,2 MB/s` | `21,6 – 21,7 MB/s` |
| **microSD WD 32 GB (Leitor USB do Notebook, 256 MB sem cache)** | — | `16,13 MB/s` | `18,06 MB/s` |

### 📌 Conclusão Técnica dos Testes
* **Leitura em blocos (`hdparm`):** O microSD WD 32 GB foi **67% mais rápido** (`20,93 MB/s` vs `12,50 MB/s`) que o HD mecânico via USB, além de eliminar a latência mecânica (*seek time*) — o que deixa o Linux, o CasaOS e os bancos do PocketBase/Docker mais responsivos.
* **Throughput sequencial (`dd`):** O barramento SD do Allwinner H313 opera próximo de ~22 MB/s, enquanto o HD USB atinge ~30–33 MB/s em rajadas sequenciais grandes. Para uso de servidor com containers leves, a confiabilidade e a eliminação da dependência USB superam com folga essa diferença.
* **Uso de disco após expansão (`resize2fs`):** `30 GB` totais (`6,5 GB` em uso incluindo `/swapfile` de `2 GB` e containers Docker; **`22 GB` livres**).

---

## 3. HD Externo Opcional e Removível no FileBrowser

Para que o HD Seagate de 1 TB possa ser plugado e removido a qualquer momento sem afetar o sistema ou travar o container do FileBrowser:

### A. Propagação Dinâmica no Docker (`rslave`)
No `/var/lib/casaos/apps/filebrowser/docker-compose.yml`, a pasta `/media/devmon` (onde o `devmon` monta discos USB automaticamente) foi mapeada com propagação `rslave`:

```yaml
- type: bind
  source: /media/devmon
  target: /srv/HD-Externo
  bind:
    propagation: rslave
```

Com `rslave`, sempre que o HD é conectado ou ejetado, a pasta `/HD-Externo` dentro do FileBrowser reflete a mudança em tempo real, sem precisar reiniciar o container. *(Nota: certifique-se de que `/media/devmon` tenha permissão `o+rx` para que o usuário interno UID `1000` do FileBrowser consiga listá-lo.)*

### B. Script de Montagem / Ejeção Segura (`/usr/local/bin/hd-externo.sh`)
O script `/usr/local/bin/hd-externo.sh` suporta os comandos `mount`, `eject`, `toggle` e `status`:
* **`eject`:** Executa `sync`, desmonta todas as partições do HD (`UUID=f92447b4-a725-4dbb-a5d0-1218125ff5e7`) e envia `hdparm -y /dev/sda` para colocar o motor do disco em *standby* antes de desconectar o cabo USB.
* **`mount`:** Monta o HD em `/media/devmon/hd-externo` caso esteja conectado e desmontado.

### C. Ação no Controle Remoto IR (`tvbox-remote-hub` — porta `1886`)
Foi adicionada ao catálogo `/etc/tvbox-remote/config.json` a ação **`act-hd-toggle` (`⏏️ Montar/Ejetar HD Externo`)**, que executa `/usr/local/bin/hd-externo.sh toggle`. Basta vincular essa ação a qualquer botão do controle remoto na interface Web (`http://<IP_DA_TV_BOX>:1886`).
