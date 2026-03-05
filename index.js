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

Exemplo:
"Qual procedimento você gostaria de avaliar?"

3 Explique que é necessária uma avaliação antes de qualquer procedimento.

4 Ofereça agendamento.

Horários disponíveis para avaliação:

${dates[0]} às 19h30  
${dates[1]} às 19h30  
${dates[2]} às 19h30  

Sempre ofereça primeiro o primeiro horário.

Exemplo:
"O próximo horário disponível é ${dates[0]} às 19h30. Posso reservar para você?"

Regras de agenda:

Sempre mencionar dia e horário juntos.

Nunca mencionar apenas o horário.

Priorizar sempre 19h30.

Se o paciente disser que não pode à noite:

ofereça horário alternativo entre 14h e 18h.

Exemplo:

"Podemos verificar ${dates[0]} às 14h ou ${dates[1]} às 16h. Qual fica melhor para você?"

Nunca sugerir horários antes de ${dates[0]}.

Se o paciente confirmar agendamento:

Confirme o dia e horário escolhidos e diga:

"O agendamento foi registrado. O Dr Henrique Mafra entrará em contato para confirmar sua avaliação."

Se perguntarem valores:

"A consulta de avaliação tem valor de R$150 e caso realize o procedimento esse valor é abatido."

Se mencionarem botox, preenchimento, papada, melasma ou flacidez explique brevemente que a avaliação define o melhor tratamento.

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
history:[]
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

user.history.push({role:"user",content:message});

const dates=nextThreeDates();

const reply=await aiReply(user.history,dates);

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
