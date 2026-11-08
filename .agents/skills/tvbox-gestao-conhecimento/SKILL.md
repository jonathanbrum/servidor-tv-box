---
name: tvbox-gestao-conhecimento
description: >-
  Fluxo de trabalho para atualizar a documentação viva (Wiki Docsify), sanitizar credenciais antes de commits, sincronizar com o GitHub (que atualiza automaticamente a Wiki na TV Box) e criar ou aprimorar Skills do projeto. Use esta skill sempre que uma novidade relevante do servidor TV Box for descoberta, configurada ou alterada, ou quando o usuário pedir para documentar algo ou criar uma nova skill.
---

# 📚 Gestão de Conhecimento, Wiki Viva e Evolução de Skills

Este projeto funciona como um **ecossistema vivo de manutenção**: tudo o que é descoberto, corrigido ou instalado na TV Box vira documentação clara para o usuário na Wiki (`docs/`) e conhecimento estruturado para o Agente (`.agents/skills/`).

---

## 📋 1. Onde Registrar Cada Tipo de Novidade?

1. **Novos Manuais de Uso Diário (Apps, Bancos, Automações, Deploys):**
   * Atualize os capítulos `docs/07-*.md` a `docs/10-*.md` ou crie um novo guia numerado (ex.: `docs/11-nome-do-guia.md`).
   * Sempre inclua no topo do arquivo o link de retorno: `[⬅️ Voltar para a Wiki Principal](../README.md)`.
2. **Descobertas de Hardware, Kernel, Armazenamento ou Rede de Baixo Nível:**
   * Adicione aos capítulos técnicos `docs/01-*.md` a `docs/06-*.md` (e mantenha o resumo atualizado na seção expansiva `<details>` do `README.md`).
3. **Atualização da Barra Lateral e Painel Principal (Docsify):**
   * Se criou um novo arquivo em `docs/`, adicione-o imediatamente em **`_sidebar.md`** e na tabela **"⚡ O que Você Quer Fazer Agora?"** do **`README.md`**.
4. **Credenciais, IPs Reais, Senhas ou Chaves Criadas:**
   * Registre **exclusivamente** no arquivo local **`CREDENCIAIS_LOCAIS.md`** (que é ignorado pelo Git).

---

## 🧠 2. Como Criar ou Evoluir uma Skill de Manutenção (`.agents/skills/`)

Se durante o suporte ao usuário você realizou um procedimento técnico útil que pode ser necessário novamente no futuro (ex.: configurar backup automático, adicionar túnel Cloudflare/Tailscale, otimizar banco SQLite do PocketBase, configurar MQTT para sensores ESP32):

1. Verifique se o tema cabe em uma das skills existentes (`tvbox-manutencao-e-diagnostico` ou `tvbox-deploy-projetos`) ou se merece uma **nova pasta** em `.agents/skills/<nome-da-skill>/SKILL.md`.
2. Estruture o `SKILL.md` com:
   * Frontmatter YAML (`name` em kebab-case e `description` detalhando exatamente quando ativar a skill).
   * Comandos diretos testados no Armbian Bookworm (`aarch64`).
   * Passos de validação (como confirmar que funcionou).
3. Liste a nova Skill na seção **"Skills Atuais do Projeto"** dentro do arquivo `AGENTS.md` na raiz do projeto.

---

## 🔒 3. Checklist de Segurança e Publicação (GitHub ➡️ TV Box)

Como o container `wiki-tvbox-sync` na TV Box puxa a branch `main` do repositório `jonathanbrum/servidor-tv-box` a cada 60 segundos e publica em `http://<IP_DA_TV_BOX>:8090/wiki/`:

1. **Auditoria de Dados Sensíveis (Antes do `git commit`):**
   * Verifique se nenhum IP privado real, senha ou token vazou nos arquivos `.md` rastreados:
     ```powershell
     git status
     git diff
     ```
   * Nos arquivos públicos, use sempre `<IP_DA_TV_BOX>`, `<SENHA_ROOT>` ou `<SUA_SENHA>`.
2. **Sincronização com o GitHub (Auto-Deploy na Wiki da TV Box):**
   ```powershell
   git add README.md _sidebar.md AGENTS.md docs/ .agents/
   git commit -m "docs: atualiza base de conhecimento e skills de manutencao"
   git push origin main
   ```
   *(Em até 60 segundos após o `git push`, a página `http://<IP_DA_TV_BOX>:8090/wiki/` na TV Box estará atualizada automaticamente!).*
