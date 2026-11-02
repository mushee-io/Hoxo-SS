/** Public, read-only evidence of actual Hoxo M9 Testnet settlement volume.
 * Never creates orders, accounts, signatures or transactions.
 */
import {readM59VerifiedSpotActivity}
  from "../verification/m59-m9-ledger-activity.mjs";
export default async function handler(req,res){
  if(req.method!=="GET"){
    res.setHeader("Allow","GET");
    return res.status(405).json({error:"GET only"});
  }
  try{
    const data=await readM59VerifiedSpotActivity();
    res.setHeader("Cache-Control","public, s-maxage=15, stale-while-revalidate=15");
    return res.status(200).json(data);
  }catch(error){
    res.setHeader("Cache-Control","no-store");
    return res.status(503).json({
      state:"unavailable",verified:false,
      error:"Stellar Testnet settlement ledger proof currently unavailable",
      note:"No volume or transaction status has been inferred."
    });
  }
}
