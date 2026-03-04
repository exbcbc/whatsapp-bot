import express from "express";
import OpenAI from "openai";
import dotenv from "dotenv";
import axios from "axios";
import fs from "fs";

dotenv.config();

/* garante pasta de áudio */
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

const DOMAIN = "https://whatsapp-bot-production-5f72.up.railway.app";
const SHEET_API = "https://sheetdb.io/api/v1/wgkxf59rp8phz";

const CHATWOOT_API = process.env.CHATWOOT_API_URL;
const CHATWOOT_TOKEN = process.env.CHATWOOT_TOKEN;

const conversations = {};
const processedMessages = new Set();

/* DATA BRASIL */

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

/* DETECÇÕES */

function detectName(msg){

const match =
msg.match(/meu nome é ([A-Za-zÀ-ú]+)/i) ||
msg.match(/me chamo ([A-Za-zÀ-ú]+)/i) ||
msg.match(/sou o ([A-Za-zÀ-ú]+)/i) ||
msg.match(/sou a ([A-Za-zÀ-ú]+)/i);

if(match) return match[1];
return null;

}

function detectProcedure(msg){

const t=msg.toLowerCase();

if(t.includes("botox") || t.includes("ruga")) return "botox";
if(t.includes("preenchimento") || t.includes("lábio") || t.includes("labio")) return "preenchimento";
if(t.includes("papada")) return "lipo de papada";
if(t.includes("vaso")) return "microvasos";
if(t.includes("melasma") || t.includes("mancha")) return "tratamento manchas";
if(t.includes("flacidez")) return "bioestimulador";

return null;

}

function classifyLead(msg){

const t=msg.toLowerCase();

if(t.includes("agendar") || t.includes("marcar") || t.includes("horário")) return "quente";
if(t.includes("valor") || t.includes("preço")) return "frio";

return "morno";

}

/* SALVAR LEAD */

async function salvarLead(nome,telefone,procedimento,lead){

try{

await axios.post(SHEET_API,{
data:[{
data:new Date().toLocaleDateString("pt-BR"),
nome:nome || "",
telefone:telefone,
procedimento:procedimento || "",
lead:lead || "",
status:"lead"
}]
});

}catch(e){
console.log("erro salvar lead");
}

}

/* ENVIAR PARA CHATWOOT */

async function enviarChatwoot(phone,message){

try{

await axios.post(
`${CHATWOOT_API}/public/api/v1/inboxes/1/messages`,
{
source_id: phone,
content: message
},
{
headers:{
api_access_token: CHATWOOT_TOKEN
}
}
);

}catch(e){
console.log("erro chatwoot");
}

}

/* BAIXAR ÁUDIO */

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

/* RESPOSTA IA */

async function aiReply(history,nextDateText){

const completion=await openai.chat.completions.create({

model:"gpt-4o-mini",

messages:[

{
role:"system",
content:`

Você é assistente da clínica Dr Henrique Mafra.

Fale profissionalmente.

Nunca use emojis.
Nunca informe valores.

Objetivo: levar paciente para avaliação presencial.

Sempre sugerir primeiro horário às 19h30.

Somente se paciente disser que não pode,
ofereça horários entre 14h e 18h.

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

app.post("/whatsapp", async(req,res)=>{

try{

const messageSid=req.body.MessageSid;

/* evita duplicação Twilio */

if(processedMessages.has(messageSid)){
return res.sendStatus(200);
}

processedMessages.add(messageSid);

setTimeout(()=>{
processedMessages.delete(messageSid);
},60000);

const from=req.body.From;

const hasAudio=req.body.NumMedia && req.body.NumMedia>0;

let message=req.body.Body || "";

/* áudio */

if(hasAudio){

const mediaUrl=req.body.MediaUrl0;

const path=await downloadAudio(mediaUrl);

message=await transcribeAudio(path);

}

/* criar conversa */

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

/* comandos */

if(msg==="#humano"){
user.iaAtiva=false;
return res.type("text/xml").send(`<Response></Response>`);
}

if(msg==="#ia"){
user.iaAtiva=true;
return res.type("text/xml").send(`<Response></Response>`);
}

if(msg==="#reset"){
conversations[from]={history:[],nome:null,procedimento:null,lead:null,iaAtiva:true};
return res.type("text/xml").send(`<Response></Response>`);
}

/* humano assumiu */

if(!user.iaAtiva){
return res.type("text/xml").send(`<Response></Response>`);
}

/* análise */

const name=detectName(message);
if(name) user.nome=name;

const procedure=detectProcedure(message);
if(procedure) user.procedimento=procedure;

user.lead=classifyLead(message);

/* salvar lead */

await salvarLead(user.nome,from,user.procedimento,user.lead);

/* enviar chatwoot */

await enviarChatwoot(from,message);

/* histórico */

user.history.push({role:"user",content:message});

const nextDateText=formatDate(nextAvailableDate());

const reply=await aiReply(user.history,nextDateText);

user.history.push({role:"assistant",content:reply});

/* áudio resposta */

if(hasAudio){

await generateVoice(reply);

return res.type("text/xml").send(
`<Response>
<Message>
<Media>${DOMAIN}/audio/reply.mp3</Media>
</Message>
</Response>`
);

}

/* resposta texto */

res.type("text/xml").send(
`<Response>
<Message>${reply}</Message>
</Response>`
);

}catch(err){

console.log(err);

res.type("text/xml").send(
`<Response>
<Message>Ocorreu uma instabilidade. Pode enviar novamente?</Message>
</Response>`
);

}

});

/* servidor */

const PORT=process.env.PORT || 8080;

app.listen(PORT,()=>{
console.log("Servidor rodando");
});
