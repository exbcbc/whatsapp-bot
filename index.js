import express from "express";
import OpenAI from "openai";
import dotenv from "dotenv";
import axios from "axios";
import fs from "fs";
import path from "path";

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

const conversations={};

function getBrazilDate(){
return new Date(new Date().toLocaleString("en-US",{timeZone:"America/Sao_Paulo"}));
}

function formatDate(date){
return date.toLocaleDateString("pt-BR",{
weekday:"long",
day:"numeric",
month:"long"
});
}

function nextThreeDates(){

let d=getBrazilDate();
d.setDate(d.getDate()+5);

const dates=[];

while(dates.length<3){

if(d.getDay()!==0 && d.getDay()!==1 && d.getDay()!==6){
dates.push(formatDate(new Date(d)));
}

d.setDate(d.getDate()+1);
}

return dates;
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

async function downloadTwilioMedia(mediaUrl,i){

const response=await axios({
url:mediaUrl,
method:"GET",
responseType:"stream",
auth:{
username:process.env.TWILIO_ACCOUNT_SID,
password:process.env.TWILIO_AUTH_TOKEN
}
});

const fileName=`media_${Date.now()}_${i}`;
const filePath=`./audio/${fileName}.bin`;

const writer=fs.createWriteStream(filePath);

response.data.pipe(writer);

await new Promise(resolve=>writer.on("finish",resolve));

return `${DOMAIN}/audio/${fileName}.bin`;

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

const pathFile="./audio/input.ogg";

const writer=fs.createWriteStream(pathFile);

response.data.pipe(writer);

return new Promise(resolve=>{
writer.on("finish",()=>resolve(pathFile));
});

}

async function transcribeAudio(pathFile){

const transcription=await openai.audio.transcriptions.create({
file:fs.createReadStream(pathFile),
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

async function aiReply(history,dates){

const completion=await openai.chat.completions.create({

model:"gpt-4o-mini",

messages:[
{
role:"system",
content:`

Você é a assistente da clínica do Dr Henrique Mafra.

Atenda de forma educada, profissional e natural.

Fluxo da conversa:

1 Cumprimente o paciente.

2 Pergunte qual procedimento ele deseja avaliar.

3 Explique que é necessária uma avaliação antes de qualquer procedimento.

4 Ofereça agendamento.

Horários disponíveis para avaliação:

${dates[0]} às 19h30  
${dates[1]} às 19h30  
${dates[2]} às 19h30  

Sempre oferecer primeiro o primeiro horário.

Priorizar sempre 19h30.

Se o paciente disser que não pode à noite:

ofereça horário alternativo entre 14h e 18h.

Nunca sugerir horários antes de ${dates[0]}.

Se confirmar agendamento:

"O agendamento foi registrado. O Dr Henrique Mafra entrará em contato para confirmar sua avaliação."

Valor:

"A consulta de avaliação tem valor de R$150 e caso realize o procedimento esse valor é abatido."

Nunca usar emojis.

Respostas curtas.

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
conversations[from]={history:[]};
}

const user=conversations[from];

let audioReceived=false;

if(numMedia>0){

for(let i=0;i<numMedia;i++){

const mediaUrl=req.body["MediaUrl"+i];

const mediaType=req.body["MediaContentType"+i];

const publicUrl=await downloadTwilioMedia(mediaUrl,i);

await sendWhatsAppMedia(ADMIN_PHONE,publicUrl);

if(mediaType && mediaType.includes("audio")){
audioReceived=true;
}

}

if(audioReceived){

const audioUrl=req.body.MediaUrl0;

const audioPath=await downloadAudio(audioUrl);

message=await transcribeAudio(audioPath);

}

}

if(message){

await sendWhatsAppMessage(ADMIN_PHONE,
`Paciente: ${from}

Mensagem:
${message}`);

}

user.history.push({role:"user",content:message});

const dates=nextThreeDates();

const reply=await aiReply(user.history,dates);

user.history.push({role:"assistant",content:reply});

await sendWhatsAppMessage(ADMIN_PHONE,
`Resposta IA para ${from}:

${reply}`);

if(audioReceived){

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
