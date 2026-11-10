#!/usr/bin/env python3
"""
TV Box Remote Hub - Mapeamento Visual, Catálogo de Ações/APIs, Trava por Sequência, Combos e LED Bicolor
Porta: 1886 (IPv4/IPv6 Dual-Stack http://tvbox.local:1886)
Leitura direta de /dev/input/event5 (sunxi-ir / NEC)
Controle de Hardware LED: Pino PH5 (GPIO 229) - LED Bicolor (1 = Azul / 0 = Vermelho)
Hardware: Allwinner H313 (R001 / X96Q v5.1)
"""

import os
import sys
import time
import json
import struct
import select
import threading
import subprocess
import socket
import glob
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse

try:
    import gpiod
    HAS_GPIOD = True
except ImportError:
    HAS_GPIOD = False

CONFIG_FILE = "/etc/tvbox-remote/config.json"
LED_PIN = 229  # Pino PH5 do SoC Allwinner H313

def find_ir_device():
    """Detecta dinamicamente o arquivo /dev/input/eventX do sensor sunxi-ir."""
    # 1. Busca por subsistema rc (sunxi-ir)
    rc_events = glob.glob("/sys/class/rc/rc*/input*/event*")
    if rc_events:
        node = os.path.basename(rc_events[0])
        dev_path = f"/dev/input/{node}"
        if os.path.exists(dev_path):
            return dev_path
            
    # 2. Busca por nome 'sunxi-ir' nos dispositivos de input
    for name_path in glob.glob("/sys/class/input/event*/device/name"):
        try:
            with open(name_path, "r") as f:
                if "sunxi-ir" in f.read().lower():
                    event_dir = os.path.dirname(os.path.dirname(name_path))
                    dev_path = f"/dev/input/{os.path.basename(event_dir)}"
                    if os.path.exists(dev_path):
                        return dev_path
        except Exception:
            pass
            
    # 3. Fallbacks comuns em TV Boxes H313
    for cand in ["/dev/input/event0", "/dev/input/event5"]:
        if os.path.exists(cand):
            return cand
    return None

EVENT_FORMAT = "qqHHi"
EVENT_SIZE = struct.calcsize(EVENT_FORMAT)
EV_MSC = 4
MSC_SCAN = 4

state_lock = threading.Lock()
sse_lock = threading.Lock()
led_lock = threading.Lock()

state = {
    "device_connected": False,
    "last_scancode": None,
    "last_button_id": None,
    "last_button_name": None,
    "last_timestamp": 0,
    "is_unlocked": False,
    "unlock_expires": 0,
    "sequence_buffer": [],
    "last_seq_press_time": 0,
    "recording_mode": False,
    "recording_type": "physical",
    "record_buffer": [],
    "events_log": [],
    "sse_clients": [],
    "current_led_color": "blue" # 'blue' ou 'red'
}

default_actions = [
    {
        "id": "act-poweroff",
        "name": "🛑 Desligar Servidor",
        "category": "Sistema",
        "type": "system",
        "command": "poweroff",
        "desc": "Executa sync duplo e poweroff seguro no HD e Linux (LED fica vermelho no Standby)"
    },
    {
        "id": "act-reboot",
        "name": "🔄 Reiniciar Servidor",
        "category": "Sistema",
        "type": "system",
        "command": "reboot",
        "desc": "Reinicia o sistema operacional da TV Box"
    },
    {
        "id": "act-drop-caches",
        "name": "🧹 Limpar Memória RAM",
        "category": "Sistema",
        "type": "system",
        "command": "drop_caches",
        "desc": "Libera memória RAM inativa e caches sujos (drop_caches 3)"
    },
    {
        "id": "act-tela-toggle",
        "name": "🖥️ Ligar/Desligar TelaP2P",
        "category": "Docker",
        "type": "docker_toggle",
        "target": "tela",
        "desc": "Inicia ou pausa o container de compartilhamento de tela"
    },
    {
        "id": "act-nodered-webhook",
        "name": "🧩 Disparar Webhook Node-RED",
        "category": "API",
        "type": "webhook",
        "target": "http://127.0.0.1:1880/api/remote-action",
        "desc": "Chama endpoint HTTP local no Node-RED"
    }
]

default_config = {
    "debounce_ms": 300,
    "led_pin": 229,
    "security_sequence": {
        "enabled": True,
        "sequence": ["1", "2", "3"],
        "sequence_display": "1 ➔ 2 ➔ 3",
        "timeout_seconds": 6,
        "unlock_duration_seconds": 15
    },
    "custom_sequences": [],
    "actions": default_actions,
    "buttons": [
        { "id": "btn-power", "scancode": "0x140", "name": "Power", "action_id": "act-poweroff", "require_unlock": True, "enabled": True },
        { "id": "btn-back",  "scancode": "0x119", "name": "Back",  "action_id": "none", "require_unlock": False, "enabled": True },
        { "id": "btn-up",    "scancode": "0x116", "name": "Cima",  "action_id": "none", "require_unlock": False, "enabled": True },
        { "id": "btn-down",  "scancode": "0x11a", "name": "Baixo", "action_id": "none", "require_unlock": False, "enabled": True },
        { "id": "btn-left",  "scancode": "0x151", "name": "Esquerda", "action_id": "none", "require_unlock": False, "enabled": True },
        { "id": "btn-right", "scancode": "0x150", "name": "Direita", "action_id": "none", "require_unlock": False, "enabled": True },
        { "id": "btn-ok",    "scancode": "0x113", "name": "OK",     "action_id": "none", "require_unlock": False, "enabled": True }
    ]
}

# --- GERENCIADOR DO LED BICOLOR (PH5 / PINO 229) ---
gpiod_chip = None
gpiod_line = None

def init_bicolor_led():
    global gpiod_chip, gpiod_line
    if not HAS_GPIOD:
        return
    try:
        if gpiod_line is None:
            gpiod_chip = gpiod.Chip("gpiochip0")
            gpiod_line = gpiod_chip.get_line(LED_PIN)
            gpiod_line.request(consumer="remote-bicolor-led", type=gpiod.LINE_REQ_DIR_OUT)
        gpiod_line.set_value(1) # 1 = Azul (Modo Ligado / Operação Normal)
        state["current_led_color"] = "blue"
    except Exception as e:
        print(f"[RemoteHub] Aviso inicializando LED bicolor (pino {LED_PIN}): {e}")

def set_led_color(color):
    """color: 'blue' (1) ou 'red' (0)"""
    global gpiod_line
    with led_lock:
        val = 1 if color == "blue" else 0
        state["current_led_color"] = color
        if gpiod_line is None:
            init_bicolor_led()
        if gpiod_line is not None:
            try:
                gpiod_line.set_value(val)
                return True
            except Exception as e:
                print(f"[RemoteHub] Erro set_value LED: {e}")
        try:
            subprocess.run(["gpioset", "gpiochip0", f"{LED_PIN}={val}"], timeout=1)
            return True
        except Exception:
            return False

def pulse_ir_feedback(duration=0.12):
    """Pisca para vermelho por um breve instante ao ler o controle e volta para azul"""
    def _pulse():
        set_led_color("red")
        time.sleep(duration)
        if not state.get("is_unlocked", False):
            set_led_color("blue")
    threading.Thread(target=_pulse, daemon=True).start()

def unlock_blinker_worker():
    """Pisca o LED bicolor lentamente enquanto a trava estiver desbloqueada, voltando para azul fixo ao bloquear."""
    while True:
        try:
            now = time.time()
            if state.get("is_unlocked", False) and now < state.get("unlock_expires", 0):
                set_led_color("red")
                time.sleep(0.45)
                if state.get("is_unlocked", False) and time.time() < state.get("unlock_expires", 0):
                    set_led_color("blue")
                    time.sleep(0.45)
            else:
                if state.get("is_unlocked", False) and now >= state.get("unlock_expires", 0):
                    with state_lock:
                        state["is_unlocked"] = False
                    set_led_color("blue")
                    broadcast_sse({"type": "lock_update", "status": get_lock_status()})
                    log_event("SYS", "Trava de Segurança", "🔒 Tempo esgotado: Controle Bloqueado automaticamente.", "warning", is_mapped=True)
                
                if state.get("current_led_color") != "blue" and not state.get("is_unlocked", False):
                    time.sleep(0.15)
                    if not state.get("is_unlocked", False):
                        set_led_color("blue")
                time.sleep(0.2)
        except Exception:
            time.sleep(1)

# --- CONFIGURAÇÃO ---
def load_config():
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                cfg = json.load(f)
                if "security_sequence" not in cfg or not cfg["security_sequence"].get("sequence"):
                    cfg["security_sequence"] = default_config["security_sequence"]
                if "actions" not in cfg or not cfg["actions"]:
                    cfg["actions"] = default_actions
                if "buttons" not in cfg:
                    cfg["buttons"] = default_config["buttons"]
                if "custom_sequences" not in cfg:
                    cfg["custom_sequences"] = []
                return cfg
        except Exception as e:
            print(f"[RemoteHub] Erro lendo config: {e}")
    os.makedirs(os.path.dirname(CONFIG_FILE), exist_ok=True)
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(default_config, f, indent=2)
    return default_config

def save_config(cfg):
    os.makedirs(os.path.dirname(CONFIG_FILE), exist_ok=True)
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2)

current_config = load_config()

# --- STATUS DA TRAVA ---
def get_lock_status():
    now = time.time()
    seq_cfg = current_config.get("security_sequence", {})
    if not seq_cfg.get("enabled", True):
        return {
            "locked": False,
            "remaining": 0,
            "enabled": False,
            "sequence": seq_cfg.get("sequence_display", "Desativada")
        }
    
    if state["is_unlocked"] and now < state["unlock_expires"]:
        return {
            "locked": False,
            "remaining": max(0, int(state["unlock_expires"] - now)),
            "enabled": True,
            "sequence": seq_cfg.get("sequence_display", "1 ➔ 2 ➔ 3")
        }
    else:
        state["is_unlocked"] = False
        return {
            "locked": True,
            "remaining": 0,
            "enabled": True,
            "sequence": seq_cfg.get("sequence_display", "1 ➔ 2 ➔ 3")
        }

def trigger_unlock(duration_s=None):
    seq_cfg = current_config.get("security_sequence", {})
    dur = duration_s or seq_cfg.get("unlock_duration_seconds", 15)
    with state_lock:
        state["is_unlocked"] = True
        state["unlock_expires"] = time.time() + dur
        state["sequence_buffer"] = []
    log_event("SYS", "Trava de Segurança", f"🔓 SEQUÊNCIA CORRETA! Desbloqueado por {dur}s!", "success")
    broadcast_sse({"type": "lock_update", "status": get_lock_status()})

def broadcast_sse(data_dict):
    msg = f"data: {json.dumps(data_dict)}\n\n".encode("utf-8")
    with sse_lock:
        dead = []
        for client in list(state["sse_clients"]):
            try:
                client.wfile.write(msg)
                client.wfile.flush()
            except Exception:
                dead.append(client)
        for d in dead:
            if d in state["sse_clients"]:
                state["sse_clients"].remove(d)

def log_event(scancode, button_name, action_desc, status="ok", button_id=None, is_mapped=True):
    entry = {
        "timestamp": time.strftime("%H:%M:%S"),
        "scancode": scancode or "-",
        "name": button_name or "Desconhecido",
        "action": action_desc,
        "status": status,
        "button_id": button_id
    }
    with state_lock:
        state["events_log"].insert(0, entry)
        if len(state["events_log"]) > 40:
            state["events_log"].pop()
    
    broadcast_sse({
        "type": "event",
        "entry": entry,
        "last_scancode": scancode,
        "button_name": button_name if is_mapped else None,
        "is_mapped": is_mapped,
        "button_id": button_id,
        "buffer": [b["name"] for b in state["sequence_buffer"]],
        "lock_status": get_lock_status(),
        "led_color": state["current_led_color"]
    })

# --- EXECUÇÃO DE AÇÕES ---
def run_action_by_id(action_id, button_name="Manual", scancode="SYS", button_id=None):
    action = None
    for act in current_config.get("actions", []):
        if act.get("id") == action_id:
            action = act
            break
    
    if not action:
        if action_id == "none":
            log_event(scancode, button_name, "Nenhuma ação associada", "muted", button_id)
            return {"status": "ok", "msg": "Nenhuma ação associada"}
        desc = f"Ação '{action_id}' não encontrada"
        log_event(scancode, button_name, desc, "error", button_id)
        return {"status": "error", "msg": desc}

    act_type = action.get("type")
    act_cmd = action.get("command") or action.get("target") or ""
    act_name = action.get("name", action_id)

    try:
        if act_type == "system":
            if act_cmd == "poweroff":
                desc = "🛑 Desligando servidor... (LED vermelho de Standby aceso)"
                log_event(scancode, button_name, desc, "warning", button_id)
                set_led_color("red")
                time.sleep(1.2)
                subprocess.run(["sync"])
                subprocess.run(["sync"])
                subprocess.run(["hdparm", "-y", "/dev/sda"], stderr=subprocess.DEVNULL)
                time.sleep(1.0)
                subprocess.run(["systemctl", "poweroff"])
            elif act_cmd == "reboot":
                desc = "🔄 Reiniciando servidor..."
                log_event(scancode, button_name, desc, "warning", button_id)
                time.sleep(1.2)
                subprocess.run(["sync"])
                subprocess.run(["systemctl", "reboot"])
            elif act_cmd == "drop_caches":
                subprocess.run("sync && echo 3 > /proc/sys/vm/drop_caches", shell=True)
                desc = "🧹 Memória RAM limpa (drop_caches 3)"
                log_event(scancode, button_name, desc, "success", button_id)
            return {"status": "ok", "msg": desc}

        elif act_type == "docker_toggle":
            target = act_cmd.strip()
            if target:
                res = subprocess.run(["docker", "inspect", "-f", "{{.State.Running}}", target], capture_output=True, text=True)
                is_running = "true" in res.stdout.lower()
                if is_running:
                    subprocess.run(["docker", "stop", target])
                    desc = f"🐳 Container '{target}' pausado"
                else:
                    subprocess.run(["docker", "start", target])
                    desc = f"🐳 Container '{target}' iniciado"
                log_event(scancode, button_name, desc, "info", button_id)
                return {"status": "ok", "msg": desc}
            return {"status": "error", "msg": "Nome do container vazio"}

        elif act_type == "webhook":
            url = act_cmd.strip()
            if url:
                import urllib.request
                req = urllib.request.Request(url, headers={"User-Agent": "TVBox-RemoteHub/1.0"})
                resp = urllib.request.urlopen(req, timeout=4)
                desc = f"🌐 Webhook disparado ({resp.status}): {url[:35]}"
                log_event(scancode, button_name, desc, "success", button_id)
                return {"status": "ok", "msg": desc, "http_code": resp.status}
            return {"status": "error", "msg": "URL vazia"}

        elif act_type == "shell":
            cmd = act_cmd.strip()
            if cmd:
                subprocess.Popen(cmd, shell=True)
                desc = f"💻 Executado script: {cmd[:30]}..."
                log_event(scancode, button_name, desc, "info", button_id)
                return {"status": "ok", "msg": desc}
            return {"status": "error", "msg": "Comando vazio"}

    except Exception as e:
        desc = f"Erro em [{act_name}]: {str(e)}"
        log_event(scancode, button_name, desc, "error", button_id)
        return {"status": "error", "msg": desc}

