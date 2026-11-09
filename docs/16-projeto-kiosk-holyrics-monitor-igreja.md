# 📺 Projeto Kiosk Holyrics — Monitor de Palco / Igreja com TV Box

Documento de concepção e arquitetura para transformar uma TV Box (como a `X96Q` / `R001` ou similar com 1 GB de RAM) em um **Monitor de Retorno / Projeção Dedicado para Igreja**, conectado via HDMI a uma TV ou projetor.

---

## 🎯 O Objetivo do Projeto

Ter um dispositivo **"Plug and Play"** que fica atrás da TV ou do projetor:
1. **Ligar na tomada:** O sistema inicializa em modo texto (sem desktop pesado) e abre automaticamente em tela cheia (Kiosk Mode) a URL do **Holyrics** (transmissão de letras, palco, avisos ou contagem regressiva).
2. **Zero periféricos no dia a dia:** Não precisa de teclado, mouse ou mexer na TV Box.
3. **Painel Web de Administração (via Celular):** Qualquer pessoa da equipe de multimídia pode acessar pelo celular uma telinha simples protegida por senha para:
   * Mudar o IP / link do Holyrics do dia;
   * Trocar a senha do Wi-Fi caso a rede da igreja mude;
   * Reiniciar a tela ou recarregar a página sem encostar no aparelho.
4. **Modo Resgate Duplo (Cabo de Rede Prioritário ou Hotspot Wi-Fi):**
   * **Opção 1 (A mais fácil de todas):** Basta espetar qualquer cabo de rede RJ45 na TV Box. O Linux pega IP instantaneamente via DHCP e tudo funciona na hora sem precisar de senha de Wi-Fi!
   * **Opção 2 (Sem cabo e sem Wi-Fi conhecido):** A TV Box sobe uma rede própria temporária (tipo `Monitor-Igreja-Config`) estilo dispositivo inteligente (Sonoff / Impressora Wi-Fi), onde você conecta pelo celular e configura a nova rede.

---

## 🏗️ Arquitetura do Sistema (Super Leve para 1 GB RAM)

Como a TV Box será dedicada exclusivamente para isso, ela não precisa de CasaOS, Portainer ou dezenas de containers. O foco é **máxima leveza, inicialização rápida e estabilidade**.

```
[ TV / Monitor HDMI ]
         ▲
         │ (HDMI - Tela Cheia Kiosk)
┌────────┴──────────────────────────────────────────────────────┐
│  TV BOX (Armbian / Alpine Linux)                              │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │ 🖥️ Camada de Exibição (Kiosk)                           │  │
│  │ Chromium Kiosk ou Cage (Wayland)                        │  │
│  │ Abrindo: http://<IP_DO_PC_HOLYRICS>:<PORTA>             │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │ ⚙️ Mini-Painel de Configuração (Porta 8080)              │  │
│  │ Micro-servidor Web leve (Python/Flask, Go ou PocketBase)│  │
│  │ - Troca de URL do Holyrics                              │  │
│  │ - Gerenciador de Wi-Fi (NetworkManager / nmcli)         │  │
│  │ - Protegido por Senha Simples                           │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │ 📡 Gerenciador de Rede (Autoresgate)                    │  │
│  │ Conecta no Wi-Fi. Se falhar -> Vira Hotspot temporário   │  │
│  └─────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────┘
         ▲
         │ Wi-Fi da Igreja (ou Hotspot de Resgate)
    [ Celular do Operador / Multimídia ]
```

---

## 💻 Como Funcionará Cada Componente

### 1. Inicialização Automática no HDMI (Kiosk Mode)
Em vez de instalar uma interface pesada (como XFCE ou GNOME), instala-se apenas o servidor gráfico mínimo:

* **Opção Recomendada (X11 Mínimo):**
  * Pacotes: `xserver-xorg-core`, `xinit`, `chromium-browser` (ou `cage` em Wayland).
  * Um serviço do `systemd` inicia no boot:
    ```bash
    # Exemplo do comando que roda em tela cheia:
    xinit /usr/bin/chromium-browser \
      --kiosk \
      --noerrdialogs \
      --disable-infobars \
      --check-for-update-interval=31536000 \
      "$(cat /etc/holyrics/url.txt)" -- :0
    ```
* **Recarregar a tela remotamente:**
  * Se a URL for alterada pelo painel admin, um simples comando `killall chromium-browser` faz o serviço reiniciar o navegador abrindo o novo link em 3 segundos.

---

### 2. Painel Web de Administração (Mobile-Friendly)
Um micro-servidor web rodando em segundo plano (porta `8080` ou `80`), consumindo menos de **15 MB de RAM**:

