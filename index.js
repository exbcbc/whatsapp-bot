
import express from "express";
import OpenAI from "openai";
import dotenv from "dotenv";
import axios from "axios";
import fs from "fs";

dotenv.config();

if (!fs.existsSync("./audio")){
fs.mkdirSync("./audio");
}

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use("/audio", express.static("./audio"));

const openai = new OpenAI({
apiKey: process.env.OPENAI_API_KEY
});

const DOMAIN="https://whatsapp-bot-production-5f72.up.railway.app";
const SHEET_API="https://sheetdb.io/api/v1/wgkxf59rp8phz";

const CHATWOOT_API=process.env.CHATWOOT_API_URL;
const CHATWOOT_TOKEN=process.env.CHATWOOT_TOKEN;

const conversations={};
const processedMessages=new Set();

/* DATA */

function getBrazilDate(){
return new Date(new Date().toLocaleString("en-US",{timeZone:"America/Sao_Paulo"}));
}

function nextAvailableDate(){

let d=getBrazilDate();
d.setDate(d.getDate()+5);

while(d.getDay()===0 || d.getDay()===1 || d.getDay()===6){
d.setDate(d.getDate()+1);
}

return d;

}

function formatDate(date){

return date.toLocaleDateString("pt-BR",{
weekday:"long",
day:"numeric",
month:"long",
year:"numeric",
timeZone:"America/Sao_Paulo"
});

}

/* DETECTAR */

function detectName(msg){

const match=
msg.match(/meu nome é ([A-Za-zÀ-ú]+)/i)||
msg.match(/me chamo ([A-Za-zÀ-ú]+)/i)||
msg.match(/sou o ([A-Za-zÀ-ú]+)/i)||
msg.match(/sou a ([A-Za-zÀ-ú]+)/i);

if(match) return match[1];

return null;

}

function detectProcedure(msg){

const t=msg.toLowerCase();

if(t.includes("botox")) return "botox";
if(t.includes("preenchimento")) return "preenchimento";
if(t.includes("papada")) return "lipo papada";
if(t.includes("vaso")) return "microvasos";
if(t.includes("melasma")||t.includes("mancha")) return "manchas";
if(t.includes("flacidez")) return "bioestimulador";

return null;

}

function classifyLead(msg){

const t=msg.toLowerCase();

if(t.includes("agendar")||t.includes("marcar")||t.includes("horário"))
return "quente";

if(t.includes("valor")||t.includes("preço"))
return "frio";

return "morno";

}

/* SALVAR LEAD */

async function salvarLead(nome,telefone,procedimento,lead){

try{

await axios.post(SHEET_API,{
data:[{
data:new Date().toLocaleDateString("pt-BR"),
nome:nome||"",
telefone:telefone,
procedimento:procedimento||"",
lead:lead||"",
status:"lead"
}]
});

}catch(e){

console.log("erro salvar lead");

}

}

/* CHATWOOT */

async function enviarChatwoot(phone,message){

try{

const contact=await axios.post(
`${CHATWOOT_API}/api/v1/accounts/1/contacts`,
{
name:phone,
phone_number:phone,
identifier:phone
},
{
headers:{api_access_token:CHATWOOT_TOKEN}
}
);

const contactId=contact.data.payload.contact.id;

const conversation=await axios.post(
`${CHATWOOT_API}/api/v1/accounts/1/conversations`,
{
inbox_id:1,
contact_id:contactId
},
{
headers:{api_access_token:CHATWOOT_TOKEN}
}
);

const conversationId=conversation.data.id;

await axios.post(
`${CHATWOOT_API}/api/v1/accounts/1/conversations/${conversationId}/messages`,
{
content:message,
message_type:"incoming"
},
{
headers:{api_access_token:CHATWOOT_TOKEN}
}
);

}catch(e){

console.log("erro chatwoot");

}

}

/* BAIXAR AUDIO */

async function downloadAudio(url){

const response=await axios({
url,
method:"GET",
responseType:"stream",
auth:{
username:process.env.TWILIO_ACCOUNT_SID,
password:process.env.TWILIO_AUTH_TOKEN
}
});

const path="./audio/input.ogg";

const writer=fs.createWriteStream(path);

response.data.pipe(writer);

return new Promise(resolve=>{
writer.on("finish",()=>resolve(path));
});

}

/* TRANSCRIÇÃO */

async function transcribeAudio(path){

const transcription=await openai.audio.transcriptions.create({
file:fs.createReadStream(path),
model:"gpt-4o-transcribe"
});

return transcription.text;

}

/* GERAR VOZ */

async function generateVoice(text){

const speech=await openai.audio.speech.create({
model:"gpt-4o-mini-tts",
voice:"nova",
input:text
});

const buffer=Buffer.from(await speech.arrayBuffer());

fs.writeFileSync("./audio/reply.mp3",buffer);

}

/* IA */

async function aiReply(history,nextDateText){

const completion=await openai.chat.completions.create({

model:"gpt-4o-mini",

messages:[

{
role:"system",
content:`

Você é assistente da clínica Dr Henrique Mafra.

Nunca use emojis.
Nunca informe valores.

Objetivo: levar paciente para avaliação presencial.

Sempre sugerir primeiro horário às 19h30.

Data mínima para agendamento:
${nextDateText}

Respostas curtas.

`
},

...history

]

});

return completion.choices[0].message.content;

}

/* ROTA WHATSAPP */

app.post("/whatsapp",async(req,res)=>{

try{

const messageSid=req.body.MessageSid;

if(processedMessages.has(messageSid)){

return res.sendStatus(200);

}

processedMessages.add(messageSid);

setTimeout(()=>processedMessages.delete(messageSid),60000);

const from=req.body.From;

const hasAudio=req.body.NumMedia&&req.body.NumMedia>0;

let message=req.body.Body||"";

if(hasAudio){

const mediaUrl=req.body.MediaUrl0;

const path=await downloadAudio(mediaUrl);

message=await transcribeAudio(path);

}

if(!conversations[from]){

conversations[from]={
history:[],
nome:null,
procedimento:null,
lead:null,
iaAtiva:true
};

}

const user=conversations[from];

const msg=message.trim().toLowerCase();

if(msg==="#humano"){
user.iaAtiva=false;
return res.sendStatus(200);
}

if(msg==="#ia"){
user.iaAtiva=true;
return res.sendStatus(200);
}

if(msg==="#reset"){
conversations[from]={history:[],nome:null,procedimento:null,lead:null,iaAtiva:true};
return res.sendStatus(200);
}

if(!user.iaAtiva){
return res.sendStatus(200);
}

const name=detectName(message);
if(name) user.nome=name;

const procedure=detectProcedure(message);
if(procedure) user.procedimento=procedure;

user.lead=classifyLead(message);

await salvarLead(user.nome,from,user.procedimento,user.lead);

await enviarChatwoot(from,message);

user.history.push({role:"user",content:message});

const nextDateText=formatDate(nextAvailableDate());

const reply=await aiReply(user.history,nextDateText);

user.history.push({role:"assistant",content:reply});

if(hasAudio){

await generateVoice(reply);

return res.type("text/xml").send(
`<Response><Message><Media>${DOMAIN}/audio/reply.mp3</Media></Message></Response>`
);

}

res.type("text/xml").send(
`<Response><Message>${reply}</Message></Response>`
);

}catch(err){

console.log(err);

res.type("text/xml").send(
`<Response><Message>Ocorreu uma instabilidade. Pode enviar novamente?</Message></Response>`
);

}

});

const PORT=process.env.PORT||8080;

app.listen(PORT,()=>{

console.log("Servidor rodando");

});
