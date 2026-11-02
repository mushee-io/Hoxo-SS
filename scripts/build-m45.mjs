#!/usr/bin/env node
/**
 * Reproducible, local-only M45 browser bundle. No external SDK CDN or signing
 * on import; the bundle only registers DOM event listeners after page load.
 */
import {build} from "esbuild";
const result=await build({
  entryPoints:["app/m45-spot-ui.mjs"],
  bundle:true,
  format:"iife",
  platform:"browser",
  target:["es2022"],
  outfile:"app/m45-spot.bundle.js",
  minify:true,
  sourcemap:false,
  legalComments:"none",
  logLevel:"info",
  metafile:true
});
if(result.errors.length)throw Error("M45 bundling failed");
const output=Object.entries(result.metafile.outputs).find(([name])=>name.endsWith("m45-spot.bundle.js"));
if(!output||output[1].bytes<1000)throw Error("M45 browser bundle missing/empty");
console.log("M45 local bundle ready, bytes:",output[1].bytes);