* **Acesso:** O operador conecta no mesmo Wi-Fi e digita no navegador do celular:
  `http://monitor-igreja.local:8080` (usando mDNS / Avahi) ou pelo IP da TV Box.
* **Segurança:** Uma tela de login simples com senha (ex: `igreja123`).
* **Funcionalidades da Interface:**
  1. **Campo "URL do Holyrics":** Ex.: `http://<IP_DO_PC_HOLYRICS>:8080/stage` ou `http://<IP_DO_PC_HOLYRICS>:8080/view`.
  2. **Configuração de Wi-Fi:** Lista redes disponíveis e permite salvar nova senha.
  3. **Botões de Ação:**
     * 🔄 *Recarregar Tela* (útil se o Holyrics reiniciar).
     * 🖥️ *Alternar URL* (ex: trocar de monitor de retorno dos músicos para tela de avisos).
     * 🔁 *Reiniciar TV Box*.

---

### 3. Autoresgate de Rede (Cabo Ethernet Plug-and-Play + Hotspot Wi-Fi)
O maior pesadelo em eventos e igrejas é trocar a senha do roteador, levar o aparelho para outro local ou a rede Wi-Fi oscilar e o monitor ficar "cego" sem conexão.

O sistema é desenhado com uma **hierarquia inteligente de conexão**:

```
                 [ TV Box Liga ]
                        │
         ┌──────────────┴──────────────┐
         ▼                             ▼
 [ Cabo RJ45 Plugado? ]       [ Sem Cabo de Rede ]
         │                             │
   (SIM) │                             │
         ▼                             ▼
 [ DHCP Automático via Cabo ]   [ Tenta Wi-Fi Salvo (20s) ]
         │                             │
         │                      ┌──────┴──────┐
         │                (SIM) ▼             ▼ (NÃO)
         │           [ Conecta no Wi-Fi ]  [ Ativa Modo Hotspot ]
         │                      │             │
         └──────────────┬───────┘             ▼
                        │            [ SSID: Configurar-Monitor ]
                        ▼            [ Exibe aviso na TV HDMI   ]
               [ Carrega Holyrics ]
```

* **Prioridade 1: Cabo de Rede RJ45 (Zero Configuração):**
  * Se você simplesmente espetar um cabo de rede da igreja na TV Box, o Linux detecta a portadora (`carrier`), sobe a interface `eth0` e puxa um IP via DHCP em 2 segundos.
  * O Wi-Fi nem precisa ser configurado. O Holyrics abre direto e o painel de controle fica disponível na rede cabeada.
  * **Se a TV Box estiver presa no modo Hotspot e alguém plugar o cabo de rede:** o script desativa o Hotspot na hora, assume a rede cabeada e carrega o Holyrics imediatamente!

* **Prioridade 2: Wi-Fi Conhecido:**
  * Se não houver cabo conectado, o sistema tenta se conectar à última rede Wi-Fi configurada durante 20 segundos.

* **Prioridade 3: Hotspot Wi-Fi de Resgate:**
  * Se não houver cabo conectado **E** o Wi-Fi falhar, a TV Box liga seu próprio ponto de acesso:
    * SSID: `Configurar-Monitor-Igreja`
    * Senha: `admin-igreja` (ou sem senha).
  * Na tela da TV, o navegador exibe um aviso amigável:
    > *"Sem conexão de rede! Conecte um **cabo de rede RJ45** OU conecte seu celular no Wi-Fi **'Configurar-Monitor-Igreja'** para configurar."*
  * Pelo celular, você pode escolher o novo Wi-Fi da igreja e salvar, ou apenas plugar o cabo.

---

## 📋 Lista de Materiais e Preparação Futura

Quando você for montar este projeto físico para a igreja, precisará de:

1. **Hardware:**
   * 1x TV Box (Allwinner H313, Rockchip RK3318, Amlogic S905X ou similar).
   * 1x Cartão MicroSD de 8 GB ou 16 GB (Classe 10) para o Armbian/Alpine (não precisa de HD externo, pois o sistema é super enxuto).
   * 1x Cabo HDMI curto para prender atrás da TV.
   * Fonte de alimentação da TV Box (5V 2A).

2. **Softwares Base Sugeridos:**
   * **SO:** Armbian Minimal (Debian Bookworm) ou Alpine Linux.
   * **Kiosk:** `chromium-browser` ou `cog` (WPE WebKit).
   * **Painel Admin:** Script Python Flask com `nmcli` (NetworkManager) ou um binário único em Go.
   * **Descoberta de Rede:** `avahi-daemon` (para acessar via `http://monitor.local`).

---

## 📌 Status
> **Nota de Planejamento:** Documentação arquitetada e registrada para execução futura quando a nova TV Box for adquirida. Todo o conceito respeita as lições aprendidas de otimização de memória e estabilidade da TV Box `R001`.
