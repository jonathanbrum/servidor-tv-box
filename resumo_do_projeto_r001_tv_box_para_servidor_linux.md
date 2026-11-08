# Guia de Transformação: TV Box R001 (Allwinner H313) em Servidor Doméstico

Este documento resume todas as etapas realizadas, descobertas técnicas e procedimentos executados para transformar a sua TV Box genérica com Android em um servidor Linux leve rodando Armbian com inicialização híbrida (Cartão SD + HD Externo USB).

---

## 1. Diagnóstico e Identificação do Hardware
* **Modelo Comercial na Etiqueta:** `R001` / `REDONE` (com build Android remarcada fingindo ser um Google Pixel `walleye`).
* **Processador Real (SoC):** Allwinner H313 (`sun50iw9p1`, Quad-Core Cortex-A53).
* **Memória RAM Real:** 1 GB (com clock/configuração de memória padrão **DDR3** correspondente à revisão de placa **`v5.1`**).
* **Armazenamento Interno:** 8 GB eMMC (com acesso Root liberado via versão `userdebug`).

---

## 2. O Desafio do Boot e Escolha das Mídias
* **Limitação de Fábrica:** O chip Allwinner H313 possui Boot ROM gravada de fábrica que só inicializa por padrão a partir do slot de Cartão MicroSD ou da memória interna (ignorando as portas USB nos primeiros segundos).
* **A Solução "Boot Híbrido":** 
  1. Utiliza-se um **cartão MicroSD antigo de 2 GB** apenas como uma "chave de ignição" contendo o bootloader e a partição de boot (`/boot`).
  2. Todo o sistema operacional e futuros serviços rodarão com total desempenho e espaço livre em um **HD Externo USB de 2,5"**.

---

## 3. Passo a Passo Executado

### Etapa A: Escolha da Imagem Correta
* **Tentativa Inicial (Falha):** A imagem genérica oficial do Armbian para X96Q (`v1.3` / LPDDR3) resultou em tela preta e ausência de rede por incompatibilidade com o controlador de memória RAM.
* **Solução Definitiva (Sucesso):** Utilização da build comunitária otimizada para o padrão DDR3 da placa:
  * **Arquivo utilizado:** `Armbian-unofficial_26.02.0-trunk_X96q-v5-1_bookworm_current_6.12.64_minimal.img.xz`

### Etapa B: Gravação no Cartão SD
1. Extração do arquivo `.img` compactado.
2. Gravação direta no **Cartão SD de 2 GB** utilizando o utilitário **Rufus** (que tratou o particionamento inicial de ~1,55 GB perfeitamente dentro da capacidade do cartão).

### Etapa C: Primeiro Boot com Sucesso
1. Inserção do Cartão SD de 2 GB na TV Box (com cabo HDMI e cabo de rede Ethernet conectados).
2. Inicialização bem-sucedida do Armbian Minimal (`root@x96q-v5-1`).
3. Conclusão da rotina de primeiro acesso (definição de senha de administrador e remoção da criação de usuário secundário opcional).

---

## 4. Etapa Atual: Rede, Acesso SSH e Migração para o HD Externo

### 4.1. Rede Ethernet e Acesso Remoto (SSH) — ✅ Concluído
* **Status:** Cabo de rede conectado e dispositivo (`x96q-v5-1`) acessível na rede local.
* **IP atribuído via DHCP:** `<IP_DA_TV_BOX>`
* **Acesso via SSH pelo Windows (PowerShell/Terminal):**
  ```powershell
  ssh root@<IP_DA_TV_BOX>
  ```

### 4.2. Reconhecimento do HD Externo USB (Em andamento)
1. Conectar o HD Externo de 2,5" na porta USB da TV Box.
2. Verificar a identificação do disco no Linux:
   ```bash
   lsblk
   ```
   * `mmcblk0`: Cartão MicroSD de 2 GB (atual sistema e futuro `/boot`).
   * `mmcblk1` / `mmcblk2`: Memória interna eMMC de 8 GB.
   * `sda`: HD Externo USB (destino da raiz `/` do sistema).

### 4.3. Migração Definitiva da Raiz (`/`) para o HD Externo (Pendente)
1. Executar o assistente nativo do Armbian:
   ```bash
   armbian-install
   ```
2. **Opção a escolher no menu:**
   * Selecionar a opção **"Boot from SD - system on SATA, USB or NVMe"** (manter o bootloader no Cartão SD e transferir o sistema para o dispositivo USB `sda`).
   * Selecionar a partição/disco correspondente ao HD externo (`sda` / `sda1`).
   * Escolher o sistema de arquivos **`ext4`** (recomendado para máxima estabilidade e desempenho em HDs mecânicos/SSDs no Armbian).
3. Aguardar a cópia dos arquivos e, ao finalizar, escolher **Reboot** (mantendo tanto o Cartão SD de 2 GB quanto o HD Externo plugados).
4. Após o reboot, validar com `df -h` se a barra `/` está montada em `/dev/sda1` com a capacidade total do HD externo.