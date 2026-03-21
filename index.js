import express from "express";
import OpenAI from "openai";
import dotenv from "dotenv";
import axios from "axios";
import fs from "fs";

dotenv.config();

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

if (!fs.existsSync("./media")) {
  fs.mkdirSync("./media");
}

app.use("/media", express.static("./media"));

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const DOMAIN="https://whatsapp-bot-production-5f72.up.railway.app";

const CLINIC_PHONE="whatsapp:+554731700136";
const ADMIN_PHONE="whatsapp:+5547991812557";
const INSTAGRAM="@dr.henriquemafra";

const CLINIC_ADDRESS=`
Clínica WF
Rua 981, Número 196
Centro em Balneário Camboriú, Santa Catarina
`;

const DOCTOR_PHONE="47 99188-6417";

const conversations={};

// ================= DATA =================

function getBrazilDate(){
return new Date(new Date().toLocaleString("en-US",{timeZone:"America/Sao_Paulo"}));
}

function nextAvailableDates(){
let dates=[];
let d=getBrazilDate();
d.setDate(d.getDate()+5);

while(dates.length<3){
if(d.getDay()!==0 && d.getDay()!==1 && d.getDay()!==6){
dates.push(new Date(d));
}
d.setDate(d.getDate()+1);
}

return dates;
}

function formatDate(date){
return date.toLocaleDateString("pt-BR",{
weekday:"long",
day:"numeric",
month:"long"
});
}

// ================= TWILIO =================

async function sendWhatsAppMessage(to,text){
try{
const url=`https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`;

await axios.post(url,new URLSearchParams({
From:CLINIC_PHONE,
To:to,
Body:text
}),{
auth:{
username:process.env.TWILIO_ACCOUNT_SID,
password:process.env.TWILIO_AUTH_TOKEN
}
});

}catch(e){
console.log("Erro mensagem:",e.message);
}
}

async function sendWhatsAppMedia(to,media){
try{
if(!media) return;

const url=`https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`;

await axios.post(url,new URLSearchParams({
From:CLINIC_PHONE,
To:to,
MediaUrl:media
}),{
auth:{
username:process.env.TWILIO_ACCOUNT_SID,
password:process.env.TWILIO_AUTH_TOKEN
}
});

}catch(e){
console.log("Erro mídia:",e.message);
}
}

// ================= MEDIA =================

async function downloadMedia(url,mediaType){
try{
const ext = mediaType.split("/")[1] || "dat";
const fileName=`media_${Date.now()}.${ext}`;
const filePath=`./media/${fileName}`;

const response=await axios({
url,
method:"GET",
responseType:"stream",
auth:{
username:process.env.TWILIO_ACCOUNT_SID,
password:process.env.TWILIO_AUTH_TOKEN
}
});

const writer=fs.createWriteStream(filePath);
response.data.pipe(writer);

return new Promise(resolve=>{
writer.on("finish",()=>{
resolve(`${DOMAIN}/media/${fileName}`);
});
});

}catch(e){
console.log("Erro download mídia",e.message);
return null;
}
}

async function transcribeAudio(url){
try{
const localPath=url.replace(`${DOMAIN}/media/`,`./media/`);

const transcription=await openai.audio.transcriptions.create({
file:fs.createReadStream(localPath),
model:"gpt-4o-transcribe"
});

return transcription.text;

}catch(e){
console.log("Erro transcrição",e.message);
return "";
}
}

async function generateVoice(text){
try{
const speech=await openai.audio.speech.create({
model:"gpt-4o-mini-tts",
voice:"nova",
input:text
});

const buffer=Buffer.from(await speech.arrayBuffer());
const file=`reply_${Date.now()}.mp3`;

fs.writeFileSync(`./media/${file}`,buffer);

return `${DOMAIN}/media/${file}`;

}catch(e){
console.log("Erro voz",e.message);
return null;
}
}

// ================= IA =================

