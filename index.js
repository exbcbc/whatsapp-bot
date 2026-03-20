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

function isExistingPatient(message){
const text=(message || "").toLowerCase();

return(
text.includes("já sou paciente")||
text.includes("ja sou paciente")||
text.includes("já falei com o dr")||
text.includes("ja falei com o dr")
);
}

async function aiReply(history){
try{
const dates=nextAvailableDates();

const completion=await openai.chat.completions.create({
model:"gpt-4o-mini",
max_tokens:120,
messages:[
{
role:"system",
content:`
Seu nome é Iara assistente virtual do Dr Henrique Mafra.

Cumprimente o paciente.
Pergunte o procedimento.
Explique brevemente.

Consulta: R$150 abatido no procedimento.

Horários:
${formatDate(dates[0])} às 19h30
${formatDate(dates[1])} às 19h30
${formatDate(dates[2])} às 19h30

Se não puder à noite, perguntar horário da tarde.

Respostas curtas.
`
},
...history
]
});

return completion.choices[0].message.content || "Pode repetir?";

}catch(e){
console.log("ERRO IA:",e.message);
return "Erro, pode repetir?";
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

await new Promise(r=>setTimeout(r,800));

await sendWhatsAppMedia(ADMIN_PHONE,localMedia);

if(mediaType.includes("audio")){
hasAudio=true;
message=await transcribeAudio(localMedia);
}

}
}

await sendWhatsAppMessage(ADMIN_PHONE,`📩 ${from}\n${message}`);

if(isExistingPatient(message)){
await sendWhatsAppMessage(from,`O Dr Henrique vai te chamar: ${DOCTOR_PHONE}`);
return res.send("ok");
}

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

app.post("/voice",(req,res)=>{
res.type("text/xml");
res.send(`
<Response>
<Say language="pt-BR">Olá, aqui é a Iara da clínica. Como posso ajudar?</Say>
<Gather input="speech" action="/processar" method="POST" language="pt-BR" speechTimeout="auto" timeout="2"/>
</Response>
`);
});

app.post("/processar",async(req,res)=>{

try{

const from=req.body.From || "unknown";
const fala=req.body.SpeechResult || "";

if(!fala){
res.type("text/xml");
return res.send(`
<Response>
<Say>Não entendi, pode repetir?</Say>
<Gather input="speech" action="/processar"/>
</Response>
`);
}

if(!conversations[from]){
conversations[from]={history:[]};
}

const user=conversations[from];

user.history.push({role:"user",content:fala});

let reply;

try{
reply=await aiReply(user.history);
}catch{
reply="Erro, pode repetir?";
}

user.history.push({role:"assistant",content:reply});

await sendWhatsAppMessage(ADMIN_PHONE,`📞 ${from}\n${fala}`);
await sendWhatsAppMessage(ADMIN_PHONE,`🤖 ${reply}`);

res.type("text/xml");
res.send(`
<Response>
<Say>${reply}</Say>
<Gather input="speech" action="/processar"/>
</Response>
`);

}catch(e){
console.log("Erro voice:",e.message);
res.type("text/xml");
res.send(`<Response><Say>Erro</Say></Response>`);
}

});

// ================= START =================

const PORT=process.env.PORT||8080;

app.listen(PORT,()=>{
console.log("Servidor rodando");
});
