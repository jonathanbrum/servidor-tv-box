# 10 - Manual Prático: CasaOS (Arquivos, RAM, NAS) & Node-RED (Automações e APIs)

[⬅️ Voltar para a Wiki Principal](../README.md) | [⬅️ Anterior: 09 - Manual do PocketBase](09-manual-pocketbase-banco-e-api.md)

---

## 🏠 Parte 1: Como Usar o CasaOS no Dia a Dia (`http://<IP_DA_TV_BOX>`)

O **CasaOS** é a central de controle da sua TV Box. Aqui estão os atalhos que você mais vai usar:

### 1. Ligar, Desligar ou Reiniciar um App (Economizar Memória RAM)
* Passe o mouse por cima do ícone de qualquer app na tela inicial e clique nos **3 pontinhos (`⋮`)** no canto superior direito do ícone:
  * **Desligar / Parar:** Desliga aquele servidor na hora e libera 100% da memória RAM que ele estava usando (seus dados continuam salvos no HD de 1 TB!).
  * **Reiniciar:** Reinicia o app caso tenha mudado alguma configuração.

### 2. Ver Logs ou Abrir o Terminal de um App
* Clique nos **3 pontinhos (`⋮`)** do app ➡️ **`Configurações`**.
* No topo direito da janela que abrir, clique no quadradinho **`Terminal e Logs`** (`>_`):
  * **Aba `Logs`:** Mostra o que está acontecendo dentro do app (ótimo para descobrir senhas iniciais ou erros).
  * **Aba `Terminal`:** Abre uma linha de comando direto dentro daquele container.

### 3. Transformar o HD de 1 TB num "Disco de Rede" no seu Windows (NAS)
Quer abrir os **904 GB livres** da TV Box direto no **Windows Explorer** do seu PC como se fosse uma pasta normal do Windows?
1. Abra o app **`Files` (Arquivos)** no CasaOS.
2. Clique com o **botão direito** em qualquer pasta (ex.: crie uma pasta chamada `MeusArquivos` dentro de `/DATA`) e clique em **`Compartilhar` (Share)**.
3. Ele vai te mostrar um caminho de rede (ex.: `\\<IP_DA_TV_BOX>\MeusArquivos`).
4. Basta colar esse caminho na barra do **Windows Explorer** do seu PC e você pode salvar filmes, backups e projetos direto no HD de 1 TB pela rede!

---

## 🧩 Parte 2: Como Usar o Node-RED (Backends, Bots e Automação Sem Código Pesado)

O **Node-RED** permite criar **APIs de Backend**, **Bots de Telegram/Discord**, **Rotinas Agendadas** e **Automação Residencial** apenas ligando bloquinhos na tela.

### A Regra dos 3 Blocos no Node-RED:
Todo fluxo no Node-RED funciona ligando uma linha da esquerda para a direita:
1. **Bloco de Entrada (Esquerda):** *O que dispara a ação?*
   * `inject`: Dispara quando você clica nele OU em um horário programado (ex.: a cada 5 minutos, ou todo dia às 08:00).
   * `http in`: Cria uma rota de API (ex.: `GET /minha-api`).
2. **Bloco de Processamento (Meio):** *O que ele faz?*
   * `function`: Permite escrever algumas linhas de JavaScript (`msg.payload = ...`).
   * `http request`: Faz uma chamada para qualquer site, API externa ou para o seu **PocketBase**!
3. **Bloco de Saída (Direita):** *O que ele devolve ou aciona?*
   * `http response`: Devolve o JSON para quem chamou sua API.
   * `debug`: Mostra o resultado na aba lateral direita (ícone de besouro 🐞) para você testar.

---

### ⚡ Exemplo Prático 1: Criar uma API no Node-RED em 30 Segundos
1. Na paleta da esquerda, arraste o bloco **`http in`** para a tela:
   * Dê dois cliques nele, escolha Method **`GET`** e em URL digite `/status-servidor`.
2. Arraste o bloco **`function`** para o meio da tela, dê dois cliques nele e escreva:
   ```javascript
   msg.payload = {
     servidor: "TV Box R001 online!",
     horario: new Date().toISOString()
   };
   return msg;
   ```
3. Arraste o bloco **`http response`** para a direita.
4. Ligue as bolinhas (`http in` ➡️ `function` ➡️ `http response`) e clique no botão vermelho **`Deploy`** no canto superior direito!
5. Pronto! Se você abrir `http://<IP_DA_TV_BOX>:1880/status-servidor` (na porta do Node-RED), sua API já responde o JSON na hora!

---

### ➕ Como Instalar Novos Bloquinhos no Node-RED (Telegram, Discord, Alexa, Tuya/SmartHome)
O Node-RED tem mais de **4.000 pacotes gratuitos** prontos para instalar com 1 clique:
1. No topo direito do Node-RED (ao lado do botão vermelho *Deploy*), clique no menu de **3 risquinhos (`☰`)** ➡️ **`Manage palette`** (Gerenciar paleta).
2. Clique na aba **`Install`**.
3. Pesquise o que você quer controlar e clique em **Install**:
   * `node-red-contrib-telegrambot` (Criar bots de Telegram)
   * `node-red-contrib-home-assistant-websocket` (Integrar com Home Assistant)
   * `node-red-contrib-tuya-smart-device` (Controlar lâmpadas e tomadas inteligentes Tuya/SmartLife)
