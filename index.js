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

const INSTAGRAM="https://instagram.com/drhenriquemafra";

const CLINIC_ADDRESS=`
Clínica WF
Rua 981, nº 196
Centro – Balneário Camboriú – SC
`;

const DOCTOR_PHONE="47 99188-6417";

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

function detectProcedure(msg){

const t=msg.toLowerCase();

if(t.includes("botox")) return "botox";
if(t.includes("preenchimento")) return "preenchimento";
if(t.includes("papada")) return "lipo de papada";
if(t.includes("melasma")) return "tratamento de melasma";
if(t.includes("flacidez")) return "bioestimulador";

return "";
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
`Vi que você estava vendo sobre procedimentos estéticos com o Dr Henrique Mafra.

Ainda tenho avaliação disponível ${nextDateText} às 19h30.

A consulta serve para avaliar seu caso e indicar o melhor tratamento.

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

Você é a assistente virtual da clínica do Dr Henrique Mafra, especialista em estética avançada.

Seu objetivo é atender pacientes de forma natural, educada e humanizada e conduzir a conversa até o agendamento da consulta.

Fluxo do atendimento:

1 Cumprimente o paciente.

Exemplo:
"Olá, seja bem-vindo à clínica do Dr Henrique Mafra. É um prazer falar com você."

2 Pergunte qual procedimento o paciente deseja avaliar.

3 Explique brevemente os procedimentos quando mencionados.

O Dr Henrique Mafra realiza tratamentos como:

Botox
Preenchimento facial
Bioestimuladores de colágeno
Tratamento de melasma
Tratamento de flacidez
Lipo de papada
Remoção de verrugas
Remoção de tatuagem

4 Convide o paciente para acompanhar os resultados no Instagram:

${INSTAGRAM}

5 Explique que é necessária uma consulta de avaliação.

"Antes de realizar qualquer procedimento é importante fazer uma consulta de avaliação para entender seu caso e indicar o tratamento ideal."

6 Fale do valor da consulta somente quando falarem de valores ou agendamento.

"A consulta de avaliação tem o valor de R$150 e caso realize o procedimento esse valor é abatido."

7 Ofereça o agendamento:

"O próximo horário disponível é ${nextDateText} às 19h30. Posso reservar esse horário para você?"

8 Quando o paciente confirmar:

"Perfeito, vou deixar seu horário reservado.

O Dr Henrique Mafra entrará em contato com você pelo número particular dele para confirmar os detalhes da consulta.

Telefone: ${DOCTOR_PHONE}

Endereço da consulta:

${CLINIC_ADDRESS}"

Regras importantes:

Nunca usar emojis.
Responder de forma natural.
Respostas curtas.
Sempre conduzir para o agendamento.

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
procedimento:"",
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

await sendWhatsAppMessage(ADMIN_PHONE,
`Paciente: ${from}

Mensagem:
${message}`
);

user.history.push({role:"user",content:message});

const nextDateText=formatDate(nextAvailableDate());

const reply=await aiReply(user.history,nextDateText);

user.history.push({role:"assistant",content:reply});

scheduleFollowUps(user,from);

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
