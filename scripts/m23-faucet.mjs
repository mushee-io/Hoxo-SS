#!/usr/bin/env node
/** Operator-only official TESTNET faucet, no public endpoint, no wallet keys. */
import {m23FundingPreview,requestM23TestnetXlm,M23_FAUCET_ACK} from "../beta/faucet.mjs";
const args=process.argv.slice(2);
if(args.length<1||args.length>2||
   (args.length===2&&args[1]!=="--request-testnet-funding"))
  throw Error("Usage: npm run m23:faucet -- <STELLAR_G_ADDRESS> [--request-testnet-funding]");
const publicKey=args[0];
if(args.length===1)console.log(JSON.stringify(m23FundingPreview(publicKey),null,2));
else{
  if(process.env.HOXO_M23_FAUCET_ACK!==M23_FAUCET_ACK)
    throw Error("Operator must set HOXO_M23_FAUCET_ACK to exact Testnet-only acknowledgement");
  console.log(JSON.stringify(await requestM23TestnetXlm({
    account:publicKey,acknowledgement:M23_FAUCET_ACK,
  }),null,2));
}
