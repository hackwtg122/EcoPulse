import { Router } from "express";
import { ChallengeError,listChallenges,loadChallenge,saveChallengeDraft,submitChallenge,listAdminChallenges,saveAdminChallenge } from "../lib/challenges";

const router=Router();
async function database(){return (await import("@workspace/db")).pool;}
router.get("/challenges",async(_req,res)=>res.json({items:await listChallenges(await database(),res.locals.userId)}));
router.get("/challenges/:id",async(req,res)=>res.json(await loadChallenge(await database(),res.locals.userId,String(req.params.id))));
router.put("/challenges/:id/draft",async(req,res)=>res.json(await saveChallengeDraft(await database(),res.locals.userId,String(req.params.id),req.body)));
router.post("/challenges/:id/submit",async(req,res)=>{
  const result=await submitChallenge(await database(),res.locals.userId,String(req.params.id),req.get("Idempotency-Key"),req.body);
  if(result.replayed) res.set("Idempotency-Replayed","true");
  return res.json(result);
});
router.get("/admin/challenges",async(_req,res)=>{
  if(res.locals.role!=="admin") return res.status(403).json({error:"admin_required"});
  return res.json({items:await listAdminChallenges(await database())});
});
router.post("/admin/challenges",async(req,res)=>{
  if(res.locals.role!=="admin") return res.status(403).json({error:"admin_required"});
  return res.status(201).json(await saveAdminChallenge(await database(),res.locals.userId,null,req.body));
});
router.put("/admin/challenges/:id",async(req,res)=>{
  if(res.locals.role!=="admin") return res.status(403).json({error:"admin_required"});
  return res.json(await saveAdminChallenge(await database(),res.locals.userId,String(req.params.id),req.body));
});
router.use((error:unknown,_req:import("express").Request,res:import("express").Response,next:import("express").NextFunction)=>{
  if(error instanceof ChallengeError) return res.status(error.status).json({error:error.code});
  return next(error);
});
export default router;