# --- COMPARADOR FLEXÍVEL DE SEQUÊNCIA ---
def normalize_key_token(token):
    if not token:
        return ""
    t = str(token).strip().upper()
    if t.startswith("BTN-"):
        t = t[4:]
    return t

def check_sequence_match(buffer_items, target_tokens):
    if len(buffer_items) < len(target_tokens):
        return False
    recent = buffer_items[-len(target_tokens):]
    for b_item, target_t in zip(recent, target_tokens):
        norm_target = normalize_key_token(target_t)
        name_match = normalize_key_token(b_item.get("name")) == norm_target
        id_match = normalize_key_token(b_item.get("id")) == norm_target
        scan_match = normalize_key_token(b_item.get("scancode")) == norm_target
        if not (name_match or id_match or scan_match):
            return False
    return True

# --- PROCESSADOR CENTRAL UNIFICADO DE TECLAS ---
def process_key_event(source, key_id=None, key_name=None, scancode=None):
    now = time.time()
    
    # 1. Feedback visual e físico imediato se não estiver no ciclo de piscar desbloqueado
    if not state.get("is_unlocked", False):
        threading.Thread(target=pulse_ir_feedback, daemon=True).start()

    # Normaliza botão se tivermos o scancode ou id
    matched_btn = None
    if scancode:
        for btn in current_config.get("buttons", []):
            if btn.get("scancode", "").lower() == scancode.lower() and btn.get("enabled", True):
                matched_btn = btn
                break
    elif key_id:
        for btn in current_config.get("buttons", []):
            if btn.get("id", "").lower() == key_id.lower() and btn.get("enabled", True):
                matched_btn = btn
                break

    is_mapped = bool(matched_btn)
    canonical_name = matched_btn.get("name") if matched_btn else key_name
    canonical_id = matched_btn.get("id") if matched_btn else key_id
    canonical_scancode = matched_btn.get("scancode") if matched_btn else scancode

    display_name = canonical_name or canonical_scancode or "Tecla"
    key_entry = { "id": canonical_id or "", "name": display_name, "scancode": canonical_scancode or "" }

    with state_lock:
        state["last_scancode"] = canonical_scancode
        state["last_button_name"] = canonical_name if is_mapped else None
        state["last_button_id"] = canonical_id
        state["last_timestamp"] = now

    # 2. Se estiver em MODO DE GRAVAÇÃO DA SEQUÊNCIA (Trava ou Combo)
    if state["recording_mode"]:
        with state_lock:
            state["record_buffer"].append(key_entry)
            current_rec = list(state["record_buffer"])
        broadcast_sse({
            "type": "recording_step",
            "record_buffer": current_rec,
            "last_key": key_entry
        })
        log_event(canonical_scancode, display_name, f"🔴 Tecla gravada na sequência: {display_name}", "info", canonical_id, is_mapped=is_mapped)
        return

    # 3. MODO NORMAL: Alimenta o buffer de Sequências
    seq_cfg = current_config.get("security_sequence", {})
    sec_enabled = seq_cfg.get("enabled", True)
    target_tokens = seq_cfg.get("sequence", ["1", "2", "3"])
    seq_timeout = float(seq_cfg.get("timeout_seconds", 6))

    with state_lock:
        if (now - state["last_seq_press_time"]) > seq_timeout:
            state["sequence_buffer"] = []
        state["last_seq_press_time"] = now
        state["sequence_buffer"].append(key_entry)
        if len(state["sequence_buffer"]) > 12:
            state["sequence_buffer"].pop(0)
        current_buf = list(state["sequence_buffer"])

    broadcast_sse({
        "type": "buffer_update",
        "buffer": [b["name"] for b in current_buf],
        "last_key": key_entry
    })

    # 4. Verifica se bateu em alguma SEQUÊNCIA / COMBO CUSTOMIZADO
    for c_seq in current_config.get("custom_sequences", []):
        t_tokens = c_seq.get("sequence", [])
        if t_tokens and check_sequence_match(current_buf, t_tokens):
            with state_lock:
                state["sequence_buffer"] = []
            act_id = c_seq.get("action_id", "none")
            s_name = c_seq.get("name", "Combo")
            seq_disp = c_seq.get("sequence_display", " ➔ ".join(t_tokens))
            log_event(canonical_scancode, display_name, f"⚡ Sequência [{seq_disp}] ativada: {s_name}!", "success", canonical_id, is_mapped=True)
            threading.Thread(target=run_action_by_id, args=(act_id, s_name, canonical_scancode, canonical_id), daemon=True).start()
            return

    # 5. Verifica se a sequência confere com a Trava Geral
    if sec_enabled and check_sequence_match(current_buf, target_tokens):
        with state_lock:
            state["sequence_buffer"] = []
        dur = seq_cfg.get("unlock_duration_seconds", 15)
        trigger_unlock(dur)
        return

    # 6. Processamento de Ações Associadas ao Botão Individual
    if not matched_btn:
        log_event(canonical_scancode, display_name, "Botão não configurado", "unmapped", canonical_id, is_mapped=False)
        return

    action_id = matched_btn.get("action_id", "none")
    require_unlock = matched_btn.get("require_unlock", True)

    if sec_enabled and require_unlock:
        lock_st = get_lock_status()
        if lock_st["locked"]:
            seq_disp = seq_cfg.get("sequence_display", "sua sequência")
            log_event(canonical_scancode, display_name, f"🔒 Bloqueado! Digite [{seq_disp}] para autorizar.", "error", canonical_id, is_mapped=True)
            return

    threading.Thread(target=run_action_by_id, args=(action_id, display_name, canonical_scancode, canonical_id), daemon=True).start()

# --- WORKER DO SENSOR INFRAVERMELHO (HARDWARE) ---
def ir_listener_worker():
    global current_config
    last_fire_time = {}
    
    set_led_color("blue")
    
    while True:
        fd = None
        try:
            current_dev = find_ir_device()
            if not current_dev or not os.path.exists(current_dev):
                state["device_connected"] = False
                time.sleep(2)
                continue
            
            fd = os.open(current_dev, os.O_RDONLY)
            state["device_connected"] = True
            print(f"[RemoteHub] Escutando sensor IR em {current_dev}...")
            
            while True:
                r, _, _ = select.select([fd], [], [], 1.0)
                if not r:
                    if state["is_unlocked"] and time.time() >= state["unlock_expires"]:
                        with state_lock:
                            state["is_unlocked"] = False
                        broadcast_sse({"type": "lock_update", "status": get_lock_status()})
                        log_event("SYS", "Trava de Segurança", "🔒 Tempo esgotado: Controle Bloqueado automaticamente.", "warning")
                    continue
                
                buf = os.read(fd, EVENT_SIZE)
                if len(buf) < EVENT_SIZE:
                    continue
                
                sec, usec, ev_type, ev_code, ev_value = struct.unpack(EVENT_FORMAT, buf)
                
                if ev_type == EV_MSC and ev_code == MSC_SCAN:
                    scancode_hex = f"0x{ev_value:x}".lower()
                    now = time.time()
                    
                    debounce_s = float(current_config.get("debounce_ms", 300)) / 1000.0
                    if (now - last_fire_time.get(scancode_hex, 0)) < debounce_s:
                        continue
                    last_fire_time[scancode_hex] = now
                    
                    state["last_scancode"] = scancode_hex
                    state["last_timestamp"] = now
                    
                    process_key_event("HARDWARE_IR", scancode=scancode_hex)
                        
        except Exception as e:
            state["device_connected"] = False
            print(f"[RemoteHub] Exceção no listener IR: {e}")
            if fd is not None:
                try:
                    os.close(fd)
                except Exception:
                    pass
            time.sleep(2)

