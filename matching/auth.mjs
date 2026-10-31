/**
 * HOXO SS M8: testnet-only signed matching-engine intents.
 *
 * This signature authenticates an OFF-CHAIN matching command; it never
 * authorizes a Stellar transaction or provides spending authority.
 * A wallet must sign the exact UTF-8 payload returned by canonicalPayload().
 */
import { createPublicKey, verify as verifyEd25519 } from "node:crypto";
import { isStellarGAddress } from "../app/wallet-core.mjs";

export const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";
const PREFIX = "HOXO-SS-M8-OFFCHAIN-INTENT-V1\n";
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function decodeBase32(source) {
  let n = 0, bits = 0;
  const bytes = [];
  for (const ch of source) {
    const digit = BASE32.indexOf(ch);
    if (digit < 0) throw Error("Invalid Stellar StrKey");
    n = (n << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((n >>> bits) & 255);
      n &= (1 << bits) - 1;
    }
  }
  if (bits && n) throw Error("Invalid Stellar StrKey padding");
  return Buffer.from(bytes);
}
const fieldsByType = Object.freeze({
  place: ["type", "networkPassphrase", "owner", "nonce", "clientOrderId", "marketId", "side", "priceE7", "quantityE7", "expiresAtMs"],
  cancel: ["type", "networkPassphrase", "owner", "nonce", "orderId"],
  replace: ["type", "networkPassphrase", "owner", "nonce", "orderId", "clientOrderId", "marketId", "side", "priceE7", "quantityE7", "expiresAtMs"],
});

export function canonicalPayload(command) {
  if (!command || typeof command !== "object" || Array.isArray(command)) throw Error("Command must be an object");
  const fields = fieldsByType[command.type];
  if (!fields) throw Error("Unsupported matching command");
  const received = Object.keys(command).sort();
  if (JSON.stringify(received) !== JSON.stringify([...fields].sort())) throw Error("Command has missing or unexpected fields");
  if (command.networkPassphrase !== TESTNET_PASSPHRASE) throw Error("Wrong Stellar network passphrase");
  if (!isStellarGAddress(command.owner)) throw Error("Invalid Stellar G address");
  if (!Number.isSafeInteger(command.nonce) || command.nonce <= 0) throw Error("Invalid nonce");
  return Buffer.from(PREFIX + JSON.stringify(Object.fromEntries(fields.map(key => [key, command[key]]))), "utf8");
}
export function verifySignedCommand(command, signature) {
  const payload = canonicalPayload(command);
  if (typeof signature !== "string" || !/^[A-Za-z0-9_-]{86}$/.test(signature)) throw Error("Signature must be a base64url Ed25519 signature");
  const bytes = Buffer.from(signature, "base64url");
  if (bytes.length !== 64 || bytes.toString("base64url") !== signature) throw Error("Invalid signature encoding");
  const publicKeyBytes = decodeBase32(command.owner).subarray(1, 33);
  // RFC 8410 Ed25519 SubjectPublicKeyInfo header + raw 32-byte public key.
  const key = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), publicKeyBytes]), format: "der", type: "spki" });
  if (!verifyEd25519(null, payload, key, bytes)) throw Error("Invalid order-intent signature");
  return true;
}
