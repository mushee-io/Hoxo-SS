/**
 * HOXO SS M8 local-only sandbox matching API, no execution gateway.
 * Server binds loopback and rejects browser-origin POSTs. All state mutations
 * require a genuine signed Ed25519 intent and explicit unsettled acknowledgement.
 */
import { createServer } from "node:http";
import { URL } from "node:url";
import { SANDBOX_MARKETS } from "./core.mjs";

const MAX_BODY = 16_384;
function respond(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, max-age=0",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex",
  });
  res.end(JSON.stringify(body));
}
async function readJSON(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers["content-type"] || "")) throw Error("Expected application/json");
  if (Number(req.headers["content-length"]) > MAX_BODY) throw Error("Request body too large");
  let total = 0;
  const chunks = [];
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY) throw Error("Request body too large");
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) throw Error("Empty request");
  let payload;
  try { payload = JSON.parse(text); } catch { throw Error("Malformed JSON"); }
  if (!payload || Array.isArray(payload) || typeof payload !== "object" ||
      JSON.stringify(Object.keys(payload).sort()) !== JSON.stringify(["command", "signature"])) {
    throw Error("Expected command and signature only");
  }
  return payload;
}
const number = (value, defaultValue) => {
  if (value === null) return defaultValue;
  if (!/^[0-9]{1,3}$/.test(value)) throw Error("Invalid limit/depth");
  return Number(value);
};
export function createSandboxServer(journal, { now = Date.now, rateLimit = 60 } = {}) {
  const visitorHits = new Map();
  return createServer(async (req, res) => {
    const ip = req.socket.remoteAddress || "unknown";
    const time = now();
    const window = visitorHits.get(ip);
    if (!window || time - window.start >= 60_000) visitorHits.set(ip, {start:time,count:1});
    else window.count += 1;
    if (visitorHits.get(ip).count > rateLimit) {
      respond(res, 429, {error:"Rate limit exceeded",settlement:"DISABLED"});return;
    }
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      if (req.method === "GET" && url.pathname === "/health") {
        respond(res,200,{
          ...journal.getStatus(),
          tradingEnabled:false,riskEngineIntegrated:false,
          onchainOrders:false,marketDataSource:"NONE",
        });
        return;
      }
      if (req.method === "GET" && url.pathname === "/v1/book") {
        const marketId = url.searchParams.get("marketId");
        if (!SANDBOX_MARKETS.includes(marketId)) throw Error("Unknown reference market");
        respond(res,200,journal.getBook(marketId,number(url.searchParams.get("depth"),20)));
        return;
      }
      if (req.method === "GET" && url.pathname === "/v1/fills") {
        const marketId = url.searchParams.get("marketId");
        if (!SANDBOX_MARKETS.includes(marketId)) throw Error("Unknown reference market");
        respond(res,200,{marketId,simulatedFills:journal.getFills(marketId,number(url.searchParams.get("limit"),25)),
          settlement:"NOT_SETTLED",tradingEnabled:false});
        return;
      }
      if (req.method === "GET" && url.pathname === "/v1/order") {
        const orderId = url.searchParams.get("orderId");
        if (!orderId || orderId.length > 130) throw Error("Invalid order identifier");
        respond(res,200,{order:journal.getOrder(orderId),onchain:false});
        return;
      }
      if (req.method === "POST" && url.pathname === "/v1/commands") {
        // No CORS support for state-changing commands. Integration proxy needs a
        // separate audited backend with authentication/rate controls.
        if (req.headers.origin) throw Error("Browser-origin write requests are disabled");
        if (req.headers["x-hoxo-sandbox-ack"] !== "UNSETTLED") {
          throw Error("Explicit UNSETTLED sandbox acknowledgement required");
        }
        const {command,signature} = await readJSON(req);
        const result = await journal.submit(command,signature,time);
        respond(res,201,{...result,network:"STELLAR_TESTNET_REFERENCE_ONLY"});
        return;
      }
      respond(res,404,{error:"Not found",settlement:"DISABLED"});
    } catch (error) {
      const message=String(error.message||error);
      const conflict=/nonce|duplicate|self-trade|not found|expired/i.test(message);
      respond(res,conflict?409:400,{error:message,settlement:"DISABLED",tradingEnabled:false});
    }
  });
}
