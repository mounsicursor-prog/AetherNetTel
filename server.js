import wisp from "wisp-server-node"
import { createBareServer } from "@tomphttp/bare-server-node"
import { uvPath } from "@titaniumnetwork-dev/ultraviolet"
import { epoxyPath } from "@mercuryworkshop/epoxy-transport"
import { bareModulePath } from "@mercuryworkshop/bare-as-module3"
import { baremuxPath } from "@mercuryworkshop/bare-mux/node"
import express from "express";
import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";

const bare = createBareServer("/bare/")
const __dirname = join(fileURLToPath(import.meta.url), "..");
const app = express();
const publicPath = "public"; // if you renamed your directory to something else other than public

app.use(express.static(publicPath));
app.use("/uv/", express.static(uvPath));
app.use("/epoxy/", express.static(epoxyPath));
app.use("/baremux/", express.static(baremuxPath));
app.use("/baremod/", express.static(bareModulePath));

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
    if (req.url.endsWith("/wisp/")) {
        wisp.routeRequest(req, socket, head);
    } else if (bare.shouldRoute(req)) {
        bare.routeUpgrade(req, socket, head);
    } else {
        socket.end();
    }
});

let port = parseInt(process.env.PORT || "");

if (isNaN(port)) port = 8080; // set your port
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
    bare.close();
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
