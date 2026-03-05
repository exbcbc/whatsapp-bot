import express from "express";
import OpenAI from "openai";
import dotenv from "dotenv";
import axios from "axios";
import fs from "fs";

dotenv.config();

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use("/audio", express.static("./audio"));

const openai = new OpenAI({
apiKey: process.env.OPENAI_API_KEY
});

const DOMAIN="https://whatsapp-bot-production-5f72.up.railway.app";

const CLINIC_PHONE="whatsapp:+554731700136";
const ADMIN_PHONE="whatsapp:+5547991812557";

const conversations={};

let adminTarget=null;

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

function scheduleFollowUps(user,phone){

const nextDateText=formatDate(nextAvailableDate());
const interaction=user.lastInteraction;

setTimeout(()=>{

if(!conversations[phone])return;

if(conversations[phone].lastInteraction!==interaction)return;

sendWhatsAppMessage(phone,
`Vi que você estava vendo sobre procedimentos estéticos.

Ainda tenho avaliação disponível ${nextDateText} às 19h30.

Posso reservar esse horário para você?`
);

},10*60*1000);

}

async function aiReply(history,nextDateText){

const completion=await openai.chat.completions.create({

model:"gpt-4o-mini",

messages:[
{
role:"system",
content:`

Você é a assistente da clínica do Dr Henrique Mafra.

Atenda de forma profissional e natural.

Fluxo da conversa:

1 Cumprimente o paciente.

2 Pergunte qual procedimento ele deseja avaliar.

Exemplo:
"Qual procedimento você gostaria de avaliar?"

3 Explique que é necessário avaliação.

4 Ofereça agendamento.

Formato:

"O próximo dia disponível é ${nextDateText} às 19h30. Posso reservar esse horário para você?"

Se perguntarem valores:

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

const hasAudio=req.body.NumMedia && req.body.NumMedia>0;

if(!conversations[from]){

conversations[from]={
history:[],
iaAtiva:true,
lastInteraction:Date.now()
};

}

const user=conversations[from];

user.lastInteraction=Date.now();

if(hasAudio){

const mediaUrl=req.body.MediaUrl0;

const path=await downloadAudio(mediaUrl);

message=await transcribeAudio(path);

}

if(!user.iaAtiva)return res.sendStatus(200);

user.history.push({role:"user",content:message});

const nextDateText=formatDate(nextAvailableDate());

const reply=await aiReply(user.history,nextDateText);

user.history.push({role:"assistant",content:reply});

scheduleFollowUps(user,from);

if(hasAudio){

await generateVoice(reply);

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

/* ROTA PARA CHATWOOT */

app.post("/chatwoot",async(req,res)=>{

try{

const message=req.body.message;

if(!message){
return res.sendStatus(200);
}

const nextDateText=formatDate(nextAvailableDate());

const reply=await aiReply([
{role:"user",content:message}
],nextDateText);

res.json({
content:reply
});

}catch(err){

console.log(err);
res.sendStatus(500);

}

});

const PORT=process.env.PORT||8080;

app.listen(PORT,()=>{
console.log("Servidor rodando");
});
