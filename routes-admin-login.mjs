import express from 'express';
import {db} from './db.mjs';
import {nurAdmin} from './routes-kurse.mjs';
const router=express.Router();
router.get('/api/admin/logins',nurAdmin,(_req,res)=>{
 res.setHeader('Cache-Control','no-store');
 res.json(db.prepare('SELECT zeit,ergebnis,email_maskiert,adresse_maskiert,hinweis FROM admin_login_protokoll ORDER BY id DESC LIMIT 100').all());
});
export const adminLoginRouter=router;