# --- PÁGINA WEB COMPLETA ---
HTML_PAGE = """<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Controle Remoto TV Box</title>
    <style>
        :root {
            --bg: #090d16;
            --panel-bg: rgba(20, 27, 45, 0.75);
            --border: rgba(255, 255, 255, 0.1);
            --primary: #3b82f6;
            --primary-hover: #2563eb;
            --success: #10b981;
            --warning: #f59e0b;
            --danger: #ef4444;
            --cyan: #06b6d4;
            --text: #f3f4f6;
            --text-muted: #9ca3af;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
        body { background: var(--bg); color: var(--text); min-height: 100vh; padding: 20px; display: flex; flex-direction: column; align-items: center; }
        .container { width: 100%; max-width: 1100px; display: flex; flex-direction: column; gap: 18px; }
        
        header { display: flex; justify-content: space-between; align-items: center; padding: 14px 20px; background: var(--panel-bg); border-radius: 14px; border: 1px solid var(--border); backdrop-filter: blur(10px); }
        .logo { display: flex; align-items: center; gap: 12px; font-size: 1.25rem; font-weight: 700; color: #fff; }
        .logo svg { width: 28px; height: 28px; fill: var(--primary); }
        .header-badges { display: flex; gap: 10px; align-items: center; }
        .status-pill { display: flex; align-items: center; gap: 8px; padding: 6px 14px; border-radius: 20px; font-size: 0.85rem; font-weight: 600; background: rgba(16, 185, 129, 0.15); color: var(--success); border: 1px solid rgba(16, 185, 129, 0.3); }
        .status-pill.locked { background: rgba(245, 158, 11, 0.15); color: var(--warning); border-color: rgba(245, 158, 11, 0.3); }
        .status-pill.unlocked { background: rgba(16, 185, 129, 0.2); color: #34d399; border-color: #34d399; animation: pulseGlow 1.5s infinite; }
        @keyframes pulseGlow { 0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.4); } 70% { box-shadow: 0 0 0 10px rgba(16, 185, 129, 0); } 100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); } }
        
        .lock-banner { display: flex; align-items: center; justify-content: space-between; padding: 12px 20px; border-radius: 12px; background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.3); font-size: 0.9rem; flex-wrap: wrap; gap: 10px; transition: all 0.3s; }
        .lock-banner.unlocked { background: rgba(16, 185, 129, 0.15); border-color: rgba(16, 185, 129, 0.5); box-shadow: 0 0 18px rgba(16, 185, 129, 0.2); }
        .seq-tag { display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px; border-radius: 6px; background: rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.15); font-weight: 700; color: #fbbf24; }
        .live-buffer { display: inline-flex; align-items: center; gap: 6px; margin-left: 8px; padding: 3px 10px; border-radius: 6px; background: rgba(59, 130, 246, 0.2); border: 1px solid rgba(59, 130, 246, 0.4); color: #93c5fd; font-family: monospace; font-size: 0.85rem; }
        .btn-unlock { padding: 6px 14px; border-radius: 8px; border: none; font-size: 0.85rem; font-weight: 600; cursor: pointer; background: var(--primary); color: #fff; transition: 0.15s; }
        .btn-unlock:hover { background: var(--primary-hover); }
        
        .main-layout { display: grid; grid-template-columns: 295px 1fr; gap: 24px; align-items: start; }
        @media(max-width: 860px) { .main-layout { grid-template-columns: 1fr; justify-items: center; } }
        
        /* O CONTROLE REMOTO VIRTUAL */
        .remote-case {
            width: 275px;
            background: linear-gradient(180deg, #181d28 0%, #10141e 50%, #0d1018 100%);
            border: 2px solid #2d3748;
            border-radius: 42px;
            padding: 22px 16px;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.8), inset 0 2px 4px rgba(255, 255, 255, 0.1);
            display: flex;
            flex-direction: column;
            gap: 12px;
            user-select: none;
            transition: border-color 0.3s;
        }
        .remote-case.recording-mode {
            border-color: #06b6d4 !important;
            box-shadow: 0 0 25px rgba(6, 182, 212, 0.4), inset 0 0 10px rgba(6, 182, 212, 0.2) !important;
        }
        .remote-header-led { display: flex; justify-content: center; align-items: center; gap: 6px; margin-bottom: 2px; }
        .physical-led-indicator { width: 12px; height: 12px; border-radius: 50%; background: #0284c7; border: 1px solid #38bdf8; box-shadow: 0 0 10px #0284c7; transition: all 0.1s ease; }
        .physical-led-indicator.red { background: #ef4444; border-color: #f87171; box-shadow: 0 0 14px #ef4444; }
        @keyframes slowBlinkBicolor {
            0%, 49% { background: #ef4444; border-color: #f87171; box-shadow: 0 0 16px #ef4444; }
            50%, 100% { background: #0284c7; border-color: #38bdf8; box-shadow: 0 0 16px #0284c7; }
        }
        .physical-led-indicator.unlocked-pulse {
            animation: slowBlinkBicolor 0.9s infinite ease-in-out !important;
        }
        .selected-mapping {
            outline: 2px solid #06b6d4 !important;
            box-shadow: 0 0 16px rgba(6, 182, 212, 0.9) !important;
            transform: scale(1.08) !important;
        }
        .btn-power-main, .btn-tv-mini, .btn-tv-power, .btn-color, .btn-circle-small, .btn-num {
            position: relative;
        }
        .dpad-ring button, .dpad-arrow, .dpad-center-ok {
            position: absolute !important;
        }
        .btn-power-main.is-mapped, .btn-tv-mini.is-mapped, .btn-tv-power.is-mapped, .btn-color.is-mapped, .btn-circle-small.is-mapped, .btn-num.is-mapped {
            border-color: rgba(52, 211, 153, 0.6) !important;
        }
        .btn-power-main.is-mapped::after,
        .btn-tv-mini.is-mapped::after,
        .btn-tv-power.is-mapped::after,
        .btn-color.is-mapped::after,
        .btn-circle-small.is-mapped::after,
        .btn-num.is-mapped::after {
            content: '';
            position: absolute;
            top: 2px;
            right: 2px;
            width: 5px;
            height: 5px;
            background-color: #34d399;
            border-radius: 50%;
            box-shadow: 0 0 5px #34d399;
            pointer-events: none;
        }
        .dpad-arrow.is-mapped {
            color: #34d399 !important;
            font-weight: 800 !important;
            text-shadow: 0 0 10px rgba(52, 211, 153, 0.9);
        }
        .dpad-center-ok.is-mapped {
            border-color: #34d399 !important;
            color: #34d399 !important;
            box-shadow: 0 0 12px rgba(52, 211, 153, 0.5) !important;
        }
        
        .top-power-row { display: flex; justify-content: space-between; align-items: center; }
        .btn-power-main {
            width: 42px; height: 42px; border-radius: 50%;
            background: linear-gradient(135deg, #ef4444, #b91c1c);
            border: 2px solid #f87171; color: #fff; font-size: 1.1rem;
            display: flex; align-items: center; justify-content: center;
            cursor: pointer; box-shadow: 0 4px 10px rgba(239, 68, 68, 0.3);
            transition: 0.15s;
        }
        .btn-power-main:hover { transform: scale(1.05); }
        
        .tv-control-box {
            border: 1px solid #4a5568; border-radius: 12px;
            padding: 5px; background: rgba(0,0,0,0.3);
            display: flex; flex-direction: column; gap: 4px;
        }
        .tv-control-title { font-size: 0.65rem; color: #a0aec0; text-align: center; font-weight: 700; letter-spacing: 0.5px; }
        .tv-control-grid { display: grid; grid-template-columns: repeat(4, 1fr) 34px; gap: 3px; align-items: center; }
        .btn-tv-mini {
            background: #2d3748; color: #cbd5e1; border: 1px solid #4a5568;
            border-radius: 6px; font-size: 0.65rem; font-weight: 600;
            padding: 5px 0; text-align: center; cursor: pointer; transition: 0.15s;
        }
        .btn-tv-mini:hover { background: #4a5568; }
        .btn-tv-power {
            width: 30px; height: 30px; border-radius: 50%;
            background: rgba(255, 255, 255, 0.15); border: 1px solid #cbd5e1;
            color: #fff; display: flex; align-items: center; justify-content: center;
            cursor: pointer; font-size: 0.75rem;
        }
        
        .color-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
        .btn-color { border: none; border-radius: 8px; padding: 6px 0; font-size: 0.7rem; font-weight: 700; text-align: center; cursor: pointer; color: #111; transition: 0.15s; }
        .btn-color.setup { background: #fb923c; }
        .btn-color.app { background: #4ade80; }
        .btn-color.vol-minus { background: #facc15; }
        .btn-color.vol-plus { background: #38bdf8; }
        .btn-color:hover { filter: brightness(1.15); transform: translateY(-1px); }
        
        .nav-twin-row { display: flex; justify-content: space-between; padding: 0 8px; }
        .btn-circle-small {
            width: 36px; height: 36px; border-radius: 50%;
            background: #1f2937; border: 1px solid #374151; color: #9ca3af;
            display: flex; align-items: center; justify-content: center;
            cursor: pointer; transition: 0.15s; font-size: 0.85rem;
        }
        .btn-circle-small:hover { background: #374151; color: #fff; }
        
        .dpad-container { display: flex; justify-content: center; margin: 3px 0; }
        .dpad-ring {
            width: 136px; height: 136px; border-radius: 50%;
            background: #1e2533; border: 2px solid #374151;
            position: relative; box-shadow: inset 0 2px 6px rgba(0,0,0,0.6);
        }
        .dpad-arrow {
            position: absolute; border: none; background: none;
            color: #cbd5e1; font-size: 0.85rem; cursor: pointer;
            display: flex; align-items: center; justify-content: center;
            width: 36px; height: 36px; transition: 0.15s;
        }
        .dpad-arrow:hover { color: var(--primary); }
        .dpad-up { top: 4px; left: 50px; }
        .dpad-down { bottom: 4px; left: 50px; }
        .dpad-left { top: 50px; left: 4px; }
        .dpad-right { top: 50px; right: 4px; }
        .dpad-center-ok {
            position: absolute; top: 40px; left: 40px;
            width: 56px; height: 56px; border-radius: 50%;
            background: #111827; border: 2px solid #4b5563;
            color: #fff; font-weight: 700; font-size: 0.95rem;
            display: flex; align-items: center; justify-content: center;
            cursor: pointer; transition: 0.15s;
        }
        .dpad-center-ok:hover { background: #1f2937; border-color: var(--primary); }
        
        .numpad-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; padding: 0 4px; }
        .btn-num {
            background: #1a2232; border: 1px solid #2d3748;
            border-radius: 8px; color: #f1f5f9; font-weight: 600;
            font-size: 0.95rem; padding: 7px 0; text-align: center;
            cursor: pointer; transition: 0.15s;
        }
        .btn-num:hover { background: #2d3748; color: var(--primary); }
        
        .remote-btn-active {
            outline: 2px solid #34d399 !important;
            box-shadow: 0 0 16px rgba(52, 211, 153, 0.9) !important;
            transform: scale(1.08) !important;
        }

        .right-panel { display: flex; flex-direction: column; gap: 16px; }
        .card { background: var(--panel-bg); border-radius: 14px; border: 1px solid var(--border); padding: 18px; backdrop-filter: blur(10px); }
        
        .tabs { display: flex; gap: 6px; border-bottom: 1px solid var(--border); padding-bottom: 8px; flex-wrap: wrap; }
        .tab-btn { background: none; border: none; color: var(--text-muted); font-size: 0.9rem; font-weight: 600; padding: 7px 14px; cursor: pointer; border-radius: 8px; transition: 0.15s; }
        .tab-btn:hover { color: #fff; background: rgba(255,255,255,0.05); }
        .tab-btn.active { color: #fff; background: rgba(59, 130, 246, 0.15); border: 1px solid rgba(59, 130, 246, 0.3); }
        
        .actions-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; margin-top: 12px; }
        .action-card { background: rgba(0, 0, 0, 0.3); border: 1px solid var(--border); border-radius: 10px; padding: 14px; display: flex; flex-direction: column; justify-content: space-between; gap: 10px; transition: 0.2s; }
        .action-card:hover { border-color: rgba(59, 130, 246, 0.4); background: rgba(15, 23, 42, 0.5); }
        .action-header { display: flex; justify-content: space-between; align-items: center; }
        .action-title { font-size: 0.95rem; font-weight: 700; color: #fff; }
        .action-cat { font-size: 0.75rem; font-weight: 600; padding: 2px 8px; border-radius: 4px; background: rgba(255,255,255,0.1); color: #cbd5e1; }
        .action-desc { font-size: 0.8rem; color: var(--text-muted); }
        .action-footer { display: flex; justify-content: space-between; align-items: center; }
        
        .form-row { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
        .form-group { flex: 1; min-width: 150px; display: flex; flex-direction: column; gap: 5px; }
        .form-group label { font-size: 0.75rem; color: var(--text-muted); font-weight: 600; text-transform: uppercase; }
        input, select { background: rgba(15, 23, 42, 0.8); border: 1px solid var(--border); color: #fff; padding: 8px 10px; border-radius: 8px; font-size: 0.9rem; outline: none; }
        input:focus, select:focus { border-color: var(--primary); }
        
        .btn { padding: 7px 14px; border-radius: 8px; font-weight: 600; font-size: 0.85rem; border: none; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px; transition: 0.15s; }
        .btn-primary { background: var(--primary); color: #fff; }
        .btn-primary:hover { background: var(--primary-hover); }
        .btn-success { background: var(--success); color: #fff; }
        .btn-cyan { background: #0891b2; color: #fff; }
        .btn-cyan:hover { background: #06b6d4; }
        .btn-danger { background: rgba(239, 68, 68, 0.2); color: var(--danger); border: 1px solid rgba(239, 68, 68, 0.4); }
        .btn-danger:hover { background: rgba(239, 68, 68, 0.35); }
        .btn-secondary { background: rgba(255, 255, 255, 0.1); color: #fff; }
        .btn-secondary:hover { background: rgba(255, 255, 255, 0.18); }
        
        table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 0.85rem; }
        th { text-align: left; padding: 10px; border-bottom: 2px solid var(--border); color: var(--text-muted); font-weight: 600; font-size: 0.75rem; text-transform: uppercase; }
        td { padding: 10px; border-bottom: 1px solid rgba(255, 255, 255, 0.05); }
        tr:hover td { background: rgba(255, 255, 255, 0.02); }
        
        .badge-code { font-family: monospace; padding: 2px 6px; border-radius: 4px; background: rgba(0, 0, 0, 0.4); border: 1px solid var(--border); font-size: 0.8rem; color: #38bdf8; }
        .key-badge { display: inline-flex; align-items: center; padding: 4px 10px; border-radius: 8px; background: rgba(59, 130, 246, 0.2); border: 1px solid rgba(59, 130, 246, 0.4); font-size: 0.85rem; font-weight: 700; color: #93c5fd; }
        
        .log-list { display: flex; flex-direction: column; gap: 6px; max-height: 280px; overflow-y: auto; }
        .log-item { display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; background: rgba(0, 0, 0, 0.25); border-radius: 6px; font-size: 0.8rem; border-left: 3px solid var(--primary); }
        .log-item.warning { border-left-color: var(--warning); }
        .log-item.error { border-left-color: var(--danger); }
        .log-item.success { border-left-color: var(--success); }
        
        .rec-box { background: rgba(6, 182, 212, 0.1); border: 1px dashed #06b6d4; border-radius: 12px; padding: 14px; margin-bottom: 16px; display: flex; flex-direction: column; gap: 10px; }
        .rec-box.active { animation: borderPulse 1.5s infinite; }
        @keyframes borderPulse { 0% { border-color: #06b6d4; } 50% { border-color: #ef4444; } 100% { border-color: #06b6d4; } }
    </style>
</head>
<body>
    <div class="container">
        <!-- CABEÇALHO -->
        <header>
            <div class="logo">
                <svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zM8 15h8v2H8zm0-4h8v2H8zm0-4h8v2H8z"/></svg>
                <span>Controle Remoto TV Box</span>
            </div>
            <div class="header-badges">
                <div id="sensorStatus" class="status-pill">
                    <span style="width: 8px; height: 8px; border-radius: 50%; background: currentColor;"></span>
                    <span id="sensorText">Sensor IR Ativo (NEC)</span>
                </div>
                <div id="lockBadge" class="status-pill locked">
                    <span>🔒 Bloqueado</span>
                </div>
            </div>
        </header>

        <!-- BANNER DE STATUS DA TRAVA DE SEGURANÇA -->
        <div id="lockBanner" class="lock-banner">
            <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                <span id="lockTitle" style="font-weight: 700; color: #fff;">🛡️ Trava de Segurança Ativa</span>
                <span style="color: var(--text-muted); font-size: 0.85rem;">Sequência de autorização:</span>
                <span id="targetSeqDisplay" class="seq-tag">1 ➔ 2 ➔ 3</span>
                <span id="liveBufferTag" class="live-buffer">Aguardando teclas...</span>
            </div>
            <button id="lockActionBtn" class="btn-unlock" onclick="toggleWebUnlock()">🔓 Desbloquear via Web</button>
        </div>

        <!-- LAYOUT PRINCIPAL -->
        <div class="main-layout">
            <!-- COLUNA ESQUERDA: CONTROLE REMOTO VIRTUAL -->
            <div id="virtualRemoteCase" class="remote-case">
                <div class="remote-header-led">
                    <span style="font-size:0.65rem; color:#64748b; font-weight:700;">LED TV BOX</span>
                    <div id="remoteLed" class="physical-led-indicator"></div>
                </div>

                <div class="top-power-row">
                    <button id="btn-power" class="btn-power-main" onclick="onRemoteClick('btn-power', 'Power', '0x140')">⏻</button>
                    
                    <div class="tv-control-box">
                        <span class="tv-control-title">TV CONTROL</span>
                        <div class="tv-control-grid">
                            <button id="btn-set" class="btn-tv-mini" onclick="onRemoteClick('btn-set', 'SET')">SET</button>
                            <button id="btn-tvin" class="btn-tv-mini" onclick="onRemoteClick('btn-tvin', 'TV IN', '0x158')">IN</button>
                            <button id="btn-tv-volminus" class="btn-tv-mini" onclick="onRemoteClick('btn-tv-volminus', 'TV VOL-', '0x157')">-</button>
                            <button id="btn-tv-volplus" class="btn-tv-mini" onclick="onRemoteClick('btn-tv-volplus', 'TV VOL+', '0x156')">+</button>
                            <button id="btn-tv-power" class="btn-tv-power" onclick="onRemoteClick('btn-tv-power', 'TV Power', '0x159')">⏻</button>
                        </div>
                    </div>
                </div>

                <div class="color-row">
                    <button id="btn-setup" class="btn-color setup" onclick="onRemoteClick('btn-setup', 'SETUP', '0x143')">SETUP</button>
                    <button id="btn-app" class="btn-color app" onclick="onRemoteClick('btn-app', 'APP', '0x10f')">APP</button>
                    <button id="btn-volminus" class="btn-color vol-minus" onclick="onRemoteClick('btn-volminus', 'VOL-', '0x110')">VOL-</button>
                    <button id="btn-volplus" class="btn-color vol-plus" onclick="onRemoteClick('btn-volplus', 'VOL+', '0x118')">VOL+</button>
                </div>

                <div class="nav-twin-row">
                    <button id="btn-home" class="btn-circle-small" onclick="onRemoteClick('btn-home', 'Home', '0x111')">🏠</button>
                    <button id="btn-back" class="btn-circle-small" onclick="onRemoteClick('btn-back', 'Back', '0x119')">↩️</button>
                </div>

                <div class="dpad-container">
                    <div class="dpad-ring">
                        <button id="btn-up" class="dpad-arrow dpad-up" onclick="onRemoteClick('btn-up', 'Cima', '0x116')">▲</button>
                        <button id="btn-left" class="dpad-arrow dpad-left" onclick="onRemoteClick('btn-left', 'Esquerda', '0x151')">◀</button>
                        <button id="btn-ok" class="dpad-center-ok" onclick="onRemoteClick('btn-ok', 'OK', '0x113')">OK</button>
                        <button id="btn-right" class="dpad-arrow dpad-right" onclick="onRemoteClick('btn-right', 'Direita', '0x150')">▶</button>
                        <button id="btn-down" class="dpad-arrow dpad-down" onclick="onRemoteClick('btn-down', 'Baixo', '0x11a')">▼</button>
                    </div>
                </div>

                <div class="nav-twin-row">
                    <button id="btn-menu" class="btn-circle-small" onclick="onRemoteClick('btn-menu', 'Menu', '0x14c')">☰</button>
                    <button id="btn-mouse" class="btn-circle-small" onclick="onRemoteClick('btn-mouse', 'Mouse', '0x100')">🖱️</button>
                </div>

                <div class="numpad-grid">
                    <button id="btn-1" class="btn-num" onclick="onRemoteClick('btn-1', '1', '0x14e')">1</button>
                    <button id="btn-2" class="btn-num" onclick="onRemoteClick('btn-2', '2', '0x10d')">2</button>
                    <button id="btn-3" class="btn-num" onclick="onRemoteClick('btn-3', '3', '0x10c')">3</button>
                    
                    <button id="btn-4" class="btn-num" onclick="onRemoteClick('btn-4', '4', '0x14a')">4</button>
                    <button id="btn-5" class="btn-num" onclick="onRemoteClick('btn-5', '5', '0x109')">5</button>
                    <button id="btn-6" class="btn-num" onclick="onRemoteClick('btn-6', '6', '0x108')">6</button>
                    
                    <button id="btn-7" class="btn-num" onclick="onRemoteClick('btn-7', '7', '0x146')">7</button>
                    <button id="btn-8" class="btn-num" onclick="onRemoteClick('btn-8', '8', '0x105')">8</button>
                    <button id="btn-9" class="btn-num" onclick="onRemoteClick('btn-9', '9', '0x104')">9</button>
                    
                    <button id="btn-mute" class="btn-num" onclick="onRemoteClick('btn-mute', 'Mute', '0x141')">🔇</button>
                    <button id="btn-0" class="btn-num" onclick="onRemoteClick('btn-0', '0', '0x101')">0</button>
                    <button id="btn-delete" class="btn-num" onclick="onRemoteClick('btn-delete', 'Delete', '0x142')">⌫</button>
                </div>
            </div>

            <!-- COLUNA DIREITA: ABAS E PAINÉIS -->
            <div class="right-panel">
                <div class="tabs">
                    <button class="tab-btn active" onclick="switchTab('tab-functions', this)">🎮 Teclas & Funções</button>
                    <button class="tab-btn" onclick="switchTab('tab-combos', this)">⚡ Sequências & Combos</button>
                    <button class="tab-btn" onclick="switchTab('tab-calibrate', this)">📡 Parear Controle (IR)</button>
                    <button class="tab-btn" onclick="switchTab('tab-sequence', this)">🔐 Trava Geral</button>
                    <button class="tab-btn" onclick="switchTab('tab-leds', this)">💡 Luzes Bicolor</button>
                    <button class="tab-btn" onclick="switchTab('tab-actions', this)">⚙️ Catálogo de Ações</button>
                    <button class="tab-btn" onclick="switchTab('tab-logs', this)">📜 Logs</button>
                </div>

                <!-- ABA 1: TECLAS & FUNÇÕES (SOFTWARE - SEM RISCO DE SOBRESCREVER HARDWARE) -->
                <div id="tab-functions" class="card">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; flex-wrap:wrap; gap:10px;">
                        <div>
                            <h3>🎮 Teclas & Funções do Servidor</h3>
                            <p style="color: var(--text-muted); font-size: 0.85rem;">
                                Defina o que cada botão do controle faz. O código físico do controle é preservado com segurança total.
                            </p>
                        </div>
                    </div>

                    <!-- CARD DE ATRIBUIÇÃO RÁPIDA -->
                    <div id="quickAssignCard" style="background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(59, 130, 246, 0.3); border-radius: 12px; padding: 14px; margin-bottom: 16px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
                            <div style="display:flex; align-items:center; gap:8px;">
                                <span style="font-size:0.75rem; color:var(--text-muted); font-weight:700; text-transform:uppercase;">Botão Selecionado:</span>
                                <span id="fnSelectedBadge" class="key-badge" style="background:#1e293b; color:#94a3b8; border-color:#475569;">Nenhum botão clicado</span>
                            </div>
                            <span id="fnScancodeInfo" style="font-size:0.75rem; color:#38bdf8; font-family:monospace;"></span>
                        </div>

                        <div id="fnFormRow" style="margin-top:12px; display:none;">
                            <div class="form-row">
                                <div class="form-group" style="flex:2;">
                                    <label>Ação / API a Executar</label>
                                    <select id="fnActionSelect">
                                        <option value="none">-- Nenhuma Ação (Apenas Detectar) --</option>
                                    </select>
                                </div>
                                <div class="form-group" style="flex:1; justify-content:center;">
                                    <label style="display:flex; align-items:center; gap:8px; cursor:pointer; margin-top:20px; font-size:0.85rem;">
                                        <input type="checkbox" id="fnRequireUnlock" checked>
                                        <span>Exigir Trava Geral</span>
                                    </label>
                                </div>
                            </div>
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:10px; flex-wrap:wrap; gap:8px;">
                                <span id="fnNotice" style="font-size:0.85rem; color:#34d399; font-weight:600;"></span>
                                <div style="display:flex; gap:8px;">
                                    <button class="btn btn-secondary" onclick="clearFnSelection()">Cancelar</button>
                                    <button class="btn btn-success" onclick="saveButtonAction()">💾 Salvar Função Desta Tecla</button>
                                </div>
                            </div>
                        </div>
                        <div id="fnSelectPrompt" style="margin-top:8px; font-size:0.82rem; color:var(--text-muted);">
                            💡 <em>Dica: Clique em qualquer botão no <strong>Controle Virtual à esquerda</strong> para escolher a função dele, ou selecione diretamente na tabela abaixo.</em>
                        </div>
                    </div>

                    <!-- TABELA COM SELECT INLINE -->
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                        <h4 style="font-size:0.9rem; color:#fff;">Tabela Geral de Teclas Cadastradas</h4>
                        <span style="font-size:0.75rem; color:var(--text-muted);">Altere a ação de qualquer tecla diretamente pelo menu</span>
                    </div>
                    <div style="overflow-x:auto;">
                        <table>
                            <thead>
                                <tr>
                                    <th>Código</th>
                                    <th>Botão</th>
                                    <th>Ação Associada</th>
                                    <th>Trava</th>
                                    <th style="text-align: right;">Opções</th>
                                </tr>
                            </thead>
                            <tbody id="buttonsTableBody">
                                <tr><td colspan="5" style="text-align:center; color: var(--text-muted);">Carregando teclas...</td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                <!-- ABA 2: SEQUÊNCIAS & COMBOS (MACROS) -->
                <div id="tab-combos" class="card" style="display:none;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; flex-wrap:wrap; gap:10px;">
                        <div>
                            <h3>⚡ Sequências & Combos de Teclas</h3>
                            <p style="color: var(--text-muted); font-size: 0.85rem;">
                                Crie atalhos compostos: digite uma sequência de botões para disparar qualquer ação ou script no servidor (ex: <code>SETUP ➔ 1</code> reinicia o servidor).
                            </p>
                        </div>
                        <button id="btnToggleComboForm" class="btn btn-primary" onclick="toggleNewComboForm()">➕ Nova Sequência / Combo</button>
                    </div>

                    <!-- CRIADOR DE SEQUÊNCIA / COMBO -->
                    <div id="newComboForm" style="display:none; background: rgba(0,0,0,0.35); padding: 16px; border-radius: 12px; border: 1px solid rgba(6, 182, 212, 0.4); margin-bottom: 16px;">
                        <h4 id="comboFormTitle" style="color:#38bdf8; margin-bottom:10px;">Gravar Nova Sequência de Disparo</h4>
                        
                        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-bottom:12px;">
                            <button id="btnComboRecVirtual" class="btn btn-cyan" onclick="startComboRecording('virtual')">
                                🖱️ Gravar Clicando no Controle Virtual
                            </button>
                            <button id="btnComboRecPhysical" class="btn btn-danger" onclick="startComboRecording('physical')">
                                🔴 Gravar com Controle Remoto Real
                            </button>
                        </div>

                        <div id="comboRecStatusBox" style="background:rgba(0,0,0,0.3); border-radius:8px; padding:10px; margin-bottom:12px; border:1px solid var(--border);">
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                                <span style="font-size:0.75rem; color:var(--text-muted); font-weight:700; text-transform:uppercase;">Sequência Sendo Gravada:</span>
                                <span id="comboRecCount" style="font-size:0.85rem; font-weight:700; color:#38bdf8;">0 teclas</span>
                            </div>
                            <div id="comboRecBadges" style="display:flex; gap:8px; flex-wrap:wrap; min-height:36px; align-items:center;">
                                <span style="color:var(--text-muted); font-size:0.85rem;">Escolha um modo acima e pressione as teclas...</span>
                            </div>
                            <div style="display:flex; gap:8px; margin-top:8px;">
                                <button class="btn btn-secondary" style="font-size:0.75rem; padding:3px 8px;" onclick="popComboKey()">⌫ Apagar Último</button>
                                <button class="btn btn-secondary" style="font-size:0.75rem; padding:3px 8px;" onclick="clearComboKeys()">🗑️ Limpar Tudo</button>
                            </div>
                        </div>

                        <div class="form-row">
                            <div class="form-group" style="flex:1;">
                                <label>Nome do Combo / Atalho</label>
                                <input type="text" id="newComboName" placeholder="Ex: Reiniciar Servidor (SETUP ➔ 1)">
                            </div>
                            <div class="form-group" style="flex:1;">
                                <label>Ação / API a Disparar</label>
                                <select id="newComboAction">
                                    <!-- Carregado via JS -->
                                </select>
                            </div>
                        </div>

                        <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:10px;">
                            <button class="btn btn-secondary" onclick="cancelComboRecording()">Cancelar</button>
                            <button id="btnSaveCombo" class="btn btn-success" onclick="saveNewCombo()">💾 Salvar Esta Sequência</button>
                        </div>
                    </div>

                    <!-- LISTA DE COMBOS CADASTRADOS -->
                    <div id="combosListContainer" style="display:flex; flex-direction:column; gap:10px;">
                        <!-- Renderizado via JS -->
                    </div>
                </div>

                <!-- ABA 3: PAREAR CONTROLE (HARDWARE IR) -->
                <div id="tab-calibrate" class="card" style="display:none;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                        <div>
                            <h3>📡 Pareamento de Hardware (Sensor IR)</h3>
                            <p style="color: var(--text-muted); font-size: 0.85rem;">
                                Calibre o código infravermelho de cada tecla do seu controle físico. Aqui as ações do servidor NÃO são modificadas.
                            </p>
                        </div>
                    </div>

                    <div style="background: rgba(0,0,0,0.3); padding: 16px; border-radius: 12px; border: 1px solid var(--border);">
                        <div id="hardwarePairStatusNotice" style="margin-bottom: 12px; font-size: 0.85rem; padding: 10px 14px; border-radius: 8px; background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.06); min-height: 24px;">
                            <span style="color: var(--text-muted);">Clique em um botão no controle virtual à esquerda OU aponte o controle real e aperte a tecla desejada...</span>
                        </div>

                        <div class="form-row">
                            <div class="form-group">
                                <label>Nome do Botão / Tecla</label>
                                <input type="text" id="pairBtnName" placeholder="Ex: Power, 1, OK, SETUP...">
                            </div>
                            <div class="form-group">
                                <label>Código Físico Hex (Scancode)</label>
                                <input type="text" id="pairScancode" placeholder="Sinal capturado pelo sensor (ex: 0x140)...">
                            </div>
                        </div>

                        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 12px; flex-wrap: wrap; gap: 10px;">
                            <span style="font-size:0.8rem; color:var(--text-muted);">
                                🟢 As teclas com ponto verde no controle virtual já possuem código físico gravado.
                            </span>
                            <div style="display:flex; gap:8px;">
                                <button class="btn btn-secondary" onclick="clearPairingForm()">Limpar</button>
                                <button class="btn btn-success" onclick="saveHardwarePairing()">💾 Salvar Pareamento</button>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- ABA 4: GERENCIAMENTO DA TRAVA GERAL -->
                <div id="tab-sequence" class="card" style="display:none;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                        <div>
                            <h3>🔐 Trava de Segurança por Sequência</h3>
                            <p style="color: var(--text-muted); font-size: 0.85rem;">
                                Evite que crianças, visitas ou controles da sua TV Samsung/LG desliguem a TV Box sem querer.
                            </p>
                        </div>
                    </div>

                    <div style="background: rgba(0,0,0,0.3); padding: 14px; border-radius: 12px; border: 1px solid var(--border); margin-bottom: 16px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
                            <div>
                                <span style="font-size:0.8rem; color:var(--text-muted); text-transform:uppercase; font-weight:700;">Sequência Configurada Atualmente:</span>
                                <div id="activeSeqDisplayBox" style="display:flex; align-items:center; gap:8px; margin-top:6px; flex-wrap:wrap;">
                                    <span class="key-badge">Carregando...</span>
                                </div>
                            </div>
                            <div style="display:flex; gap:8px;">
                                <button class="btn btn-primary" onclick="toggleWebUnlock()">🔓 Testar Desbloqueio</button>
                            </div>
                        </div>
                    </div>

                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; margin-bottom:14px;">
                        <div style="background:rgba(6, 182, 212, 0.08); border:1px solid rgba(6, 182, 212, 0.3); border-radius:10px; padding:14px; display:flex; flex-direction:column; justify-content:space-between; gap:10px;">
                            <div>
                                <h4 style="color:#38bdf8; display:flex; align-items:center; gap:6px;">
                                    <span>🖱️ Modo 1: Clicar no Controle Virtual</span>
                                </h4>
                                <p style="font-size:0.8rem; color:var(--text-muted); margin-top:4px;">
                                    Clique nos botões do controle simulado à esquerda para montar sua sequência visualmente.
                                </p>
                            </div>
                            <button id="btnStartVirtualRec" class="btn btn-cyan" onclick="startLockRecording('virtual')">
                                ▶️ Gravar Clicando no Controle
                            </button>
                        </div>

                        <div style="background:rgba(239, 68, 68, 0.08); border:1px solid rgba(239, 68, 68, 0.3); border-radius:10px; padding:14px; display:flex; flex-direction:column; justify-content:space-between; gap:10px;">
                            <div>
                                <h4 style="color:#f87171; display:flex; align-items:center; gap:6px;">
                                    <span>🔴 Modo 2: Gravar com Controle Real</span>
                                </h4>
                                <p style="font-size:0.8rem; color:var(--text-muted); margin-top:4px;">
                                    Aponte seu controle físico para a TV Box e aperte a sequência desejada. O sensor captura os sinais na hora!
                                </p>
                            </div>
                            <button id="btnStartPhysicalRec" class="btn btn-danger" onclick="startLockRecording('physical')">
                                🔴 Gravar com Controle Real
                            </button>
                        </div>
                    </div>

                    <div id="recordingBox" class="rec-box" style="display:none;">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <div>
                                <h4 id="recTitle" style="color:#fff;">Gravando Nova Sequência...</h4>
                                <p id="recInstructions" style="color:var(--text-muted); font-size:0.85rem;">Pressione as teclas no controle na ordem desejada.</p>
                            </div>
                            <span id="recCounter" style="font-size:1.1rem; font-weight:800; color:#38bdf8;">0 teclas</span>
                        </div>

                        <div id="recBadgesContainer" style="display:flex; gap:8px; flex-wrap:wrap; min-height:42px; padding:8px; background:rgba(0,0,0,0.3); border-radius:8px; align-items:center;">
                            <span style="color:var(--text-muted); font-size:0.85rem;">Nenhuma tecla pressionada ainda...</span>
                        </div>

                        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
                            <div style="display:flex; gap:8px;">
                                <button class="btn btn-secondary" onclick="popRecordingKey()">⌫ Apagar Último</button>
                                <button class="btn btn-secondary" onclick="clearRecording()">🗑️ Limpar</button>
                            </div>
                            <div style="display:flex; gap:8px;">
                                <button class="btn btn-secondary" onclick="cancelRecording()">❌ Cancelar</button>
                                <button class="btn btn-success" onclick="saveRecordedSequence()">💾 Salvar Esta Sequência</button>
                            </div>
                        </div>
                    </div>

                    <div style="background: rgba(0,0,0,0.2); padding: 14px; border-radius: 10px; border: 1px solid var(--border); margin-top: 14px;">
                        <h4 style="margin-bottom:8px; font-size:0.9rem;">Configurações Adicionais</h4>
                        <div class="form-row">
                            <div class="form-group">
                                <label>Proteção por Senha / Sequência</label>
                                <select id="seqEnabled" onchange="updateSeqSettings()">
                                    <option value="true">✅ Ativada (Ações críticas exigem a sequência)</option>
                                    <option value="false">❌ Desativada (Qualquer botão dispara livremente)</option>
                                </select>
                            </div>
                            <div class="form-group">
                                <label>Tempo Desbloqueado (segundos)</label>
                                <input type="number" id="seqDuration" value="15" min="5" max="60" onchange="updateSeqSettings()">
                            </div>
                        </div>
                    </div>
                </div>

                <!-- ABA 5: LUZES BICOLOR (PH5 / 229) -->
                <div id="tab-leds" class="card" style="display:none;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                        <div>
                            <h3>💡 Controle do LED Bicolor da TV Box (Pino PH5 / 229)</h3>
                            <p style="color: var(--text-muted); font-size: 0.85rem;">
                                Seu hardware possui duas luzes físicas no mesmo circuito: <strong>Azul</strong> (Ligado) e <strong>Vermelha</strong> (Standby).
                            </p>
                        </div>
                    </div>

                    <div style="background: rgba(0,0,0,0.3); padding: 16px; border-radius: 12px; border: 1px solid var(--border); margin-bottom: 14px;">
                        <span style="font-size:0.75rem; color:var(--text-muted); text-transform:uppercase; font-weight:700;">Controles Manuais Imediatos:</span>
                        
                        <div style="display:flex; gap:10px; margin-top:10px; flex-wrap:wrap;">
                            <button class="btn btn-primary" onclick="setLedColorWeb('blue')">🔵 Deixar Azul (Modo Ligado / Normal)</button>
                            <button class="btn btn-danger" onclick="setLedColorWeb('red')">🔴 Deixar Vermelho (Modo Standby)</button>
                            <button class="btn btn-cyan" onclick="testPulseIR()">✨ Simular Piscar IR (Azul ➔ Vermelho)</button>
                            <button class="btn btn-secondary" onclick="testAlternate()">🚨 Alternar Cores 4x</button>
                        </div>
                        <div id="ledResultNotice" style="margin-top:10px; font-size:0.85rem; color:#34d399; font-weight:600;"></div>
                    </div>

                    <div style="padding: 14px; background: rgba(59, 130, 246, 0.08); border-left: 4px solid var(--primary); border-radius: 8px; font-size: 0.85rem; color: #cbd5e1; line-height: 1.6;">
                        <strong>✨ Como o seu LED Bicolor opera agora automaticamente:</strong><br>
                        • <strong>Quando o Linux está ligado:</strong> O pino 229 é colocado em <code>1</code>, mantendo a luz <strong>AZUL</strong> acesa.<br>
                        • <strong>Quando você aperta qualquer tecla no controle remoto:</strong> A luz pisca em <strong>VERMELHO</strong> por 120ms e volta para o Azul imediatamente (feedback do Android original).<br>
                        • <strong>Quando você desliga o servidor (botão Power):</strong> O pino 229 é colocado em <code>0</code>, travando a luz em <strong>VERMELHO</strong> fixo para indicar que a TV Box está em Standby!
                    </div>
                </div>

                <!-- ABA 6: CATÁLOGO DE AÇÕES & APIS LOCAIS -->
                <div id="tab-actions" class="card" style="display:none;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                        <div>
                            <h3>⚡ Catálogo de Funções & APIs Locais</h3>
                            <p style="color: var(--text-muted); font-size: 0.85rem;">
                                Ações padrão do servidor e APIs locais que você pode disparar pelo controle remoto ou por combos.
                            </p>
                        </div>
                        <button class="btn btn-primary" onclick="toggleNewActionForm()">➕ Nova API / Ação</button>
                    </div>

                    <div id="newActionForm" style="display:none; background: rgba(0,0,0,0.4); padding: 14px; border-radius: 10px; border: 1px solid var(--border); margin-bottom: 14px;">
                        <h4 style="margin-bottom: 10px; color: #60a5fa;">Cadastrar Nova Ação ou API</h4>
                        <div class="form-row">
                            <div class="form-group">
                                <label>Nome da Ação</label>
                                <input type="text" id="newActName" placeholder="Ex: Acender Luz, Backup PocketBase">
                            </div>
                            <div class="form-group">
                                <label>Tipo de Ação</label>
                                <select id="newActType" onchange="toggleNewActionFields()">
                                    <option value="webhook">🌐 Requisição HTTP / Webhook API (GET)</option>
                                    <option value="docker_toggle">🐳 Container Docker (Start / Stop Toggle)</option>
                                    <option value="shell">💻 Comando Shell / Script Bash</option>
                                </select>
                            </div>
                        </div>
                        <div class="form-row">
                            <div class="form-group">
                                <label id="newActTargetLabel">URL do Webhook</label>
                                <input type="text" id="newActTarget" placeholder="http://127.0.0.1:1880/api/endpoint">
                            </div>
                            <div class="form-group">
                                <label>Descrição (Opcional)</label>
                                <input type="text" id="newActDesc" placeholder="Breve explicação da ação">
                            </div>
                        </div>
                        <div style="display: flex; justify-content: flex-end; gap: 8px;">
                            <button class="btn btn-secondary" onclick="toggleNewActionForm()">Cancelar</button>
                            <button class="btn btn-success" onclick="saveNewAction()">Salvar no Catálogo</button>
                        </div>
                    </div>

                    <div id="actionsGrid" class="actions-grid"></div>
                </div>

                <!-- ABA 7: LOGS -->
                <div id="tab-logs" class="card" style="display:none;">
                    <h3 style="margin-bottom: 12px;">📜 Histórico de Sinais e Eventos</h3>
                    <div id="logsContainer" class="log-list">
                        <div style="text-align:center; color: var(--text-muted); padding: 15px;">Nenhum evento registrado ainda.</div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script>
        let currentConfig = { debounce_ms: 300, security_sequence: {}, actions: [], buttons: [], custom_sequences: [] };
        let activeTab = 'tab-functions';
        let fnSelectedButton = null;
        let pairSelectedId = null;
        
        let recordingState = { active: false, mode: 'virtual', buffer: [] };
        let comboRecording = { active: false, mode: 'virtual', buffer: [] };
        let recordingContext = 'lock'; // 'lock' ou 'combo'
        let editingComboIndex = null;

        // --- CLIQUE EM TECLA DO CONTROLE REMOTO VIRTUAL ---
        function onRemoteClick(btnId, defaultName, defaultScancode) {
            flashVirtualKey(btnId);

            // 1. Se estiver gravando sequência da TRAVA GERAL via virtual
            if (activeTab === 'tab-sequence' && recordingState.active && recordingState.mode === 'virtual') {
                const existing = currentConfig.buttons.find(b => b.id === btnId);
                const scancode = existing ? existing.scancode : (defaultScancode || '');
                const name = existing ? existing.name : defaultName;
                recordingState.buffer.push({ id: btnId, name: name, scancode: scancode });
                renderRecordingBadges();
                return;
            }

            // 2. Se estiver gravando um COMBO / SEQUÊNCIA CUSTOMIZADA via virtual
            if (activeTab === 'tab-combos' && comboRecording.active && comboRecording.mode === 'virtual') {
                const existing = currentConfig.buttons.find(b => b.id === btnId);
                const scancode = existing ? existing.scancode : (defaultScancode || '');
                const name = existing ? existing.name : defaultName;
                comboRecording.buffer.push({ id: btnId, name: name, scancode: scancode });
                renderComboRecBadges();
                return;
            }

            // 3. Se estiver na aba de PAREAMENTO DE HARDWARE (IR)
            if (activeTab === 'tab-calibrate') {
                selectButtonForHardwarePairing(btnId, defaultName, defaultScancode);
                return;
            }

            // 4. Modo padrão: Atribuir função ao botão (Aba Teclas & Funções)
            selectButtonForFunctionAssign(btnId, defaultName, defaultScancode);
        }

        function flashVirtualKey(btnId) {
            const el = document.getElementById(btnId);
            if (el) {
                el.classList.add('remote-btn-active');
                setTimeout(() => el.classList.remove('remote-btn-active'), 350);
            }
            const led = document.getElementById('remoteLed');
            if (led && !led.classList.contains('unlocked-pulse')) {
                led.classList.add('red');
                setTimeout(() => led.classList.remove('red'), 130);
            }
        }

        function switchTab(tabId, btn) {
            activeTab = tabId;
            document.querySelectorAll('.tabs .tab-btn').forEach(b => b.classList.remove('active'));
            if (btn) btn.classList.add('active');
            
            ['tab-functions', 'tab-combos', 'tab-calibrate', 'tab-sequence', 'tab-leds', 'tab-actions', 'tab-logs'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.style.display = (id === tabId) ? 'block' : 'none';
            });
        }

        // ==========================================
        // ABA 1: GERENCIAMENTO DE FUNÇÕES DAS TECLAS
        // ==========================================
        function selectButtonForFunctionAssign(btnId, defaultName, defaultScancode) {
            document.querySelectorAll('.remote-case button').forEach(b => b.classList.remove('selected-mapping'));
            const el = document.getElementById(btnId);
            if (el) el.classList.add('selected-mapping');

            const existing = currentConfig.buttons.find(b => b.id === btnId || (b.name && b.name.toLowerCase() === defaultName.toLowerCase()));
            fnSelectedButton = existing || {
                id: btnId,
                name: defaultName,
                scancode: defaultScancode || '',
                action_id: 'none',
                require_unlock: true
            };

            document.getElementById('fnSelectedBadge').innerText = fnSelectedButton.name;
            document.getElementById('fnSelectedBadge').style.background = 'rgba(59, 130, 246, 0.2)';
            document.getElementById('fnSelectedBadge').style.color = '#93c5fd';
            document.getElementById('fnSelectedBadge').style.borderColor = 'rgba(59, 130, 246, 0.4)';

            const scInfo = fnSelectedButton.scancode ? `(Código Hex: ${fnSelectedButton.scancode})` : '(Sem código físico)';
            document.getElementById('fnScancodeInfo').innerText = scInfo;

            document.getElementById('fnActionSelect').value = fnSelectedButton.action_id || 'none';
            document.getElementById('fnRequireUnlock').checked = (fnSelectedButton.require_unlock !== false);
            
            document.getElementById('fnFormRow').style.display = 'block';
            document.getElementById('fnSelectPrompt').style.display = 'none';
            document.getElementById('fnNotice').innerText = '';

            // Se o usuário clicou no controle estando em outra aba, muda suavemente para a aba de Funções
            if (activeTab !== 'tab-functions' && activeTab !== 'tab-combos' && activeTab !== 'tab-sequence') {
                const tabBtns = document.querySelectorAll('.tabs .tab-btn');
                if (tabBtns && tabBtns[0]) switchTab('tab-functions', tabBtns[0]);
            }
        }

        function clearFnSelection() {
            fnSelectedButton = null;
            document.querySelectorAll('.remote-case button').forEach(b => b.classList.remove('selected-mapping'));
            document.getElementById('fnSelectedBadge').innerText = 'Nenhum botão clicado';
            document.getElementById('fnSelectedBadge').style.background = '#1e293b';
            document.getElementById('fnSelectedBadge').style.color = '#94a3b8';
            document.getElementById('fnSelectedBadge').style.borderColor = '#475569';
            document.getElementById('fnScancodeInfo').innerText = '';
            document.getElementById('fnFormRow').style.display = 'none';
            document.getElementById('fnSelectPrompt').style.display = 'block';
            document.getElementById('fnNotice').innerText = '';
        }

        async function saveButtonAction() {
            if (!fnSelectedButton) return;
            const actionId = document.getElementById('fnActionSelect').value;
            const reqUnlock = document.getElementById('fnRequireUnlock').checked;

            const existing = currentConfig.buttons.find(b => b.id === fnSelectedButton.id);
            if (existing) {
                existing.action_id = actionId;
                existing.require_unlock = reqUnlock;
            } else {
                currentConfig.buttons.push({
                    id: fnSelectedButton.id,
                    scancode: fnSelectedButton.scancode || '',
                    name: fnSelectedButton.name,
                    action_id: actionId,
                    require_unlock: reqUnlock,
                    enabled: true
                });
            }

            await saveConfigToServer();
            document.getElementById('fnNotice').innerText = `✅ Função da tecla "${fnSelectedButton.name}" salva com sucesso!`;
            setTimeout(() => {
                if (document.getElementById('fnNotice')) document.getElementById('fnNotice').innerText = '';
            }, 3000);
        }

        async function updateButtonActionFromTable(idx, newActionId) {
            if (!currentConfig.buttons[idx]) return;
            currentConfig.buttons[idx].action_id = newActionId;
            await saveConfigToServer();
        }

        async function updateButtonUnlockFromTable(idx, isChecked) {
            if (!currentConfig.buttons[idx]) return;
            currentConfig.buttons[idx].require_unlock = isChecked;
            await saveConfigToServer();
        }

        // ==========================================
        // ABA 2: SEQUÊNCIAS & COMBOS (MACROS)
        // ==========================================
        function renderCombosList() {
            const container = document.getElementById('combosListContainer');
            const list = currentConfig.custom_sequences || [];

            if (list.length === 0) {
                container.innerHTML = `
                    <div style="background: rgba(0,0,0,0.25); border: 1px dashed var(--border); border-radius: 10px; padding: 20px; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
                        Nenhuma sequência combo configurada ainda.<br>
                        Clique em <strong>"➕ Nova Sequência / Combo"</strong> para criar atalhos como <code>SETUP ➔ 1</code> ou <code>1 ➔ 2 ➔ 3</code>!
                    </div>
                `;
                return;
            }

            container.innerHTML = list.map((combo, idx) => {
                const act = currentConfig.actions.find(a => a.id === combo.action_id);
                const actName = act ? act.name : combo.action_id;
                const tokens = combo.sequence || [];

                return `
                    <div style="background: rgba(0,0,0,0.3); border: 1px solid var(--border); border-radius: 10px; padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
                        <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
                            <div style="display: flex; align-items: center; gap: 6px;">
                                ${tokens.map(t => `<span class="key-badge" style="font-size: 0.8rem; padding: 2px 8px;">${t}</span>`).join('<span style="color:var(--text-muted); font-size:0.75rem;">➔</span>')}
                            </div>
                            <span style="font-weight: 700; color: #fff; font-size: 0.9rem;">${combo.name}</span>
                            <span style="background: rgba(59, 130, 246, 0.15); color: #93c5fd; border: 1px solid rgba(59, 130, 246, 0.3); border-radius: 6px; padding: 2px 8px; font-size: 0.8rem; font-weight: 600;">⚡ ${actName}</span>
                        </div>
                        <div style="display: flex; gap: 8px;">
                            <button class="btn btn-secondary" style="font-size: 0.75rem; padding: 4px 10px;" onclick="testActionById('${combo.action_id}', '${combo.name}')">⚡ Testar</button>
                            <button class="btn btn-secondary" style="font-size: 0.75rem; padding: 4px 10px; background: rgba(59, 130, 246, 0.2); border: 1px solid rgba(59, 130, 246, 0.4); color: #93c5fd;" onclick="editCombo(${idx})">✏️ Editar</button>
                            <button class="btn btn-danger" style="font-size: 0.75rem; padding: 4px 10px;" onclick="deleteCombo(${idx})">Remover</button>
                        </div>
                    </div>
                `;
            }).join('');
        }

        function toggleNewComboForm() {
            const f = document.getElementById('newComboForm');
            const isHidden = (f.style.display === 'none');
            if (isHidden) {
                editingComboIndex = null;
                document.getElementById('comboFormTitle').innerText = 'Gravar Nova Sequência de Disparo';
                document.getElementById('btnSaveCombo').innerText = '💾 Salvar Esta Sequência';
                document.getElementById('newComboName').value = '';
                comboRecording.buffer = [];
                f.style.display = 'block';
                renderComboRecBadges();
            } else {
                cancelComboRecording();
            }
        }

        function editCombo(idx) {
            const combo = currentConfig.custom_sequences[idx];
            if (!combo) return;

            editingComboIndex = idx;
            
            const f = document.getElementById('newComboForm');
            f.style.display = 'block';

            document.getElementById('comboFormTitle').innerText = `✏️ Editando Sequência: ${combo.name}`;
            document.getElementById('btnSaveCombo').innerText = '💾 Salvar Alterações';

            document.getElementById('newComboName').value = combo.name || '';
            document.getElementById('newComboAction').value = combo.action_id || 'none';

            comboRecording.buffer = (combo.sequence || []).map(token => {
                const btn = currentConfig.buttons.find(b => b.name.toLowerCase() === token.toLowerCase());
                return {
                    id: btn ? btn.id : '',
                    name: token,
                    scancode: btn ? btn.scancode : ''
                };
            });

            renderComboRecBadges();
            f.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }

        async function startComboRecording(mode) {
            recordingContext = 'combo';
            comboRecording.active = true;
            comboRecording.mode = mode;
            comboRecording.buffer = [];

            const rCase = document.getElementById('virtualRemoteCase');
            if (mode === 'virtual') {
                rCase.classList.add('recording-mode');
            } else {
                rCase.classList.remove('recording-mode');
                await fetch('/api/sequence/record', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'start_physical' })
                });
            }
            renderComboRecBadges();
        }

        function renderComboRecBadges() {
            const container = document.getElementById('comboRecBadges');
            const count = document.getElementById('comboRecCount');
            count.innerText = `${comboRecording.buffer.length} tecla(s)`;

            if (comboRecording.buffer.length === 0) {
                const hint = comboRecording.active ? 
                    (comboRecording.mode === 'virtual' ? 'Clique nos botões do controle à esquerda...' : 'Aponte o controle físico e aperte as teclas...') :
                    'Escolha um modo acima e pressione as teclas...';
                container.innerHTML = `<span style="color:var(--text-muted); font-size:0.85rem;">${hint}</span>`;
                return;
            }

            container.innerHTML = comboRecording.buffer.map((item, idx) => {
                return `<span class="key-badge">${idx + 1}. ${item.name}</span>`;
            }).join('<span style="color:var(--text-muted); font-weight:700;">➔</span>');
        }

        function popComboKey() {
            if (comboRecording.buffer.length > 0) {
                comboRecording.buffer.pop();
                renderComboRecBadges();
            }
        }

        function clearComboKeys() {
            comboRecording.buffer = [];
            renderComboRecBadges();
        }

        async function cancelComboRecording() {
            editingComboIndex = null;
            comboRecording.active = false;
            comboRecording.buffer = [];
            document.getElementById('newComboForm').style.display = 'none';
            document.getElementById('comboFormTitle').innerText = 'Gravar Nova Sequência de Disparo';
            document.getElementById('btnSaveCombo').innerText = '💾 Salvar Esta Sequência';
            document.getElementById('newComboName').value = '';
            document.getElementById('virtualRemoteCase').classList.remove('recording-mode');
            await fetch('/api/sequence/record', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'cancel' })
            });
        }

        async function saveNewCombo() {
            if (comboRecording.buffer.length === 0) {
                alert('Pressione ao menos 1 tecla para formar a sequência do combo!');
                return;
            }

            const name = document.getElementById('newComboName').value.trim() || `Combo ${comboRecording.buffer.map(b => b.name).join('+')}`;
            const action_id = document.getElementById('newComboAction').value;
            const tokens = comboRecording.buffer.map(b => b.name);

            if (!currentConfig.custom_sequences) currentConfig.custom_sequences = [];

            if (editingComboIndex !== null && currentConfig.custom_sequences[editingComboIndex]) {
                const target = currentConfig.custom_sequences[editingComboIndex];
                target.name = name;
                target.sequence = tokens;
                target.sequence_display = tokens.join(' ➔ ');
                target.action_id = action_id;
            } else {
                currentConfig.custom_sequences.push({
                    id: 'seq-combo-' + Date.now(),
                    name: name,
                    sequence: tokens,
                    sequence_display: tokens.join(' ➔ '),
                    action_id: action_id
                });
            }

            await saveConfigToServer();
            await cancelComboRecording();
            renderCombosList();
            alert(`Sequência [${tokens.join(' ➔ ')}] salva com sucesso!`);
        }

        async function deleteCombo(idx) {
            if (!confirm('Deseja excluir esta sequência combo?')) return;
            if (editingComboIndex === idx) await cancelComboRecording();
            currentConfig.custom_sequences.splice(idx, 1);
            await saveConfigToServer();
            renderCombosList();
        }

        // ==========================================
        // ABA 3: PAREAMENTO DE HARDWARE (SENSOR IR)
        // ==========================================
        function selectButtonForHardwarePairing(btnId, defaultName, defaultScancode) {
            pairSelectedId = btnId;
            document.querySelectorAll('.remote-case button').forEach(b => b.classList.remove('selected-mapping'));
            const el = document.getElementById(btnId);
            if (el) el.classList.add('selected-mapping');

            const existing = currentConfig.buttons.find(b => b.id === btnId);
            document.getElementById('pairBtnName').value = existing ? existing.name : defaultName;
            document.getElementById('pairScancode').value = existing ? existing.scancode : (defaultScancode || '');

            const notice = document.getElementById('hardwarePairStatusNotice');
            notice.innerHTML = `<span style="color:#38bdf8;">🎯 Tecla <strong>"${defaultName}"</strong> selecionada. Aponte o controle físico para a TV Box e aperte a tecla correspondente!</span>`;
        }

        function clearPairingForm() {
            pairSelectedId = null;
            document.querySelectorAll('.remote-case button').forEach(b => b.classList.remove('selected-mapping'));
            document.getElementById('pairBtnName').value = '';
            document.getElementById('pairScancode').value = '';
            document.getElementById('hardwarePairStatusNotice').innerHTML = '<span style="color:var(--text-muted);">Campos limpos. Aponte o controle ou clique no botão virtual.</span>';
        }

        async function saveHardwarePairing() {
            const scancode = document.getElementById('pairScancode').value.trim().toLowerCase();
            let name = document.getElementById('pairBtnName').value.trim();

            if (!scancode) {
                alert('⚠️ Nenhum código capturado! Aperte a tecla no controle físico primeiro.');
                return;
            }

            if (!name) name = 'Botão ' + scancode;

            let finalId = pairSelectedId;
            if (!finalId) {
                const existing = currentConfig.buttons.find(b => b.scancode.toLowerCase() === scancode);
                finalId = existing ? existing.id : ('btn-' + scancode.replace('0x', ''));
            }

            // Preserva a ação existente se já havia alguma vinculada
            let existingAction = 'none';
            let existingUnlock = false;
            const prev = currentConfig.buttons.find(b => b.id === finalId || b.scancode.toLowerCase() === scancode);
            if (prev) {
                existingAction = prev.action_id || 'none';
                existingUnlock = (prev.require_unlock !== false);
            }

            currentConfig.buttons = currentConfig.buttons.filter(b => 
                b.scancode.toLowerCase() !== scancode && b.id !== finalId
            );

            currentConfig.buttons.push({
                id: finalId,
                scancode: scancode,
                name: name,
                action_id: existingAction,
                require_unlock: existingUnlock,
                enabled: true
            });

            await saveConfigToServer();
            document.getElementById('hardwarePairStatusNotice').innerHTML = `<span style="color:#34d399; font-weight:700;">💾 Pareamento salvo! Tecla "<strong>${name}</strong>" vinculada ao código <code>${scancode}</code>.</span>`;
            if (finalId) flashVirtualKey(finalId);
        }

        // ==========================================
        // ABA 4: TRAVA GERAL DE SEGURANÇA
        // ==========================================
        async function startLockRecording(mode) {
            recordingContext = 'lock';
            recordingState.active = true;
            recordingState.mode = mode;
            recordingState.buffer = [];

            const rBox = document.getElementById('recordingBox');
            rBox.style.display = 'flex';
            rBox.className = mode === 'physical' ? 'rec-box active' : 'rec-box';

            const remoteCase = document.getElementById('virtualRemoteCase');
            if (mode === 'virtual') {
                remoteCase.classList.add('recording-mode');
                document.getElementById('recTitle').innerText = '🖱️ Gravando Trava Clicando no Controle Virtual';
                document.getElementById('recInstructions').innerText = 'Clique nos botões do controle à esquerda na ordem que desejar.';
            } else {
                remoteCase.classList.remove('recording-mode');
                document.getElementById('recTitle').innerText = '🔴 Gravando Trava com Controle Remoto Real';
                document.getElementById('recInstructions').innerText = 'Aponte o controle físico para a TV Box e aperte as teclas na sequência.';
                await fetch('/api/sequence/record', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'start_physical' })
                });
            }

            renderRecordingBadges();
        }

        function renderRecordingBadges() {
            const container = document.getElementById('recBadgesContainer');
            const counter = document.getElementById('recCounter');
            counter.innerText = `${recordingState.buffer.length} tecla(s)`;

            if (recordingState.buffer.length === 0) {
                container.innerHTML = '<span style="color:var(--text-muted); font-size:0.85rem;">Pressione as teclas agora...</span>';
                return;
            }

            container.innerHTML = recordingState.buffer.map((item, idx) => {
                return `<span class="key-badge">${idx + 1}. ${item.name}</span>`;
            }).join('<span style="color:var(--text-muted); font-weight:700;">➔</span>');
        }

        function popRecordingKey() {
            if (recordingState.buffer.length > 0) {
                recordingState.buffer.pop();
                renderRecordingBadges();
            }
        }

        function clearRecording() {
            recordingState.buffer = [];
            renderRecordingBadges();
        }

        async function cancelRecording() {
            recordingState.active = false;
            recordingState.buffer = [];
            document.getElementById('recordingBox').style.display = 'none';
            document.getElementById('virtualRemoteCase').classList.remove('recording-mode');
            await fetch('/api/sequence/record', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'cancel' })
            });
        }

        async function saveRecordedSequence() {
            if (recordingState.buffer.length === 0) {
                alert('Pressione ao menos uma tecla para formar a sequência!');
                return;
            }

            const tokens = recordingState.buffer.map(b => b.name);
            currentConfig.security_sequence = {
                enabled: document.getElementById('seqEnabled').value === 'true',
                sequence: tokens,
                sequence_display: tokens.join(' ➔ '),
                timeout_seconds: 6,
                unlock_duration_seconds: parseInt(document.getElementById('seqDuration').value) || 15
            };

            await saveConfigToServer();
            await cancelRecording();
            renderActiveSequenceBadges();
            alert(`Sequência da trava [${tokens.join(' ➔ ')}] salva com sucesso!`);
        }

        function renderActiveSequenceBadges() {
            const seq = currentConfig.security_sequence || {};
            const tokens = seq.sequence || ['1', '2', '3'];
            const container = document.getElementById('activeSeqDisplayBox');
            container.innerHTML = tokens.map(t => `<span class="key-badge">${t}</span>`).join('<span style="color:var(--text-muted); font-weight:700;">➔</span>');
            document.getElementById('targetSeqDisplay').innerText = tokens.join(' ➔ ');
        }

        async function updateSeqSettings() {
            if (!currentConfig.security_sequence) currentConfig.security_sequence = {};
            currentConfig.security_sequence.enabled = document.getElementById('seqEnabled').value === 'true';
            currentConfig.security_sequence.unlock_duration_seconds = parseInt(document.getElementById('seqDuration').value) || 15;
            await saveConfigToServer();
        }

        // ==========================================
        // ABA 5: CONTROLE DO LED BICOLOR
        // ==========================================
        async function setLedColorWeb(color) {
            const res = await fetch('/api/led/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode: color })
            });
            const data = await res.json();
            document.getElementById('ledResultNotice').innerText = data.msg || 'OK';
        }

        async function testPulseIR() {
            const res = await fetch('/api/led/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode: 'pulse_ir' })
            });
            const data = await res.json();
            document.getElementById('ledResultNotice').innerText = data.msg || 'OK';
            const led = document.getElementById('remoteLed');
            if (led) {
                led.classList.add('red');
                setTimeout(() => led.classList.remove('red'), 130);
            }
        }

        async function testAlternate() {
            const res = await fetch('/api/led/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode: 'blink_alternate' })
            });
            const data = await res.json();
            document.getElementById('ledResultNotice').innerText = data.msg || 'OK';
        }

        // ==========================================
        // CARREGAMENTO E SINCRONIZAÇÃO
        // ==========================================
        async function loadConfig() {
            try {
                const res = await fetch('/api/config');
                currentConfig = await res.json();
                if (!currentConfig.custom_sequences) currentConfig.custom_sequences = [];
                
                renderActionsCatalog();
                renderActionsDropdowns();
                renderButtonsTable();
                renderCombosList();
                renderActiveSequenceBadges();
                updateVirtualRemoteMappingVisuals();
                
                const seq = currentConfig.security_sequence || {};
                document.getElementById('seqEnabled').value = seq.enabled ? 'true' : 'false';
                document.getElementById('seqDuration').value = seq.unlock_duration_seconds || 15;
            } catch(e) { console.error(e); }
        }

        function updateVirtualRemoteMappingVisuals() {
            const mappedIds = new Set((currentConfig.buttons || []).map(b => b.id));
            const mappedNames = new Set((currentConfig.buttons || []).map(b => (b.name || '').toLowerCase()));

            document.querySelectorAll('.remote-case button').forEach(btn => {
                const btnId = btn.id;
                const btnText = (btn.innerText || '').trim().toLowerCase();
                const isMapped = mappedIds.has(btnId) || mappedNames.has(btnText);
                if (isMapped) {
                    btn.classList.add('is-mapped');
                } else {
                    btn.classList.remove('is-mapped');
                }
            });
        }

        function renderActionsCatalog() {
            const grid = document.getElementById('actionsGrid');
            if (!currentConfig.actions || currentConfig.actions.length === 0) {
                grid.innerHTML = '<div style="color:var(--text-muted);">Nenhuma ação cadastrada.</div>';
                return;
            }
            grid.innerHTML = currentConfig.actions.map(act => {
                return `<div class="action-card">
                    <div>
                        <div class="action-header">
                            <span class="action-title">${act.name}</span>
                            <span class="action-cat">${act.category || act.type}</span>
                        </div>
                        <p class="action-desc" style="margin-top:6px;">${act.desc || act.command || act.target || '-'}</p>
                    </div>
                    <div class="action-footer">
                        <button class="btn btn-secondary" style="font-size:0.75rem; padding:4px 8px;" onclick="testActionById('${act.id}', '${act.name}')">⚡ Testar</button>
                        ${act.id.startsWith('act-custom-') ? `<button class="btn btn-danger" style="font-size:0.75rem; padding:4px 8px;" onclick="deleteAction('${act.id}')">Excluir</button>` : ''}
                    </div>
                </div>`;
            }).join('');
        }

        function renderActionsDropdowns() {
            const opts = '<option value="none">-- Nenhuma Ação (Apenas Detectar) --</option>' + 
                currentConfig.actions.map(act => `<option value="${act.id}">${act.name} (${act.category || act.type})</option>`).join('');

            const fnSel = document.getElementById('fnActionSelect');
            if (fnSel) fnSel.innerHTML = opts;

            const comboSel = document.getElementById('newComboAction');
            if (comboSel) comboSel.innerHTML = opts;
        }

        function renderButtonsTable() {
            const tbody = document.getElementById('buttonsTableBody');
            if (!currentConfig.buttons || currentConfig.buttons.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color: var(--text-muted);">Nenhuma tecla cadastrada.</td></tr>';
                return;
            }

            tbody.innerHTML = currentConfig.buttons.map((b, idx) => {
                const optionsHtml = ['<option value="none">-- Nenhuma Ação --</option>'].concat(
                    currentConfig.actions.map(act => `<option value="${act.id}" ${act.id === b.action_id ? 'selected' : ''}>${act.name}</option>`)
                ).join('');

                return `<tr>
                    <td><span class="badge-code">${b.scancode}</span></td>
                    <td><strong>${b.name}</strong></td>
                    <td>
                        <select onchange="updateButtonActionFromTable(${idx}, this.value)" style="padding:4px 8px; font-size:0.8rem; background:rgba(0,0,0,0.5); border-radius:6px;">
                            ${optionsHtml}
                        </select>
                    </td>
                    <td>
                        <label style="display:flex; align-items:center; gap:6px; font-size:0.8rem; cursor:pointer;">
                            <input type="checkbox" ${b.require_unlock !== false ? 'checked' : ''} onchange="updateButtonUnlockFromTable(${idx}, this.checked)">
                            <span>${b.require_unlock !== false ? '🔒 Sim' : '🔓 Livre'}</span>
                        </label>
                    </td>
                    <td style="text-align: right; white-space: nowrap;">
                        <button class="btn btn-secondary" style="padding: 3px 8px; font-size: 0.75rem; margin-right: 4px;" onclick="testActionById('${b.action_id}', '${b.name}')">⚡ Testar</button>
                        <button class="btn btn-danger" style="padding: 3px 8px; font-size: 0.75rem;" onclick="deleteButton(${idx})">Remover</button>
                    </td>
                </tr>`;
            }).join('');
        }

        async function saveConfigToServer() {
            await fetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(currentConfig)
            });
            renderButtonsTable();
            updateVirtualRemoteMappingVisuals();
        }

        async function deleteButton(idx) {
            if (!confirm('Deseja remover esta tecla configurada?')) return;
            currentConfig.buttons.splice(idx, 1);
            await saveConfigToServer();
        }

        async function toggleWebUnlock() {
            await fetch('/api/unlock', { method: 'POST' });
        }

        async function testActionById(action_id, name) {
            if (action_id === 'act-poweroff' || action_id === 'act-reboot') {
                if (!confirm(`Atenção: Testar [${name}] vai afetar o servidor! Tem certeza?`)) return;
            }
            const res = await fetch('/api/test-action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action_id, name })
            });
            const data = await res.json();
            alert(`Resultado: ${data.msg || data.status}`);
        }

        function toggleNewActionForm() {
            const f = document.getElementById('newActionForm');
            f.style.display = (f.style.display === 'none') ? 'block' : 'none';
        }

        function toggleNewActionFields() {
            const t = document.getElementById('newActType').value;
            const lbl = document.getElementById('newActTargetLabel');
            const inp = document.getElementById('newActTarget');
            if (t === 'docker_toggle') {
                lbl.innerText = 'Nome do Container Docker';
                inp.placeholder = 'Ex: tela, pocketbase, nodered';
            } else if (t === 'webhook') {
                lbl.innerText = 'URL do Webhook (GET)';
                inp.placeholder = 'http://127.0.0.1:1880/api/endpoint';
            } else {
                lbl.innerText = 'Comando Bash / Shell';
                inp.placeholder = 'Ex: sync && echo 3 > /proc/sys/vm/drop_caches';
            }
        }

        async function saveNewAction() {
            const name = document.getElementById('newActName').value.trim();
            const type = document.getElementById('newActType').value;
            const target = document.getElementById('newActTarget').value.trim();
            const desc = document.getElementById('newActDesc').value.trim();

            if (!name || !target) {
                alert('Preencha o nome e o alvo da ação!');
                return;
            }

            const newId = 'act-custom-' + Date.now();
            currentConfig.actions.push({
                id: newId,
                name,
                category: type === 'webhook' ? 'API' : (type === 'docker_toggle' ? 'Docker' : 'Shell'),
                type,
                target,
                command: target,
                desc: desc || target
            });

            await saveConfigToServer();
            toggleNewActionForm();
            renderActionsCatalog();
            renderActionsDropdowns();
            renderButtonsTable();
            alert(`Ação "${name}" salva com sucesso!`);
        }

        async function deleteAction(actId) {
            if (!confirm('Deseja excluir esta ação da biblioteca?')) return;
            currentConfig.actions = currentConfig.actions.filter(a => a.id !== actId);
            await saveConfigToServer();
            renderActionsCatalog();
            renderActionsDropdowns();
            renderButtonsTable();
        }

        function updateLockUI(lockStatus) {
            const badge = document.getElementById('lockBadge');
            const banner = document.getElementById('lockBanner');
            const title = document.getElementById('lockTitle');
            const btn = document.getElementById('lockActionBtn');
            const led = document.getElementById('remoteLed');

            if (!lockStatus.enabled) {
                badge.className = 'status-pill';
                badge.innerHTML = '<span>🔓 Trava Desativada</span>';
                banner.className = 'lock-banner unlocked';
                title.innerText = '🔓 Trava Desativada';
                btn.style.display = 'none';
                if (led) led.classList.remove('unlocked-pulse');
                return;
            }

            if (lockStatus.locked) {
                badge.className = 'status-pill locked';
                badge.innerHTML = '<span>🔒 Bloqueado</span>';
                banner.className = 'lock-banner';
                title.innerText = '🛡️ Trava de Segurança por Sequência';
                btn.innerText = '🔓 Desbloquear via Web (15s)';
                btn.style.display = 'inline-flex';
                if (led) led.classList.remove('unlocked-pulse');
            } else {
                badge.className = 'status-pill unlocked';
                badge.innerHTML = `<span>🔓 DESBLOQUEADO (${lockStatus.remaining}s)</span>`;
                banner.className = 'lock-banner unlocked';
                title.innerText = `🔓 Controle Desbloqueado (${lockStatus.remaining}s restantes)`;
                btn.innerText = '🔒 Bloquear Agora';
                btn.style.display = 'inline-flex';
                if (led) led.classList.add('unlocked-pulse');
            }
        }

        let activeEvtSource = null;
        let sseReconnectTimer = null;

        function connectSSE() {
            if (sseReconnectTimer) {
                clearTimeout(sseReconnectTimer);
                sseReconnectTimer = null;
            }

            if (activeEvtSource) {
                try {
                    activeEvtSource.close();
                } catch(e) {}
                activeEvtSource = null;
            }

            try {
                activeEvtSource = new EventSource('/api/events');

                activeEvtSource.onopen = () => {
                    const pill = document.getElementById('sensorStatus');
                    const txt = document.getElementById('sensorText');
                    if (pill) pill.className = 'status-pill unlocked';
                    if (txt) txt.innerText = 'Receptor IR Conectado';

                    if (!currentConfig.buttons || currentConfig.buttons.length === 0) {
                        loadConfig();
                    }
                };

                activeEvtSource.onmessage = (e) => {
                    const data = JSON.parse(e.data);
                    if (data.type === 'lock_update') {
                        updateLockUI(data.status);
                    } else if (data.type === 'buffer_update') {
                        const tag = document.getElementById('liveBufferTag');
                        if (tag) {
                            const buf = data.buffer || [];
                            if (buf.length > 0) {
                                tag.innerText = 'Últimas teclas: ' + buf.join(' ➔ ');
                                tag.style.color = '#38bdf8';
                            } else {
                                tag.innerText = 'Aguardando teclas...';
                                tag.style.color = '#93c5fd';
                            }
                        }
                    } else if (data.type === 'recording_step') {
                        if (recordingContext === 'lock' && recordingState.active && recordingState.mode === 'physical') {
                            recordingState.buffer = data.record_buffer || [];
                            renderRecordingBadges();
                        } else if (recordingContext === 'combo' && comboRecording.active && comboRecording.mode === 'physical') {
                            comboRecording.buffer = data.record_buffer || [];
                            renderComboRecBadges();
                        }
                    } else if (data.type === 'event') {
                        const scancode = (data.last_scancode || '').toLowerCase();
                        const isMapped = data.is_mapped;
                        const serverBtnName = data.button_name;
                        const btnId = data.button_id;

                        const match = currentConfig.buttons.find(b => b.scancode.toLowerCase() === scancode);

                        if (match && match.id) {
                            flashVirtualKey(match.id);
                        } else if (btnId) {
                            flashVirtualKey(btnId);
                        } else {
                            const led = document.getElementById('remoteLed');
                            if (led && !led.classList.contains('unlocked-pulse')) {
                                led.classList.add('red');
                                setTimeout(() => led.classList.remove('red'), 130);
                            }
                        }

                        // ATUALIZAÇÃO DO CAMPO DE HARDWARE APENAS QUANDO NA ABA DE PAREAMENTO DE HARDWARE!
                        if (activeTab === 'tab-calibrate' && scancode && scancode !== 'sys') {
                            const pairScanInput = document.getElementById('pairScancode');
                            if (pairScanInput) pairScanInput.value = scancode;
                            
                            const pairNameInput = document.getElementById('pairBtnName');
                            if (pairNameInput && !pairNameInput.value.trim() && match) {
                                pairNameInput.value = match.name;
                            }
                            
                            const notice = document.getElementById('hardwarePairStatusNotice');
                            if (notice) {
                                notice.innerHTML = `<span style="color:#10b981; font-weight:700;">📡 Sinal capturado: <code>${scancode}</code>! Digite o nome do botão ou selecione à esquerda e clique em Salvar Pareamento.</span>`;
                            }
                        }

                        if (data.lock_status) updateLockUI(data.lock_status);
                        updateLogs(data.entry);
                    }
                };

                activeEvtSource.onerror = () => {
                    const pill = document.getElementById('sensorStatus');
                    const txt = document.getElementById('sensorText');
                    if (pill) pill.className = 'status-pill locked';
                    if (txt) txt.innerText = 'Servidor Desconectado (Reconectando em 5s...)';

                    // CRÍTICO: Fechar a conexão morta imediatamente para não acumular
                    // instâncias em background no navegador gerando vazamento de memória e sockets
                    if (activeEvtSource) {
                        try { activeEvtSource.close(); } catch(e) {}
                        activeEvtSource = null;
                    }

                    if (!sseReconnectTimer) {
                        sseReconnectTimer = setTimeout(() => {
                            sseReconnectTimer = null;
                            connectSSE();
                        }, 5000);
                    }
                };
            } catch (err) {
                console.error('Falha ao conectar SSE:', err);
                if (!sseReconnectTimer) {
                    sseReconnectTimer = setTimeout(() => {
                        sseReconnectTimer = null;
                        connectSSE();
                    }, 5000);
                }
            }
        }

        // Reconecta automaticamente ao focar na aba se estiver desconectado
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && !activeEvtSource) {
                connectSSE();
            }
        });

        // Limpa recursos ao sair da página
        window.addEventListener('beforeunload', () => {
            if (sseReconnectTimer) clearTimeout(sseReconnectTimer);
            if (activeEvtSource) {
                try { activeEvtSource.close(); } catch(e) {}
            }
        });

        function updateLogs(entry) {
            if (!entry) return;
            const container = document.getElementById('logsContainer');
            const item = document.createElement('div');
            item.className = 'log-item ' + (entry.status || '');
            item.innerHTML = `
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="color:var(--text-muted); font-size:0.75rem;">${entry.timestamp}</span>
                    <span class="badge-code">${entry.scancode}</span>
                    <strong>${entry.name}</strong>
                    <span style="color:var(--text-muted); font-size:0.8rem;">➔</span>
                    <span>${entry.action}</span>
                </div>
            `;
            container.insertBefore(item, container.firstChild);
            if (container.children.length > 30) {
                container.removeChild(container.lastChild);
            }
        }

        setInterval(() => {
            const badge = document.getElementById('lockBadge');
            if (badge && badge.classList.contains('unlocked')) {
                const match = badge.innerText.match(/\\((\\d+)s\\)/);
                if (match) {
                    const s = parseInt(match[1]) - 1;
                    if (s > 0) {
                        badge.innerHTML = `<span>🔓 DESBLOQUEADO (${s}s)</span>`;
                        document.getElementById('lockTitle').innerText = `🔓 Controle Desbloqueado (${s}s restantes)`;
                    } else {
                        updateLockUI({ enabled: true, locked: true, remaining: 0 });
                    }
                }
            }
        }, 1000);

        loadConfig();
        connectSSE();
    </script>
</body>
</html>
"""

