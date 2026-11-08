# 02 - Instalação do Armbian no Cartão SD e Primeiro Boot

[⬅️ Voltar para a Wiki Principal](../README.md)

---

## 1. Escolha da Imagem Correta (Troubleshooting de Vídeo/RAM)

### Tentativa 1: Imagem Genérica `v1.3` / LPDDR3 (Falha)
* **Sintoma:** Tela preta no HDMI e ausência de atividade na porta de rede Ethernet.
* **Causa Técnica:** O U-Boot da versão padrão para X96Q (`v1.3`) inicializa o controlador de memória com timings **LPDDR3**, incompatíveis com os chips **DDR3** usados na revisão `v5.1` desta placa.

### Tentativa 2: Imagem Comunitária `X96q-v5-1` DDR3 (Sucesso ✅)
* **Arquivo utilizado:**
  ```text
  Armbian-unofficial_26.02.0-trunk_X96q-v5-1_bookworm_current_6.12.64_minimal.img.xz
  ```
* **Características da Build:**
  * **Base:** Debian 12 (Bookworm) Minimal (focada em servidor, sem interface gráfica pesada).
  * **Kernel:** Linux Mainline `6.12.64`.
  * **DTB / U-Boot:** Pré-ajustado para `x96q-v5-1` (Allwinner H313 com RAM DDR3).

---

## 2. Gravação no Cartão MicroSD de 2 GB
1. Descompactação do arquivo `.img.xz` para obter a imagem bruta (`.img` de ~1,55 GB).
2. Gravação direta no **Cartão MicroSD de 2 GB** utilizando o **Rufus** no Windows.
3. Como a imagem minimal possui ~1,55 GB, ela coube com folga nos `1.8 GB` reais do cartão de 2 GB.

---

## 3. Primeiro Boot na TV Box
1. Inserção do cartão MicroSD na TV Box com cabo HDMI e cabo de rede RJ45 conectados.
2. Inicialização bem-sucedida até o prompt `root@x96q-v5-1`.
3. Configuração inicial concluída:
   * Definição da senha do usuário `root`.
   * Cancelamento da criação de usuário secundário (`Ctrl+C`) para operar diretamente na preparação do servidor.
