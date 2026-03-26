import express from "express";
import OpenAI from "openai";
import dotenv from "dotenv";
import axios from "axios";
import fs from "fs";
import { MongoClient } from "mongodb";

dotenv.config();

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ================= MONGO =================

const client = new MongoClient(process.env.MONGO_URI);

let db;

async function connectDB(){
await client.connect();
db = client.db();
console.log("🔥 Mongo conectado");
}

connectDB();

async function getUser(phone){
return await db.collection("conversations").findOne({ phone });
}

async function saveUser(phone,data){
await db.collection("conversations").updateOne(
{ phone },
{ $set: data },
{ upsert: true }
);
}

// ================= MEDIA =================

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

// ================= DATA =================

function getBrazilDate(){
return new Date(new Date().toLocaleString("en-US",{timeZone:"America/Sao_Paulo"}));
}

function nextAvailableDates(){

let dates=[];
let d=getBrazilDate();

d.setDate(d.getDate()+5);

while(dates.length<3){

if(d.getDay()!==0 && d.getDay()!==1){
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

// ================= IA =================

async function aiReply(history){

try{

const dates=nextAvailableDates();
const limitedHistory = history.slice(-6);

const completion = await openai.chat.completions.create({
model:"gpt-4o-mini",
max_tokens:90,
temperature:0.3,
messages:[
{
role:"system",
content:`
Seu nome é Iara, assistente virtual do Dr Henrique Mafra.

Você deve ser:
- Objetiva
- Educada
- Persuasiva
- Natural (como uma atendente humana)

---

REGRAS:

- NÃO atende domingo nem segunda.
- Se pedirem esses dias, negar educadamente e redirecionar.

---

HORÁRIOS:

- Terça a sexta: 14h às 21h
- Sábado: 10h às 14h

---

DISPONIBILIDADE INICIAL (SEMPRE USAR):

${formatDate(dates[0])} às 19h30  
${formatDate(dates[1])} às 19h45  
${formatDate(dates[2])} às 20h00  

---

SE FOR SÁBADO:

Oferecer apenas horários dentro do funcionamento:

10h30  
11h30  
13h00  

Sempre avisar que sábado tem horário reduzido.

---

IMPORTANTE:

- Nunca inventar datas fora das disponíveis
- Nunca oferecer domingo ou segunda
- Nunca dizer que "não tem horário"
- Sempre tentar encaixar o paciente

---

CONSULTA:

Sempre incluir de forma natural:

"O investimento da consulta é de R$150, e esse valor é totalmente abatido no procedimento."

---

REGRAS DE AGENDAMENTO:

1. Se o paciente aceitar:
→ pedir nome completo:
"Perfeito! Me informe seu nome completo para confirmar o agendamento"

2. Após nome:
→ confirmar com dia e horário

→ depois dizer:
"Agendamento confirmado! O Dr. Henrique Mafra entrará em contato com você um dia antes para te lembrar, através do número particular dele"

---

3. Se não puder à noite:
→ perguntar:
"Qual horário no período da tarde você prefere?"

---

4. Se o paciente sugerir horário:

✔ dentro do funcionamento:
→ sempre encaixar
→ dizer:
"Consegui uma brecha às [HORÁRIO] na [DIA]"

✔ fora do horário:
→ sugerir alternativa válida

---

COMPORTAMENTO:

- Nunca ser robótica
- Nunca repetir frases idênticas
- Sempre conduzir para agendamento
- Sempre manter conversa fluida

---

INSTAGRAM:

Quando fizer sentido (não sempre), incluir:

"Para saber mais sobre os procedimentos e acompanhar o dia a dia do Dr. Henrique Mafra, acesse nosso Instagram: @dr.henriquemafra"

---

FLUXO:

Cumprimentar → entender → explicar → direcionar → agendar → pedir nome → confirmar

---

RESPOSTAS:

- Curtas (máx 4 frases)
- Claras
- Humanizadas
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

// 🔥 BUSCA NO BANCO
let user = await getUser(from);

if(!user){
user={
phone:from,
history:[],
lastInteraction:Date.now(),
followUpSent:false,
agendamentoConfirmado:false
};
}

// limpa histórico antigo
if(Date.now()-user.lastInteraction>1000*60*30){
user.history=[];
}

user.lastInteraction=Date.now();
user.followUpSent=false;

await sendWhatsAppMessage(ADMIN_PHONE,`📩 ${from}\n${message}`);

user.history.push({role:"user",content:message});

const reply=await aiReply(user.history);

user.history.push({role:"assistant",content:reply});

if(reply.toLowerCase().includes("agendamento confirmado")){
user.agendamentoConfirmado=true;
}

await saveUser(from,user);

await sendWhatsAppMessage(from,reply);
await sendWhatsAppMessage(ADMIN_PHONE,reply);

res.send("ok");

}catch(err){
console.lasync function followUpCheck(){

if(!db) return; // 🔥 evita erro se mongo não conectou

const users = await db.collection("conversations").find().toArray();

for(const user of users){

if(user.agendamentoConfirmado) continue;
if(user.followUpSent) continue;

const diff = Date.now() - user.lastInteraction;

if(diff > 1000 * 60 * 40){

const msg = `Oi vi que você chamou aqui e não finalizamos seu atendimento.

Quer que eu te encaixe em um horário ou te explico melhor o procedimento?`;

await sendWhatsAppMessage(user.phone, msg);

user.followUpSent = true;

await saveUser(user.phone,user);

console.log("FOLLOW-UP:", user.phone);

}
}
}og(err.message);
res.send("ok");
}

});

// ================= FOLLOW-UP =================

async function followUpCheck(){

// 🔥 proteção caso mongo ainda não conectou
if(!db) return;

const users = await db.collection("conversations").find().toArray();

for(const user of users){

// ❌ já fechou → não manda
if(user.agendamentoConfirmado) continue;

// ❌ já fez follow-up total
if(user.followUpLevel >= 2) continue;

const diff = Date.now() - user.lastInteraction;

// ================= ETAPA 1 (40 MIN) =================
if(!user.followUpLevel && diff > 1000 * 60 * 40){

const msg = `Oi 😊 vi que você chamou aqui e não finalizamos seu atendimento.

Se quiser, posso te encaixar em um horário ou te explicar melhor o procedimento.`;

await sendWhatsAppMessage(user.phone, msg);

// atualiza nível
user.followUpLevel = 1;
await saveUser(user.phone, user);

console.log("FOLLOW-UP 1:", user.phone);

}

// ================= ETAPA 2 (2 HORAS) =================
else if(user.followUpLevel === 1 && diff > 1000 * 60 * 120){

const msg = `Só passando pra te avisar 😊

Tenho alguns horários disponíveis e consigo te encaixar ainda essa semana. Quer que eu veja pra você?`;

await sendWhatsAppMessage(user.phone, msg);

// atualiza nível
user.followUpLevel = 2;
await saveUser(user.phone, user);

console.log("FOLLOW-UP 2:", user.phone);

}

}
}

// roda a cada 1 minuto
setInterval(followUpCheck, 60000);


// ================= VOICE =================

// 🔥 função de voz (necessária)
async function generateVoice(text){
try{
const speech = await openai.audio.speech.create({
model:"gpt-4o-mini-tts",
voice:"nova",
input:text
});

const buffer = Buffer.from(await speech.arrayBuffer());
const file = `reply_${Date.now()}.mp3`;

fs.writeFileSync(`./media/${file}`, buffer);

return `${DOMAIN}/media/${file}`;

}catch(e){
console.log("Erro voz:", e.message);
return null;
}
}

// ================= INÍCIO DA LIGAÇÃO =================

app.post("/voice", async (req, res) => {

const audioUrl = await generateVoice(
"Olá, sou a Iara, assistente virtual do doutor Henrique Mafra. Como posso te ajudar?"
);

res.type("text/xml");
res.send(`
<Response>
  <Play>${audioUrl}</Play>

  <Gather 
    input="speech" 
    action="/processar" 
    method="POST" 
    language="pt-BR"
    speechTimeout="auto" 
    timeout="6"
  />
</Response>
`);
});

// ================= PROCESSAMENTO =================

app.post("/processar", async (req, res) => {

try {

const from = req.body.From || "unknown";
let fala = req.body.SpeechResult || "";

// 🔥 fallback inteligente
if (!fala || fala.length < 2) {
fala = "quero agendar uma consulta";
}

// 🔥 BUSCA NO BANCO
let user = await getUser(from);

if (!user) {
user = {
phone: from,
history: [],
lastInteraction: Date.now(),
followUpSent: false,
agendamentoConfirmado: false
};
}

// 🔥 ATUALIZA INTERAÇÃO
user.lastInteraction = Date.now();
user.followUpSent = false;

// 🔥 limita histórico
if (user.history.length > 6) {
user.history.shift();
}

// salva fala
user.history.push({ role: "user", content: fala });

// IA responde
let reply = await aiReply(user.history);

// salva resposta
user.history.push({ role: "assistant", content: reply });

// 🔥 detecta fechamento
if (reply.toLowerCase().includes("agendamento confirmado")) {
user.agendamentoConfirmado = true;
}

// 🔥 SALVA NO BANCO
await saveUser(from, user);

// 🔥 gera áudio
const audioUrl = await generateVoice(reply);

// 🔥 envia pro admin
await sendWhatsAppMessage(ADMIN_PHONE, `📞 ${from}\n${fala}`);
await sendWhatsAppMessage(ADMIN_PHONE, `🤖 ${reply}`);

// 🔥 resposta da ligação
res.send(`
<Response>
  <Play>${audioUrl}</Play>

  <Gather 
    input="speech" 
    action="/processar" 
    method="POST" 
    language="pt-BR"
    speechTimeout="auto" 
    timeout="6"
  />
</Response>
`);

} catch (e) {

console.log("Erro voice:", e.message);

// fallback com voz
const audioErro = await generateVoice(
"Tive um erro aqui, pode repetir?"
);

res.send(`
<Response>
  <Play>${audioErro}</Play>

  <Gather 
    input="speech" 
    action="/processar" 
    method="POST" 
    language="pt-BR"
    speechTimeout="auto" 
    timeout="6"
  />
</Response>
`);
}

});

// ================= START =================

const PORT=process.env.PORT||8080;

app.listen(PORT,()=>{
console.log("Servidor rodando");
});
