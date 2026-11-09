/// <reference path="../pb_data/types.d.ts" />

// ============================================================================
// Central de Compartilhamento de Tela P2P (WebRTC Zero-Latency Signaling)
// Roda 100% em RAM dentro do PocketBase existente (0 MB RAM extra / 0 escrita em disco)
// ============================================================================

routerAdd("POST", "/api/tela/action", (e) => {
    try {
        let ROOM_PASSWORD = $os.getenv("TELA_PASSWORD") || "";
        if (!ROOM_PASSWORD) {
            try {
                ROOM_PASSWORD = toString($os.readFile("/pb_data/tela_pass.txt")).trim();
            } catch (_) {}
        }
        if (!ROOM_PASSWORD) ROOM_PASSWORD = "123456";
        const info = e.requestInfo();
        const body = info.body || {};

        const providedPass = String(body.password || "").trim();
        if (providedPass !== ROOM_PASSWORD) {
            return e.json(401, {
                ok: false,
                error: "Senha da sala incorreta!"
            });
        }

        const action = String(body.action || "");
        const clientId = String(body.clientId || "").trim();
        if (!clientId) {
            return e.json(400, { ok: false, error: "clientId ausente." });
        }

        const brokerClients = $app.subscriptionsBroker().clients();

        // Carrega estado em memória e limpa clientes desconectados
        let rawState = $app.store().get("tela_room_state");
        let state = rawState ? JSON.parse(rawState) : { users: {}, chat: [] };
        if (!state.users) state.users = {};
        if (!state.chat) state.chat = [];

        let stateChangedByCleanup = false;
        const knownIds = Object.keys(state.users);
        for (let i = 0; i < knownIds.length; i++) {
            const id = knownIds[i];
            if (!brokerClients[id] || brokerClients[id].isDiscarded()) {
                delete state.users[id];
                stateChangedByCleanup = true;
            }
        }

        const sendToClient = (targetId, payload) => {
            const c = brokerClients[targetId];
            if (c && !c.isDiscarded()) {
                const msg = new SubscriptionMessage({
                    name: "tela_room",
                    data: JSON.stringify(payload)
                });
                c.send(msg);
                return true;
            }
            return false;
        };

        const broadcastRoom = (payload) => {
            const activeIds = Object.keys(state.users);
            const msg = new SubscriptionMessage({
                name: "tela_room",
                data: JSON.stringify(payload)
            });
            for (let i = 0; i < activeIds.length; i++) {
                const id = activeIds[i];
                const c = brokerClients[id];
                if (c && !c.isDiscarded()) {
                    c.send(msg);
                }
            }
        };

        if (action === "join") {
            const rawNick = String(body.nick || "Amigo").trim().slice(0, 28) || "Amigo";
            const existing = state.users[clientId];
            state.users[clientId] = {
                clientId: clientId,
                nick: rawNick,
                joinedAt: existing ? existing.joinedAt : Date.now(),
                isStreaming: existing ? !!existing.isStreaming : false,
                streamInfo: existing ? existing.streamInfo : null
            };
            $app.store().set("tela_room_state", JSON.stringify(state));

            const userList = Object.values(state.users);
            broadcastRoom({
                type: "room_update",
                users: userList,
                event: { kind: "join", clientId: clientId, nick: rawNick }
            });

            let httpsUrl = "";
            try {
                httpsUrl = toString($os.readFile("/pb_data/funnel_url.txt")).trim();
            } catch (_) {}

            return e.json(200, {
                ok: true,
                users: userList,
                chat: state.chat,
                httpsUrl: httpsUrl
            });
        }

        // Garante que o usuário está registrado na sala
        if (!state.users[clientId]) {
            const fallbackNick = String(body.nick || "Amigo").trim().slice(0, 28) || "Amigo";
            state.users[clientId] = {
                clientId: clientId,
                nick: fallbackNick,
                joinedAt: Date.now(),
                isStreaming: false,
                streamInfo: null
            };
        }

        const currentUser = state.users[clientId];

        if (action === "leave") {
            const leftNick = currentUser.nick;
            delete state.users[clientId];
            $app.store().set("tela_room_state", JSON.stringify(state));

            broadcastRoom({
                type: "room_update",
                users: Object.values(state.users),
                event: { kind: "leave", clientId: clientId, nick: leftNick }
            });
            return e.json(200, { ok: true });
        }

        if (action === "start_stream" || action === "update_stream") {
            currentUser.isStreaming = true;
            currentUser.streamInfo = body.streamInfo || {
                label: "720p • 30 FPS",
                hasAudio: true,
                audioMuted: false
            };
            state.users[clientId] = currentUser;
            $app.store().set("tela_room_state", JSON.stringify(state));

            const userList = Object.values(state.users);
            broadcastRoom({
                type: "room_update",
                users: userList,
                event: {
                    kind: action,
                    clientId: clientId,
                    nick: currentUser.nick,
                    streamInfo: currentUser.streamInfo
                }
            });
            return e.json(200, { ok: true, users: userList });
        }

        if (action === "stop_stream") {
            currentUser.isStreaming = false;
            currentUser.streamInfo = null;
            state.users[clientId] = currentUser;
            $app.store().set("tela_room_state", JSON.stringify(state));

            const userList = Object.values(state.users);
            broadcastRoom({
                type: "room_update",
                users: userList,
                event: {
                    kind: "stop_stream",
                    clientId: clientId,
                    nick: currentUser.nick
                }
            });
            return e.json(200, { ok: true, users: userList });
        }

        if (action === "webrtc_signal") {
            const targetId = String(body.targetId || "").trim();
            if (!targetId) {
                return e.json(400, { ok: false, error: "targetId ausente." });
            }
            if (stateChangedByCleanup) {
                $app.store().set("tela_room_state", JSON.stringify(state));
            }
            const delivered = sendToClient(targetId, {
                type: "webrtc_signal",
                fromId: clientId,
                fromNick: currentUser.nick,
                targetId: targetId,
                signalType: String(body.signalType || ""),
                signalData: body.signalData || null
            });
            return e.json(200, { ok: true, delivered: delivered });
        }

        if (action === "chat") {
            const text = String(body.text || "").trim().slice(0, 500);
            if (!text) {
                return e.json(400, { ok: false, error: "Mensagem vazia." });
            }
            const chatMsg = {
                id: Date.now() + "-" + Math.random().toString(36).slice(2, 6),
                clientId: clientId,
                nick: currentUser.nick,
                text: text,
                time: Date.now()
            };
            state.chat.push(chatMsg);
            if (state.chat.length > 60) {
                state.chat = state.chat.slice(state.chat.length - 60);
            }
            $app.store().set("tela_room_state", JSON.stringify(state));

            broadcastRoom({
                type: "chat_message",
                message: chatMsg
            });
            return e.json(200, { ok: true, message: chatMsg });
        }

        if (action === "heartbeat") {
            if (stateChangedByCleanup) {
                $app.store().set("tela_room_state", JSON.stringify(state));
                broadcastRoom({
                    type: "room_update",
                    users: Object.values(state.users),
                    event: { kind: "sync" }
                });
            }
            return e.json(200, {
                ok: true,
                users: Object.values(state.users)
            });
        }

        return e.json(400, { ok: false, error: "Acao desconhecida: " + action });
    } catch (err) {
        return e.json(500, { ok: false, error: String(err) });
    }
});

// Quando qualquer conexão SSE (/api/realtime) se encerrar (aba fechada),
// remove imediatamente o usuário da sala e avisa os demais participantes!
onRealtimeConnectRequest((e) => {
    e.next();
    try {
        const disconnectedId = e.client ? e.client.id() : "";
        if (!disconnectedId) return;

        let rawState = $app.store().get("tela_room_state");
        if (!rawState) return;
        let state = JSON.parse(rawState);
        if (!state || !state.users || !state.users[disconnectedId]) return;

        const leftNick = state.users[disconnectedId].nick;
        delete state.users[disconnectedId];
        $app.store().set("tela_room_state", JSON.stringify(state));

        const brokerClients = $app.subscriptionsBroker().clients();
        const activeIds = Object.keys(state.users);
        const msg = new SubscriptionMessage({
            name: "tela_room",
            data: JSON.stringify({
                type: "room_update",
                users: Object.values(state.users),
                event: { kind: "leave", clientId: disconnectedId, nick: leftNick }
            })
        });
        for (let i = 0; i < activeIds.length; i++) {
            const id = activeIds[i];
            const c = brokerClients[id];
            if (c && !c.isDiscarded()) {
                c.send(msg);
            }
        }
    } catch (_) {}
});
