/// <reference path="../pb_data/types.d.ts" />

// ============================================================================
// Central de Projetos (Hub) - PocketBase Hook
// Fornece API REST ultraleve para persistência dos projetos em hub_projetos.json
// Consumo: 0 MB de RAM adicional (executado dentro da VM Goja do PocketBase)
// ============================================================================

routerAdd("GET", "/api/hub/projetos", (e) => {
    try {
        let content = "";
        try {
            content = toString($os.readFile("/pb_data/hub_projetos.json"));
        } catch (_) {}

        if (!content || !content.trim()) {
            return e.json(200, { ok: true, data: [] });
        }
        return e.json(200, { ok: true, data: JSON.parse(content) });
    } catch (err) {
        return e.json(500, { ok: false, error: String(err) });
    }
});

routerAdd("POST", "/api/hub/projetos", (e) => {
    try {
        const info = e.requestInfo();
        const body = info.body || {};
        const projetos = body.projetos;

        if (!Array.isArray(projetos)) {
            return e.json(400, { ok: false, error: "Formato esperado: { projetos: [...] }" });
        }

        const jsonStr = JSON.stringify(projetos, null, 2);
        $os.writeFile("/pb_data/hub_projetos.json", jsonStr, 0666);

        return e.json(200, {
            ok: true,
            message: "Lista de projetos salva com sucesso no servidor!"
        });
    } catch (err) {
        return e.json(500, { ok: false, error: String(err) });
    }
});
