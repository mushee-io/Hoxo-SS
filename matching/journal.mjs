/**
 * HOXO SS M8 append-only signed command journal.
 * Locally durable sandbox state; not settlement or an authoritative ledger.
 *
 * The journal is fail-closed: invalid, incomplete or altered log records halt
 * restart. One process holds an exclusive .lock file; stale lock after crash
 * requires operator review before manual removal.
 */
import { open, readFile, mkdir, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import { verifySignedCommand } from "./auth.mjs";
import { emptyBook, projectCommand, snapshot, orderById, advancedOrderById, orderTransitions, simulatedPosition } from "./core.mjs";
import {projectSandboxHistory} from "../portfolio/sandbox-history.mjs";

const START_HASH = "0".repeat(64);
function hashRecord(record) {
  return createHash("sha256").update(JSON.stringify(record)).digest("hex");
}
export class SignedOrderJournal {
  constructor(path, file, lock, state, lastHash, tickSigner=null) {
    this.path = path;
    this.file = file;
    this.lock = lock;
    this.state = state;
    this.lastHash = lastHash;
    this.tickSigner = tickSigner;
    this.halted = false;
    this.closed = false;
    this.queue = Promise.resolve();
  }
  static async open(path,{tickSigner=null}={}) {
    if (typeof path !== "string" || path.length === 0) throw Error("Journal path required");
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const lockPath = path + ".lock";
    const lock = await open(lockPath, "wx", 0o600);
    let file;
    try {
      let data = "";
      try { data = await readFile(path, "utf8"); }
      catch (e) { if (e.code !== "ENOENT") throw e; }
      let state = emptyBook(), previousHash = START_HASH;
      if (data && !data.endsWith("\n")) throw Error("Corrupt journal: incomplete final line; operator recovery required");
      const rows = data ? data.slice(0, -1).split("\n") : [];
      for (const line of rows) {
        if (!line || line.length > 32_768) throw Error("Corrupt journal line");
        let row;
        try { row = JSON.parse(line); }
        catch { throw Error("Corrupt journal JSON"); }
        const { hash, ...unsigned } = row;
        if (unsigned.version !== 1 || unsigned.previousHash !== previousHash ||
            unsigned.sequence !== state.sequence + 1 ||
            hash !== hashRecord(unsigned)) throw Error("Journal hash-chain/sequence mismatch");
        verifySignedCommand(unsigned.command, unsigned.signature);
        const next = projectCommand(state,unsigned.command,unsigned.atMs,{tickSigner});
        if (next.result.sequence !== unsigned.sequence) throw Error("Journal replay mismatch");
        state = next.state;
        previousHash = hash;
      }
      file = await open(path, "a", 0o600);
      return new SignedOrderJournal(path,file,lock,state,previousHash,tickSigner);
    } catch (error) {
      if (file) await file.close().catch(() => {});
      await lock.close().catch(() => {});
      await unlink(lockPath).catch(() => {});
      throw error;
    }
  }
  async submit(command, signature, atMs = Date.now()) {
    if (this.closed || this.halted) throw Error("Matching journal is unavailable; no orders accepted");
    const operation = async () => {
      if (this.closed || this.halted) throw Error("Matching journal is unavailable");
      verifySignedCommand(command, signature);
      const { state, result } = projectCommand(this.state,command,atMs,{tickSigner:this.tickSigner});
      const unsigned = { version: 1, sequence: result.sequence, previousHash: this.lastHash, atMs, command, signature };
      const hash = hashRecord(unsigned);
      // No acceptance acknowledgment before durable append + fsync.
      try {
        await this.file.writeFile(JSON.stringify({ ...unsigned, hash }) + "\n", "utf8");
        await this.file.sync();
      } catch (error) {
        // Partial append may have occurred. Fail closed instead of proceeding.
        this.halted = true;
        throw Error("Journal write failed; matching halted: " + error.message);
      }
      this.state = state;
      this.lastHash = hash;
      return { ...result, journalHash: hash };
    };
    const result = this.queue.then(operation);
    this.queue = result.then(() => {}, () => {});
    return result;
  }
  getPortfolioHistory(owner,options={}) {
    // Valid only after signed, hashed journal replay at open().
    return projectSandboxHistory(this.state,owner,options);
  }
  getBook(marketId, depth = 20) {
    return snapshot(this.state, marketId, depth);
  }
  getOrder(orderId) {
    return orderById(this.state, orderId);
  }
  getAdvancedOrder(orderId) {return advancedOrderById(this.state,orderId);}
  getOrderTransitions(orderId) {return orderTransitions(this.state,orderId);}
  getSimulatedPosition(owner,marketId) {return simulatedPosition(this.state,owner,marketId);}
  getFills(marketId, limit = 25) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw Error("Invalid fill limit");
    return this.state.fills.filter(f => f.marketId === marketId).slice(-limit).map(f => ({...f}));
  }
  getStatus() {
    return { status: this.halted ? "HALTED" : this.closed ? "CLOSED" : "SANDBOX_READY",
      sequence: this.state.sequence, openOrders: this.state.orders.size,
      pendingConditionalOrders:this.state.conditionals.size,
      sandboxPriceOperatorConfigured:!!this.tickSigner,
      canonicalOracleIntegrated:false,
      positionSource:"M8_M17_SIMULATED_MATCHES_NOT_ONCHAIN",
      simulatedFills: this.state.fills.length,
      settlement: "DISABLED", network: "STELLAR_TESTNET_REFERENCE_ONLY" };
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    await this.queue;
    await this.file.close();
    await this.lock.close();
    await unlink(this.path + ".lock");
  }
}
