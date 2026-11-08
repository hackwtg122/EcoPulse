import {readdir,readFile} from "node:fs/promises";
const root=new URL("../../artifacts/eco-pulse/dist/public/assets/",import.meta.url);
const files=(await readdir(root)).filter(name=>name.endsWith(".js"));
if(!files.length)throw Error("frontend_bundle_missing");
for(const name of files){
  const source=await readFile(new URL(name,root),"utf8");
  if(["separar-con-criterio","papel-sin-contaminar","organicos-con-proposito"].some(marker=>source.includes(marker))) throw Error("server_challenge_catalog_in_browser_bundle");
}
console.log(JSON.stringify({check:"challenge_bundle_boundary",status:"PASS",browserChunksChecked:files.length,serverCatalogMarkersPresent:false}));
