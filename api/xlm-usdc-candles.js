/**
 * Same-origin, pinned Stellar Horizon Testnet OHLC feed for the Hoxo chart.
 * Read-only; NEVER creates synthetic Hoxo M9 settlements or volume.
 */
import {m68ReadHorizonCandles,M68_FRAMES} from "../app/m68-classic-dex-candles.mjs";
export default async function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  if(req.method!=="GET"){
    res.setHeader("Allow","GET");
    return res.status(405).json({error:"GET only"});
  }
  const frame=typeof req.query?.frame==="string"?req.query.frame:"30m";
  if(!Object.hasOwn(M68_FRAMES,frame))
    return res.status(400).json({error:"Unsupported chart interval"});
  try{
    const result=await m68ReadHorizonCandles({frame});
    res.setHeader("Cache-Control","public, s-maxage=15, stale-while-revalidate=30");
    return res.status(200).json(result);
  }catch{
    return res.status(503).json({
      state:"unavailable",verified:false,
      error:"Stellar Testnet Classic DEX trade history unavailable",
      source:"Stellar Horizon Testnet",
      synthetic:false
    });
  }
}