async function aiReply(history){

try{

const dates=nextAvailableDates();
const limitedHistory = history.slice(-6);

const completion = await openai.chat.completions.create({
model:"gpt-4o-mini",
max_tokens:80,
temperature:0.4,
messages:[
{
role:"system",
content:`
Seu nome é Iara, assistente virtual do Dr Henrique Mafra.

REGRAS:

- NÃO atende domingo nem segunda.
- Se pedirem esses dias, negar e redirecionar.

- Horários de funcionamento:
Terça a sexta: 14h às 21h e Sábado: 10h às 14h

- Oferecer inicialmente SOMENTE:
${formatDate(dates[0])} às 19h30
${formatDate(dates[1])} às 19h30
${formatDate(dates[2])} às 19h30

- NUNCA inventar novos dias fora desses.

- SEMPRE FALAR:
"O investimento da consulta é de R$150, e esse valor é totalmente abatido no procedimento."

---

REGRAS DE AGENDAMENTO:

1. Se o paciente aceitar horário:
→ pedir o nome completo:
"Perfeito! Me informe seu nome completo para confirmar o agendamento"

2. Após o paciente enviar o nome:
→ confirmar o agendamento com dia e horário escolhido

→ depois dizer:
"Agendamento confirmado! O Dr. Henrique Mafra entrará em contato com você um dia antes para te lembrar, através do número particular dele"

3. Se NÃO puder à noite:
→ perguntar:
"Qual horário no período da tarde você prefere?"

4. Quando o paciente disser um horário:

✔ Se estiver dentro do funcionamento:
→ SEMPRE responder que conseguiu encaixar
→ usar frase:
"Consegui uma brecha às [HORÁRIO] na [DIA]"

✔ Se estiver FORA:
→ sugerir outro horário válido

---

IMPORTANTE:

- Nunca dizer que não tem horário à tarde
- Sempre tentar encaixar
- Sempre parecer natural
-SEMPRE FALAR:
"O investimento da consulta é de R$150, e esse valor é totalmente abatido no procedimento."

---


- Sempre que fizer sentido na conversa, principalmente ao final da resposta ou após sugerir horários, incluir de forma natural:

"Para saber mais sobre os procedimentos e acompanhar o dia a dia do Dr. Henrique Mafra, acesse nosso Instagram: ${INSTAGRAM} "

- Não repetir em todas as mensagens.
- Usar principalmente:
  • após explicar procedimentos
  • após sugerir horários
  • após confirmar agendamento
  

FLUXO:
Cumprimentar → entender → explicar → agendar → pedir nome → confirmar.

Respostas curtas (máx 4 frases).
`
},
...limitedHistory
]
});

return completion.choices[0].message.content || "Pode repetir?";

}catch(e){
console.log("ERRO IA:", e.message);
return "Pode repetir?";
}
}

// ================= WHATSAPP =================

app.post("/whatsapp",async(req,res)=>{

try{

const from=req.body.From;
let message=req.body.Body || "";
const numMedia=parseInt(req.body.NumMedia || 0);

if(!conversations[from]){
conversations[from]={history:[],lastInteraction:Date.now()};
}

const user=conversations[from];

if(Date.now()-user.lastInteraction>1000*60*30){
user.history=[];
}

user.lastInteraction=Date.now();

let hasAudio=false;

if(numMedia>0){

const mediaUrl=req.body.MediaUrl0;
const mediaType=req.body.MediaContentType0;

const localMedia=await downloadMedia(mediaUrl,mediaType);

if(localMedia){

await new Promise(r=>setTimeout(r,500));
await sendWhatsAppMedia(ADMIN_PHONE,localMedia);

if(mediaType.includes("audio")){
hasAudio=true;
message=await transcribeAudio(localMedia);
}

}
}

await sendWhatsAppMessage(ADMIN_PHONE,`📩 ${from}\n${message}`);

user.history.push({role:"user",content:message});

const reply=await aiReply(user.history);

user.history.push({role:"assistant",content:reply});

if(hasAudio){
const audioUrl=await generateVoice(reply);
await sendWhatsAppMedia(from,audioUrl);
await sendWhatsAppMedia(ADMIN_PHONE,audioUrl);
}else{
await sendWhatsAppMessage(from,reply);
await sendWhatsAppMessage(ADMIN_PHONE,reply);
}

res.send("ok");

}catch(err){
console.log("Erro geral:",err.message);
res.send("ok");
}

});

// ================= VOICE =================

app.post("/voice",async(req,res)=>{

// 🔥 áudio inicial natural
const audioUrl = await generateVoice("Olá, sou a Iara assistente virtual do doutor Henrique Mafra. Como posso te ajudar?");

res.type("text/xml");
res.send(`
<Response>
<Play>${audioUrl}</Play>

<Gather 
  input="speech" 
  action="/processar" 
  method="POST"
  speechTimeout="auto" 
  timeout="3"
/>

<Redirect>/voice</Redirect>

</Response>
`);
});

app.post("/processar",async(req,res)=>{

try{

const from=req.body.From || "unknown";
const fala=req.body.SpeechResult || "";

if(!fala){
return res.send(`
<Response>
<Say>Não entendi, pode repetir?</Say>
<Gather input="speech" action="/processar" timeout="1"/>
</Response>
`);
}

if(!conversations[from]){
conversations[from]={history:[]};
}

const user=conversations[from];

if(user.history.length>6){
user.history.shift();
}

user.history.push({role:"user",content:fala});

let reply=await aiReply(user.history);

user.history.push({role:"assistant",content:reply});

// 🔥 gera áudio natural
const audioUrl = await generateVoice(reply);

await sendWhatsAppMessage(ADMIN_PHONE,`📞 ${from}\n${fala}`);
await sendWhatsAppMessage(ADMIN_PHONE,`🤖 ${reply}`);

res.send(`
<Response>
<Play>${audioUrl}</Play>
<Gather input="speech" action="/processar" timeout="1"/>
</Response>
`);

}catch(e){

console.log("Erro voice:",e.message);

res.send(`
<Response>
<Say>Erro, pode repetir?</Say>
</Response>
`);

}

});

// ================= START =================

const PORT=process.env.PORT||8080;

app.listen(PORT,()=>{
console.log("Servidor rodando");
});
