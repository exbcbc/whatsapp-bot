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

function normalizeNumber(num){

num=num.replace("@","").replace("+","").trim();

if(!num.startsWith("55")){
num="55"+num;
}

return "whatsapp:+"+num;

}

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

text=text.replace(/\./g,"... ");

const speech=await openai.audio.speech.create({
model:"gpt-4o-mini-tts",
voice:"nova",
input:text
});

const buffer=Buffer.from(await speech.arrayBuffer());

fs.writeFileSync("./audio/reply.mp3",buffer);

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

Fluxo:

Cumprimente o paciente.

Pergunte qual procedimento ele deseja avaliar.

Explique que é necessária uma avaliação.

Ofereça horário:

"O próximo dia disponível é ${nextDateText} às 19h30. Posso reservar esse horário?"

Se perguntarem valores:

"A consulta de avaliação custa R$150 e se fizer o procedimento o valor é abatido."

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
const body=req.body.Body||"";

if(from===CLINIC_PHONE){
return res.sendStatus(200);
}

const hasAudio=req.body.NumMedia && req.body.NumMedia>0;

let message=body;

/* ADMIN */

if(from===ADMIN_PHONE){

const command=message.trim();

// selecionar paciente
if(command.startsWith("@")){

adminTarget=normalizeNumber(command);

console.log("Paciente selecionado:",adminTarget);

return res.sendStatus(200);

}

// reativar IA
if(command.startsWith("#ia")){

let phone=normalizeNumber(command.replace("#ia",""));

if(conversations[phone]){
conversations[phone].iaAtiva=true;
}

return res.sendStatus(200);

}

// enviar mensagem manual
if(adminTarget){

if(hasAudio){

const mediaUrl=req.body.MediaUrl0;

await sendWhatsAppMedia(adminTarget,mediaUrl);

}else{

await sendWhatsAppMessage(adminTarget,command);

}

if(conversations[adminTarget]){
conversations[adminTarget].iaAtiva=false;
}

return res.sendStatus(200);

}

return res.sendStatus(200);

}

/* PACIENTE */

if(!conversations[from]){

conversations[from]={
history:[],
iaAtiva:true
};

}

const user=conversations[from];

if(hasAudio){

const mediaUrl=req.body.MediaUrl0;

await sendWhatsAppMedia(ADMIN_PHONE,mediaUrl);

const path=await downloadAudio(mediaUrl);

message=await transcribeAudio(path);

}

await sendWhatsAppMessage(ADMIN_PHONE,
`Paciente: ${from}

Mensagem:
${message}`
);

if(!user.iaAtiva){
return res.sendStatus(200);
}

user.history.push({role:"user",content:message});

const nextDateText=formatDate(nextAvailableDate());

const reply=await aiReply(user.history,nextDateText);

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

res.type("text/xml").send(`<Response><Message>Erro no servidor</Message></Response>`);

}

});

const PORT=process.env.PORT||8080;

app.listen(PORT,()=>{
console.log("Servidor rodando");
});
