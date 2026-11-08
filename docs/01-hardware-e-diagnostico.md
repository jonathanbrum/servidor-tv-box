# 01 - Hardware e Diagnóstico

[⬅️ Voltar para a Wiki Principal](../README.md)

---

## 1. Identificação do Dispositivo
Muitas TV Boxes de entrada comercializadas no Brasil utilizam carcaças genéricas e firmwares Android adulterados (*spoofing*) que mascaram as especificações reais do aparelho.

* **Identificação Comercial na Etiqueta:** `R001` / `REDONE`
* **Build Android Original:** Remarcada fingindo ser um Google Pixel (`walleye`), rodando em modo `userdebug` (com acesso Root liberado).
* **Processador Real (SoC):** **Allwinner H313** (`sun50iw9p1`), arquitetura ARM64 Quad-Core Cortex-A53.
* **Memória RAM Real:** **1 GB DDR3** (apesar de firmwares originais frequentemente exibirem valores falsos de 4 GB ou 8 GB).
* **Revisão de Placa Compatível:** **X96Q `v5.1`** (controlador de memória configurado para chips DDR3 padrão).
* **Armazenamento Interno (eMMC/NAND):** 8 GB soldados na placa.

---

## 2. O Desafio do Boot no Allwinner H313

### Limitação da Boot ROM (BROM)
O chip Allwinner H313 possui uma ordem de inicialização gravada em silício (Boot ROM) que verifica apenas:
1. Memória interna (NAND/eMMC)
2. Slot de Cartão MicroSD (`mmcblk0`)

**As portas USB são ignoradas nos primeiros milissegundos de inicialização.** Por esse motivo, gravar uma imagem do Armbian diretamente em um pendrive ou HD externo USB não faz a TV Box ligar no Linux sozinha.

### Solução Adotada: Arquitetura de "Boot Híbrido"
Para contornar a limitação física e ao mesmo tempo evitar o desgaste e a falta de espaço de um cartão SD antigo:
1. **Cartão MicroSD de 2 GB (`/dev/mmcblk0`):** Atua exclusivamente como "chave de ignição", mantendo o bootloader (U-Boot) e a partição `/boot`.
2. **HD Externo USB de 2,5" de 1 TB (`/dev/sda`):** Recebe toda a raiz do sistema operacional (`/var`, `/usr`, `/home`, Docker, arquivos de mídia), oferecendo 931,5 GB úteis e velocidade superior.
