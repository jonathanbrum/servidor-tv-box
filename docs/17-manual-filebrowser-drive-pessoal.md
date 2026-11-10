# 📁 File Browser — Seu "Google Drive" Pessoal na TV Box

O **File Browser** transforma o HD externo de 1 TB da sua TV Box em uma nuvem particular de arquivos de alta velocidade e baixíssimo consumo. Com ele, você pode dar contas para seus amigos, definir o que cada um pode ver/subir, e gerar links públicos de download.

---

## ⚡ Acesso Rápido

* **Local (Sua Casa):** `http://<IP_DA_TV_BOX>:8082` (ou clique no ícone **File Browser** no CasaOS).
* **Usuário Padrão:** `admin`
* **Senha Inicial:** *(consulte o arquivo local `CREDENCIAIS_LOCAIS.md`)*
* **Consumo de Memória:** Apenas **~17 MB de RAM** (escrito em Go, ultra leve).
* **Onde os arquivos ficam gravados:** `/DATA/AppData/filebrowser/srv` (direto na partição blindada do HD de 1 TB).

---

## 👥 1. Como Criar uma Conta para um Amigo

Você pode dar acesso exclusivo para seus amigos sem que eles vejam os seus arquivos particulares:

1. Acesse o File Browser com a conta `admin`.
2. Clique no menu lateral esquerdo em **Configurações** (ícone de engrenagem) ➡️ **Gerenciamento de Usuários**.
3. Clique em **+ Novo**.
4. Preencha os campos:
   * **Usuário:** Nome do seu amigo (ex.: `lucas`).
   * **Senha:** Defina uma senha (mínimo de 12 caracteres por segurança).
   * **Escopo (Pasta do Usuário):** 
     * Se deixar `.`, ele verá tudo na pasta raiz.
     * Se colocar `/lucas`, o File Browser cria uma pasta isolada só para ele (ele só vê e mexe no que está lá dentro!).
5. **Permissões (O que ele pode fazer):**
   * Marque se ele pode **Enviar arquivos (Upload)**, **Baixar**, **Renomear**, **Deletar** ou **Compartilhar**.
   * *Dica:* Se for só para baixar coisas que você compartilha com ele, desmarque "Modificar", "Criar" e "Deletar".
6. Clique em **Salvar**.

---

## 🔗 2. Como Compartilhar um Arquivo/Pasta com Link Público

Igualzinho ao Google Drive ou WeTransfer, você pode mandar um link para qualquer pessoa baixar:

1. Passe o mouse sobre o arquivo ou pasta que deseja compartilhar.
2. Clique no botão de **Compartilhar** (ícone de link/compartilhamento no topo ou no menu do arquivo).
3. Na janela que abrir:
   * Escolha o tempo de expiração do link (ex.: 1 hora, 1 dia, 7 dias ou permanente).
   * *(Opcional)* Defina uma senha para proteger o download.
4. Clique em **Gerar Link** e copie a URL para mandar no WhatsApp ou Discord!

---

## 🌍 3. Como Acessar de Fora de Casa (Pela Internet)

Seus amigos não estão conectados no Wi-Fi da sua casa. Para eles acessarem pela internet:

### Opção A: Cloudflare Tunnel (Recomendado — Link com HTTPS Grátis)
Como a TV Box já possui o container `cloudflared` configurado:
1. Abra o painel [dash.cloudflare.com](https://dash.cloudflare.com) ➡️ **Zero Trust** ➡️ **Networks** ➡️ **Tunnels**.
2. Clique no seu túnel ➡️ **Configure** ➡️ aba **Public Hostname** ➡️ **Add a public hostname**.
3. Configure:
   * **Subdomínio:** `drive` (ex: `drive.seusite.com`).
   * **Service:** `HTTP` `127.0.0.1:8082`.
4. Pronto! Qualquer amigo acessa `https://drive.seusite.com` de qualquer lugar do planeta.

### Opção B: Tailscale
Se você e seu amigo usam o Tailscale:
* O File Browser responde no IP do Tailscale na porta `8082` (`http://100.x.y.z:8082`).

---

## 🛠️ 4. Onde Ficam os Dados no Servidor?

Toda a estrutura está isolada no HD externo:
* `/DATA/AppData/filebrowser/srv` ➡️ Raiz onde os arquivos e pastas dos usuários são guardados.
* `/DATA/AppData/filebrowser/database/filebrowser.db` ➡️ Banco SQLite com as contas, senhas criptografadas e links de compartilhamento.
* `/DATA/AppData/filebrowser/config/settings.json` ➡️ Preferências do sistema.

> [!NOTE]
> Você pode abrir a pasta `/DATA/AppData/filebrowser/srv` diretamente pelo app **Files** do CasaOS ou via rede local do Windows para jogar arquivos grandes na velocidade máxima do cabo de rede!
