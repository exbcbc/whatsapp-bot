import express from "express";
import OpenAI from "openai";
import dotenv from "dotenv";
import axios from "axios";
import fs from "fs";

dotenv.config();

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

if (!fs.existsSync("./audio")) {
  fs.mkdirSync("./audio");
}

app.use("/audio", express.static("./audio"));

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const DOMAIN="https://whatsapp-bot-production-5f72.up.railway.app";

const CLINIC_PHONE="whatsapp:+554731700136";
const ADMIN_PHONE="whatsapp:+5547991812557";
const INSTAGRAM="@drhenriquemafra";

const CLINIC_ADDRESS=`
Clínica WF
Rua 981, Número 196
Centro em Balneário Camboriú, Santa Catarina
`;

const DOCTOR_PHONE="47 99188-6417";

const conversations={};

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

async function sendWhatsAppMessage(to,text){

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

}

async function sendWhatsAppMedia(to,media){

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

}

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

async function transcribeAudio(path){

const transcription=await openai.audio.transcriptions.create({
file:fs.createReadStream(path),
model:"gpt-4o-transcribe"
});

return transcription.text;

}

async function generateVoice(text){

const speech=await openai.audio.speech.create({
model:"gpt-4o-mini-tts",
voice:"nova",
input:text
});

const buffer=Buffer.from(await speech.arrayBuffer());

fs.writeFileSync("./audio/reply.mp3",buffer);

}

function isExistingPatient(message){

const text=message.toLowerCase();

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

Seu nome é IAra você é assistente virtual do Dr Henrique Mafra especialista em estética avançada.

Seu objetivo é atender pacientes de forma natural educada e humanizada e conduzir a conversa até o agendamento da consulta.

Você deve seguir EXATAMENTE o fluxo abaixo e nunca pular etapas.

Fluxo do atendimento:

1 Cumprimente o paciente.

Exemplo:
Olá seja bem-vindo sou a Iara assistente virtual do Dr Henrique Mafra. É um prazer falar com você.

2 Pergunte qual procedimento o paciente deseja.

3 Quando o paciente mencionar um procedimento explique brevemente.

Procedimentos realizados:

Botox  
Preenchimento facial  
Bioestimuladores de colágeno  
Tratamento de melasma  
Tratamento de flacidez  
Lipo de papada  
Remoção de verrugas  
Remoção de tatuagem  

4 Convide para ver resultados no Instagram:

${INSTAGRAM}

5 Explique que é necessária consulta de avaliação.

6 Sobre valores somente quando perguntarem:

A consulta de avaliação tem o valor de R$150 e caso realize o procedimento esse valor é abatido.

7 Ofereça agendamento:

${formatDate(dates[0])} às 19h30  
${formatDate(dates[1])} às 19h30  
${formatDate(dates[2])} às 19h30  

Sempre oferecer primeiro o primeiro horário.

8 Se não puder oferecer os próximos.

9 Priorizar horário 19h30.

10 Se não puder à noite oferecer horário entre 14h e 18h.

11 Nunca sugerir horário antes de ${formatDate(dates[0])}

12 Quando confirmar agendamento:

Perfeito vou deixar seu horário reservado.

O Dr Henrique Mafra entrará em contato com você pelo número particular dele para confirmar os detalhes.

Telefone:
${DOCTOR_PHONE}

Endereço da consulta:

${CLINIC_ADDRESS}

Regras:

Nunca usar emojis.
Responder curto.
Nunca parecer robô.
Sempre conduzir para agendamento.

`
},
...history
]

});

return completion.choices[0].message.content;

}

app.post("/whatsapp",async(req,res)=>{

try{

const from=req.body.From;
let message=req.body.Body || "";

const numMedia=parseInt(req.body.NumMedia || 0);

if(!conversations[from]){

conversations[from]={
history:[],
lastInteraction:Date.now()
};

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

if(mediaType.includes("audio")){

hasAudio=true;

const path=await downloadAudio(mediaUrl);

await sendWhatsAppMedia(ADMIN_PHONE,`${DOMAIN}/audio/input.ogg`);

message=await transcribeAudio(path);

}else{

await sendWhatsAppMedia(ADMIN_PHONE,mediaUrl);

}

}

if(isExistingPatient(message)){

const reply=`
Perfeito vou avisar o Dr Henrique Mafra.

Ele continuará o atendimento diretamente pelo número particular dele.

Telefone:
${DOCTOR_PHONE}
`;

return res.type("text/xml").send(`<Response><Message>${reply}</Message></Response>`);

}

await sendWhatsAppMessage(ADMIN_PHONE,
`Paciente: ${from}

Mensagem:
${message}`
);

user.history.push({role:"user",content:message});

const reply=await aiReply(user.history);

user.history.push({role:"assistant",content:reply});

if(hasAudio){

await generateVoice(reply);

await sendWhatsAppMedia(ADMIN_PHONE,`${DOMAIN}/audio/reply.mp3`);

return res.type("text/xml").send(`
<Response>
<Message>
<Media>${DOMAIN}/audio/reply.mp3</Media>
</Message>
</Response>
`);

}

res.type("text/xml").send(`<Response><Message>${reply}</Message></Response>`);

}catch(err){

console.log(err);

res.type("text/xml").send(`<Response><Message>Erro no servidor.</Message></Response>`);

}

});

const PORT=process.env.PORT||8080;

app.listen(PORT,()=>{
console.log("Servidor rodando");
});
