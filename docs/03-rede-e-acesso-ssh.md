# 03 - Rede Ethernet e Acesso Remoto (SSH)

[⬅️ Voltar para a Wiki Principal](../README.md)

---

## 1. Conexão Física e DHCP
Após conectar o cabo de rede (RJ45) entre a TV Box e o roteador:
* O roteador identificou automaticamente o cliente **`x96q-v5-1`**.
* **Endereço IP atribuído via DHCP:** `<IP_DA_TV_BOX>` *(consulte o painel do roteador ou o arquivo local privado)*

---

## 2. Acesso SSH pelo Windows PowerShell

Para gerenciar o servidor diretamente pelo computador (facilitando copiar e colar comandos), utiliza-se o cliente OpenSSH nativo do Windows:

```powershell
ssh root@tvbox.local
# ou via IP: ssh root@<IP_DA_TV_BOX>
```

### Dados da Chave Criptográfica do Servidor
No primeiro acesso, o SSH valida a identidade da TV Box usando chave `ED25519` (`SHA256:<FINGERPRINT_DO_SERVIDOR>`).

Após confirmar com `yes` e inserir a senha do `root`, o terminal remoto fica disponível em `root@tvbox:~#`.

---

## 3. Wi-Fi Interno (`SSV6006C` / `SSV6256P`) como Fallback Automático + Central Web UI

A placa `X96Q v5.1` (`R001`) possui um chip Wi-Fi Dual-Band (2.4 GHz e 5 GHz) soldado no barramento SDIO (`mmc3:0001:1`, ID `3030:3030`, chip **iComm SSV6006C / SSV6256P**).

Por padrão, a imagem comunitária do Armbian tentava carregar o driver Unisoc (`sprdwl_ng` / `aw859a-wifi.service`), que falhava com *timeout* após 35 segundos no boot. Para ativar o Wi-Fi interno sem alterar o Kernel congelado (`6.12.64-current-sunxi64`):

1. **Driver `ssv6x5x.ko` Compilado sob Medida:**
   * Compilado a partir do port para Kernel 6.12 (`cdhigh/armbian_sv6256p`) sincronizado com o `/boot/config-6.12.64-current-sunxi64` da placa (`CONFIG_DEBUG_INFO_BTF_MODULES` desativado para preservar o alinhamento binário `0x490` de `struct module`).
   * Instalado em `/lib/modules/6.12.64-current-sunxi64/kernel/drivers/net/wireless/ssv6256p/ssv6x5x.ko` com carregamento automático em `/etc/modules-load.d/ssv6x5x.conf`.
   * O driver conflitante Unisoc foi desativado (`systemctl disable aw859a-wifi.service` e `/etc/modprobe.d/blacklist-unisoc-wifi.conf`).
2. **Arquitetura de Prioridade e Fallback Automático (`end0` + `wlan0`):**
   * **Cabo Ethernet (`end0`):** Gerenciado pelo `systemd-networkd` (métrica padrão prioritária). Enquanto o cabo estiver plugado, todo o tráfego usa o cabo.
   * **Wi-Fi (`wlan0`):** Gerenciado pelo `NetworkManager` com `connection.autoconnect yes` e `ipv4.route-metric 600`. Se a TV Box for ligada na tomada longe do roteador (sem cabo), ela conecta sozinha no Wi-Fi salvo!
   * **mDNS Híbrido (`http://tvbox.local`):** O arquivo `/etc/avahi/avahi-daemon.conf` foi atualizado para `allow-interfaces=end0,wlan0`, garantindo que `http://tvbox.local` funcione tanto no cabo quanto no Wi-Fi sem conflitar com as pontes do Docker.
3. **Central Wi-Fi & Fallback no CasaOS (`http://tvbox.local:1885`):**
   * Serviço leve em Python (`/usr/local/bin/tvbox-wifi-webui.py`, gerenciado por `tvbox-wifi-webui.service`) com atalho **"Wi-Fi & Rede"** direto na tela inicial do CasaOS.
   * Permite escanear redes 2.4 GHz e 5 GHz, ver intensidade de sinal, conectar/salvar senha com 1 clique e esquecer redes antigas pelo navegador.