# --- HTTP SERVER ---
class RemoteHubHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/" or parsed.path == "/index.html":
            body = HTML_PAGE.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(body)

        elif parsed.path == "/api/config":
            body = json.dumps(current_config).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(body)

        elif parsed.path == "/api/status":
            body = json.dumps({
                "device_connected": state["device_connected"],
                "last_scancode": state["last_scancode"],
                "last_button_name": state["last_button_name"],
                "lock_status": get_lock_status(),
                "led_color": state["current_led_color"],
                "events_log": state["events_log"][:15]
            }).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(body)

        elif parsed.path == "/api/events":
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.end_headers()

            with sse_lock:
                state["sse_clients"].append(self)

            init_msg = f"data: {json.dumps({'type': 'lock_update', 'status': get_lock_status()})}\n\n".encode("utf-8")
            try:
                self.wfile.write(init_msg)
                self.wfile.flush()
                while True:
                    time.sleep(20)
                    self.wfile.write(b": ping\n\n")
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, Exception):
                pass
            finally:
                with sse_lock:
                    if self in state["sse_clients"]:
                        state["sse_clients"].remove(self)
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        global current_config
        parsed = urlparse(self.path)
        content_len = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_len).decode("utf-8") if content_len > 0 else "{}"
        try:
            data = json.loads(body) if body else {}
        except Exception:
            data = {}

        if parsed.path == "/api/config":
            current_config = data
            save_config(current_config)
            broadcast_sse({"type": "lock_update", "status": get_lock_status()})
            resp = json.dumps({"status": "ok"}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(resp)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(resp)

        elif parsed.path == "/api/press-key":
            btn_id = data.get("id")
            name = data.get("name")
            scancode = data.get("scancode")
            process_key_event("WEB_VIRTUAL", key_id=btn_id, key_name=name, scancode=scancode)
            resp = json.dumps({"status": "ok", "lock_status": get_lock_status()}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(resp)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(resp)

        elif parsed.path == "/api/sequence/record":
            action = data.get("action", "")
            with state_lock:
                if action == "start_physical":
                    state["recording_mode"] = True
                    state["recording_type"] = "physical"
                    state["record_buffer"] = []
                elif action == "cancel":
                    state["recording_mode"] = False
                    state["record_buffer"] = []
                elif action == "clear":
                    state["record_buffer"] = []
            resp = json.dumps({"status": "ok", "recording": state["recording_mode"]}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(resp)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(resp)

        elif parsed.path == "/api/unlock":
            if state["is_unlocked"]:
                with state_lock:
                    state["is_unlocked"] = False
                    state["unlock_expires"] = 0
                broadcast_sse({"type": "lock_update", "status": get_lock_status()})
                log_event("SYS", "Trava de Segurança", "🔒 Bloqueado manualmente via Web.", "warning")
            else:
                trigger_unlock(15)
            resp = json.dumps({"status": "ok", "lock_status": get_lock_status()}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(resp)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(resp)

        elif parsed.path == "/api/test-action":
            act_id = data.get("action_id", "")
            name = data.get("name", "Teste Web")
            res = run_action_by_id(act_id, name, "WEB")
            resp = json.dumps(res).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(resp)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(resp)

        elif parsed.path == "/api/led/test":
            mode = data.get("mode", "pulse_ir")
            msg = "Comando executado"
            try:
                if mode == "blue":
                    set_led_color("blue")
                    msg = "🔵 TV Box no modo LIGADO: LED Azul ativo (Pino 229 = 1)"
                elif mode == "red":
                    set_led_color("red")
                    msg = "🔴 TV Box no modo STANDBY: LED Vermelho ativo (Pino 229 = 0)"
                elif mode == "pulse_ir":
                    threading.Thread(target=pulse_ir_feedback, daemon=True).start()
                    msg = "✨ Simulação de sinal IR: Azul ➔ Vermelho (120ms) ➔ Azul"
                elif mode == "blink_alternate":
                    def alt():
                        for _ in range(4):
                            set_led_color("red")
                            time.sleep(0.2)
                            set_led_color("blue")
                            time.sleep(0.2)
                    threading.Thread(target=alt, daemon=True).start()
                    msg = "🚨 Alternando entre Azul e Vermelho 4 vezes..."
            except Exception as e:
                msg = f"Erro no controle de LED: {e}"

            resp = json.dumps({"status": "ok", "msg": msg}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(resp)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(resp)

        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        return

class DualStackServer(ThreadingHTTPServer):
    address_family = socket.AF_INET6
    request_queue_size = 64
    daemon_threads = True
    allow_reuse_address = True

    def server_bind(self):
        self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        super().server_bind()

def main():
    init_bicolor_led()
    threading.Thread(target=ir_listener_worker, daemon=True).start()
    threading.Thread(target=unlock_blinker_worker, daemon=True).start()
    server = DualStackServer(("", 1886), RemoteHubHandler)
    print("[RemoteHub] Servidor Web Dual-Stack (IPv4 + IPv6) ativo na porta 1886 (http://tvbox.local:1886)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass

if __name__ == "__main__":
    main()
