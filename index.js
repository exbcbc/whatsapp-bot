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
text.includes("ja falei com o dr")||
text.includes("tava falando com o dr")||
text.includes("estava falando com o dr")
);
}

async function aiReply(history){

const dates=nextAvailableDates();

const completion=await openai.chat.completions.create({

model:"gpt-4o",

messages:[
{
role:"system",
content:`
Seu nome é Iara assistente virtual do Dr Henrique Mafra.

Cumprimente o paciente.
Pergunte o procedimento.
Explique brevemente.

Procedimentos:
Toxina botulínica
HIFU
Fios de PDO
Preenchimento
Redução de medidas
Bioestimulador de colágeno
Blefaroplastia sem corte
Remoção de vasinhos
Remoção de verrugas
Lipo de papada sem corte
Terapia ortomolecular
Tratamento da hiperidrose
Tratamento de melasma
Rinomodelação não cirúrgica
Lobuloplastia
Pescoço de boneca
Harmonização das mãos
Protocolo ReduXpress com Mounjaro (Tirzepatida), mediante consulta por telemedicina com médico habilitado.
Serviços de telemedicina 24 horas por dia, com médicos generalistas e pediatras, somente para assinantes do BELEZA RENOVADA

Instagram:
${INSTAGRAM}

Consulta de avaliação: R$150, valor que será abatido do procedimento escolhido no dia da consulta.

Horários:

${formatDate(dates[0])} às 19h30
${formatDate(dates[1])} às 19h30
${formatDate(dates[2])} às 19h30

Sempre ofereça primeiro os horários das 19h30.

Caso o paciente diga que NÃO pode às 19h30:

Explique que é possível verificar uma exceção no período da tarde.

Pergunte:

"Qual seria o melhor horário para você no período da tarde?"

Após o paciente responder o horário preferido diga que conseguiu encaixar.

Telefone:
${DOCTOR_PHONE}

Endereço:
${CLINIC_ADDRESS}

Respostas curtas.
`
},
...history
]

});

return completion.choices[0].message.content;
}

// ================= WHATSAPP =================

app.post("/whatsapp",async(req,res)=>{

res.status(200).send("ok");

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

if(from!==ADMIN_PHONE){
await sendWhatsAppMedia(ADMIN_PHONE,localMedia);
}

if(mediaType.includes("audio")){
hasAudio=true;
message=await transcribeAudio(localMedia);
}

}

}

if(from!==ADMIN_PHONE){

await sendWhatsAppMessage(
ADMIN_PHONE,
`Paciente: ${from}

Mensagem:
${message || "[MÍDIA RECEBIDA]"}`
);

}

if(isExistingPatient(message)){

const reply=`
Perfeito, vou avisar o Dr. Henrique.

Ele entrará em contato com você:

${DOCTOR_PHONE}
`;

await sendWhatsAppMessage(from,reply);
return;
}

user.history.push({role:"user",content:message});

const reply=await aiReply(user.history);

user.history.push({role:"assistant",content:reply});

if(hasAudio){

const audioUrl=await generateVoice(reply);

if(audioUrl){
await sendWhatsAppMedia(from,audioUrl);

if(from!==ADMIN_PHONE){
await sendWhatsAppMedia(ADMIN_PHONE,audioUrl);
}
}

}else{

await sendWhatsAppMessage(from,reply);

if(from!==ADMIN_PHONE){
await sendWhatsAppMessage(ADMIN_PHONE,reply);
}

}

}catch(err){
console.log("Erro geral:",err.message);
}

});

// ================= VOICE =================

app.post("/voice",(req,res)=>{
res.type("text/xml");
res.send(`
<Response>
<Say language="pt-BR">Olá, aqui é a Iara da clínica. Como posso ajudar?</Say>
<Gather input="speech" action="/processar" method="POST" language="pt-BR"/>
</Response>
`);
});

app.post("/processar",async(req,res)=>{

const from=req.body.From || "unknown";
const fala=req.body.SpeechResult || "";

if(!fala){
res.type("text/xml");
return res.send(`
<Response>
<Say language="pt-BR">Pode repetir?</Say>
<Gather input="speech" action="/processar" method="POST" language="pt-BR"/>
</Response>
`);
}

if(!conversations[from]){
conversations[from]={history:[]};
}

const user=conversations[from];

user.history.push({role:"user",content:fala});

const reply=await aiReply(user.history);

user.history.push({role:"assistant",content:reply});

await sendWhatsAppMessage(ADMIN_PHONE,`📞 ${from}\n${fala}`);
await sendWhatsAppMessage(ADMIN_PHONE,`🤖 ${reply}`);

res.type("text/xml");
res.send(`
<Response>
<Say language="pt-BR">${reply}</Say>
<Gather input="speech" action="/processar" method="POST" language="pt-BR"/>
</Response>
`);

});

// ================= START =================

const PORT=process.env.PORT||8080;

app.listen(PORT,()=>{
console.log("Servidor rodando");
});
```
