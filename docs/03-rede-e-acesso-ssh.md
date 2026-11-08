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
ssh root@<IP_DA_TV_BOX>
```

### Dados da Chave Criptográfica do Servidor
No primeiro acesso, o SSH valida a identidade da TV Box usando chave `ED25519` (`SHA256:<FINGERPRINT_DO_SERVIDOR>`).

Após confirmar com `yes` e inserir a senha do `root`, o terminal remoto fica disponível em `root@x96q-v5-1:~#`.
