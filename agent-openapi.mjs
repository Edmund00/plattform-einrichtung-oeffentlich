// Öffentliche OpenAPI 3.1 für GPT Actions. Kein Schlüssel in Spezifikation oder Antwort.
import { plattformName } from './marke.mjs';
const ops=[
 ['get','/api/agent/kurse','listDrafts','List course titles, descriptions, prices, status and draft summaries.'],
 ['get','/api/agent/kurse/{id}','readCourse','Read course and lesson text without customer data.'],
 ['post','/api/agent/kurse','createDraft','Create a new private course draft for human review.'],
 ['patch','/api/agent/kurse/{id}','editDraft','Edit a private draft title, description or suggested price.'],
 ['post','/api/agent/kurse/{id}/lektionen','createLesson','Create a plain-text lesson in a private draft.'],
 ['patch','/api/agent/lektionen/{id}','editLesson','Edit or reorder a plain-text lesson belonging to a private draft.'],
 ['delete','/api/agent/lektionen/{id}','deleteLesson','Delete a lesson belonging to a private draft without files.'],
 ['delete','/api/agent/kurse/{id}','deleteDraft','Delete an unpublished course draft without customer, payment, or uploaded file records.'],
 ['post','/api/agent/kurse/{id}/freigabe','requestPublication','Lock a draft and request publication by an administrator.'],
 ['post','/api/agent/kurse/{id}/vorschlag','proposeChange','Propose one published-course field change without applying it.']
];
export function openapi(base){
 const paths={};
 for(const [method,path,operationId,description] of ops){
   const item={operationId,description,security:[{agentBearer:[]}],
     responses:{'200':{description:'Result'},'201':{description:'Created'},'400':{description:'Invalid input'},'401':{description:'Unauthorized'},'403':{description:'Forbidden'},'429':{description:'Rate limit'}}};
   if(path.includes('{id}'))item.parameters=[{in:'path',name:'id',required:true,schema:{type:'integer',minimum:1}}];
   if(method==='post'||method==='patch')item.requestBody={required:true,content:{'application/json':{schema:
     operationId==='createDraft'||operationId==='editDraft'?
       {type:'object',additionalProperties:false,properties:{titel:{type:'string',maxLength:160},beschreibung:{type:'string',maxLength:5000},preis_cent:{type:'integer',minimum:0}}}:
     operationId==='createLesson'||operationId==='editLesson'?
       {type:'object',additionalProperties:false,properties:{titel:{type:'string',maxLength:160},inhalt:{type:'string',maxLength:20000},reihenfolge:{type:'integer',minimum:0}}}:
     operationId==='proposeChange'?
       {type:'object',additionalProperties:false,required:['feld','wert'],properties:{feld:{type:'string',enum:['titel','beschreibung','preis_cent']},wert:{oneOf:[{type:'string'},{type:'integer'}]}}}:
       {type:'object',additionalProperties:false}}}};
   (paths[path]??={})[method]=item;
 }
 return {openapi:'3.1.0',info:{title:plattformName()+' Agent Entwürfe',version:'1.0.0'},
   servers:[{url:base}],components:{securitySchemes:{agentBearer:{type:'http',scheme:'bearer'}}},paths};
}
