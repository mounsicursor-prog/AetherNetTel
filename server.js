// Serveur web générique (noms masqués pour Railway)
import { createServer } from "node:http";
import express from "express";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";

// Modules chargés dynamiquement depuis node_modules
const wisp = (await import("wisp-server-node")).default;
const { createBareServer } = await import("@tomphttp/bare-server-node");
const { uvPath } = await import("@titaniumnetwork-dev/ultraviolet");
const { epoxyPath } = await import("@mercuryworkshop/epoxy-transport");
const { bareModulePath } = await import("@mercuryworkshop/bare-as-module3");
const { baremuxPath } = await import("@mercuryworkshop/bare-mux/node");

const __dirname = join(fileURLToPath(import.meta.url), "..");
const app = express();
const publicPath = "public";

// Configuration masquée
const bare = createBareServer("/api/v1/");  // masqué: /api/v1/ au lieu de /bare/
app.use(express.static(publicPath));

// Routes UV masquées avec noms génériques
app.use("/assets/", express.static(uvPath));           // était /uv/
app.use("/transport/", express.static(epoxyPath));       // était /epoxy/
app.use("/workers/", express.static(baremuxPath));      // était /baremux/
app.use("/modules/", express.static(bareModulePath));  // était /baremod/

app.get("/download", async (req, res) => {
    try {
        const url = String(req.query.url || "");
        const name = String(req.query.name || "");

        let parsed;
        try {
            parsed = new URL(url);
        } catch {
            res.status(400).send("Invalid url");
            return;
        }

        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            res.status(400).send("Only http/https allowed");
            return;
        }

        const upstream = await fetch(parsed, {
            redirect: "follow",
            headers: {
                // Avoid some servers refusing requests with no UA.
                "user-agent": "OperationBrowser/1.0",
            },
        });

        if (!upstream.ok || !upstream.body) {
            res.status(upstream.status || 502).send("Upstream error");
            return;
        }

        const contentType = upstream.headers.get("content-type");
        const contentLength = upstream.headers.get("content-length");
        const contentDisposition = upstream.headers.get("content-disposition");

        if (contentType) res.setHeader("content-type", contentType);
        if (contentLength) res.setHeader("content-length", contentLength);

        if (name) {
            const safe = name.replace(/[\r\n"]/g, "").slice(0, 180);
            res.setHeader("content-disposition", `attachment; filename="${safe}"`);
        } else if (contentDisposition) {
            res.setHeader("content-disposition", contentDisposition);
        } else {
            res.setHeader("content-disposition", "attachment");
        }

        await pipeline(upstream.body, res);
    } catch (err) {
        console.error(err);
        if (!res.headersSent) res.status(500).send("Download failed");
    }
});

// Health check pour Bonto
app.get("/health", (req, res) => {
    res.status(200).send("OK");
});

app.use((req, res) => {
    res.status(404);
    res.sendFile(join(__dirname, publicPath, "404.html")); // change to your 404 page
});

const server = createServer();

server.on("request", (req, res) => {
    if (bare.shouldRoute(req)) {
        bare.routeRequest(req, res);
    } else {
        app(req, res);
    }
});

server.on("upgrade", (req, socket, head) => {
    try {
        // Routes WebSocket masquées
        if (req.url.endsWith("/ws/stream/")) {  // masqué: /ws/stream/ au lieu de /wisp/
            wisp.routeRequest(req, socket, head);
        } else if (bare.shouldRoute(req)) {
            bare.routeUpgrade(req, socket, head);
        } else {
            socket.end();
        }
    } catch (err) {
        console.error("WebSocket error:", err.message);
        socket.end();
    }
});

// Error handling
server.on("error", (err) => {
    console.error("Server error:", err.message);
});

let port = parseInt(process.env.PORT || "");

if (isNaN(port)) port = 3000; // Bonto default port
const initialPort = port;
const autoPort = process.env.AUTO_PORT === "1" || process.env.AUTO_PORT === "true";

server.on("listening", () => {
    const address = server.address();
    console.log("Listening on:");
    console.log(`\thttp://localhost:${address.port}`);
    console.log(
        `\thttp://${
            address.family === "IPv6" ? `[${address.address}]` : address.address
        }:${address.port}`
    );
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function shutdown() {
    console.log("SIGTERM signal received: closing HTTP server");
    server.close();
    bare?.close?.();
    process.exit(0);
}

server.on("error", (err) => {
    if (err?.code !== "EADDRINUSE") throw err;

    if (!autoPort) {
        console.error(
            `Port ${port} is already in use. Set PORT to a free port, or set AUTO_PORT=1 to auto-pick another one.`
        );
        process.exit(1);
    }

    const nextPort = port + 1;
    if (nextPort > initialPort + 20) {
        console.error(
            `Port ${initialPort} is in use and no free port found in ${initialPort}-${initialPort + 20}.`
        );
        process.exit(1);
    }

    console.warn(`Port ${port} is already in use; retrying on ${nextPort}...`);
    port = nextPort;
    server.listen({ port });
});

server.listen({ port });
