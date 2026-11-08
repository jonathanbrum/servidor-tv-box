#!/usr/bin/env node
/**
 * MCP Server Portátil — Mini-VPS TV Box (R001 / X96Q v5.1)
 * Zero dependências externas (Node.js built-in modules apenas).
 * Lê o IP automaticamente de CREDENCIAIS_LOCAIS.md ou variável TVBOX_HOST.
 */

import { execFile } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = resolve(__dirname, "..", "..", "..");

function getTvBoxHost() {
  if (process.env.TVBOX_HOST) return process.env.TVBOX_HOST;
  const credPath = resolve(WORKSPACE_ROOT, "CREDENCIAIS_LOCAIS.md");
  if (existsSync(credPath)) {
    try {
      const content = readFileSync(credPath, "utf8");
      const match = content.match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/);
      if (match) return match[1];
    } catch {
      // fallback
    }
  }
  return "tvbox.local";
}

function runSshCommand(remoteCommand, timeoutMs = 30000) {
  const host = getTvBoxHost();
  return new Promise((resolvePromise) => {
    execFile(
      "ssh",
      [
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=8",
        "-o",
        "StrictHostKeyChecking=accept-new",
        `root@${host}`,
        remoteCommand,
      ],
      { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          resolvePromise({
            isError: true,
            text: `Erro SSH (${host}): ${error.message}\nSTDOUT:\n${stdout || ""}\nSTDERR:\n${stderr || ""}`.trim(),
          });
        } else {
          resolvePromise({
            isError: false,
            text: (stdout + (stderr ? `\n[STDERR]\n${stderr}` : "")).trim() || "(Comando concluído sem saída)",
          });
        }
      }
    );
  });
}

const TOOLS = [
  {
    name: "tvbox_status",
    description:
      "Retorna o painel completo de saúde da Mini-VPS TV Box via SSH: Uptime, Temperatura da CPU, RAM, ZRAM/Swap, uso do HD de 300 GB (/dev/sda1), Quirk USB e Containers Docker ativos.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "tvbox_exec",
    description:
      "Executa qualquer comando shell como root via SSH na Mini-VPS TV Box e retorna stdout/stderr.",
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Comando bash a ser executado na TV Box.",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "tvbox_smart",
    description:
      "Lê o relatório S.M.A.R.T. completo e temperatura física do HD Externo USB Seagate (/dev/sda) conectado na TV Box.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "tvbox_power",
    description:
      "Desliga (poweroff) ou reinicia (reboot) a TV Box com segurança sincronizando os discos antes.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["poweroff", "reboot"],
          description: "Ação de energia: 'poweroff' para desligar ou 'reboot' para reiniciar.",
        },
      },
      required: ["action"],
    },
  },
];

async function handleToolCall(name, args = {}) {
  switch (name) {
    case "tvbox_status": {
      const cmd = [
        'echo "=== UPTIME & TEMPERATURA ==="',
        'uptime && awk \'{printf "CPU Temp: %.1f°C\\n", $1/1000}\' /sys/class/thermal/thermal_zone0/temp 2>/dev/null || true',
        'echo ""',
        'echo "=== MEMORIA RAM & SWAP ==="',
        "free -h",
        'echo ""',
        'echo "=== ARMAZENAMENTO (BOOT SD + HD 300GB) ==="',
        "df -h / /boot && lsblk",
        'echo ""',
        'echo "=== CONTAINERS DOCKER ==="',
        'docker ps --format "table {{.Names}}\\t{{.Status}}\\t{{.Ports}}"',
      ].join(" && ");
      return await runSshCommand(cmd);
    }
    case "tvbox_exec": {
      if (!args.command) {
        return { isError: true, text: "Parâmetro 'command' é obrigatório." };
      }
      return await runSshCommand(args.command);
    }
    case "tvbox_smart": {
      return await runSshCommand("smartctl -a /dev/sda");
    }
    case "tvbox_power": {
      if (args.action !== "poweroff" && args.action !== "reboot") {
        return { isError: true, text: "Ação inválida. Use 'poweroff' ou 'reboot'." };
      }
      return await runSshCommand(`sync && nohup ${args.action} >/dev/null 2>&1 & echo "Sinal ${args.action} enviado com segurança!"`);
    }
    default:
      return { isError: true, text: `Ferramenta desconhecida: ${name}` };
  }
}

const rl = createInterface({
  input: process.stdin,
  terminal: false,
});

function sendJson(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

rl.on("line", async (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }

  const { id, method, params } = msg;

  if (method === "initialize") {
    sendJson({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: params?.protocolVersion || "2024-11-05",
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: "tvbox-ssh-mcp",
          version: "1.0.0",
        },
      },
    });
  } else if (method === "notifications/initialized") {
    // No response required for notification
  } else if (method === "tools/list") {
    sendJson({
      jsonrpc: "2.0",
      id,
      result: {
        tools: TOOLS,
      },
    });
  } else if (method === "tools/call") {
    const res = await handleToolCall(params?.name, params?.arguments);
    sendJson({
      jsonrpc: "2.0",
      id,
      result: {
        content: [{ type: "text", text: res.text }],
        isError: res.isError,
      },
    });
  } else if (id !== undefined) {
    sendJson({
      jsonrpc: "2.0",
      id,
      error: {
        code: -32601,
        message: `Method not found: ${method}`,
      },
    });
  }
});
