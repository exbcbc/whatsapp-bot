import express from "express";
import OpenAI from "openai";
import dotenv from "dotenv";
import axios from "axios";
import fs from "fs";
import FormData from "form-data";

dotenv.config();

const app = express();

app.use(express.json());

if(!fs.existsSync("./audio")){
fs.mkdirSync("./audio");
}

app.use("/audio",express.static("./audio"));

const openai = new OpenAI({
apiKey:process.env.OPENAI_API_KEY
});

/* CHATWOOT */

const CHATWOOT_URL="https://drhm.up.railway.app";
const CHATWOOT_ACCOUNT_ID="2";
const CHATWOOT_TOKEN="K4iNRKnchfhA2TcmQC1itzzb";

const conversations={};

/* DATA BRASIL */

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

/* DOWNLOAD AUDIO */

async function downloadAudio(url){

const response = await axios({
url,
method:"GET",
responseType:"stream",
headers:{
api_access_token:CHATWOOT_TOKEN
}
});

const path="./audio/input.ogg";

const writer=fs.createWriteStream(path);

response.data.pipe(writer);

return new Promise(resolve=>{
writer.on("finish",()=>resolve(path));
});

}

/* TRANSCRIÇÃO */

async function transcribeAudio(path){

const transcription = await openai.audio.transcriptions.create({
file:fs.createReadStream(path),
model:"gpt-4o-transcribe"
});

return transcription.text;

}

/* GERAR VOZ */

async function generateVoice(text){

const speech = await openai.audio.speech.create({
model:"gpt-4o-mini-tts",
voice:"nova",
input:text
});

const buffer = Buffer.from(await speech.arrayBuffer());

const path="./audio/reply.mp3";

fs.writeFileSync(path,buffer);

return path;

}

/* ENVIAR TEXTO */

async function sendChatwootText(conversationId,text){

await axios.post(
`${CHATWOOT_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/conversations/${conversationId}/messages`,
{
content:text,
message_type:"outgoing"
},
{
headers:{
api_access_token:CHATWOOT_TOKEN
}
}
);

}

/* ENVIAR AUDIO */

async function sendChatwootAudio(conversationId,filePath){

const form=new FormData();

form.append("message_type","outgoing");
form.append("attachments[]",fs.createReadStream(filePath));

await axios.post(
`${CHATWOOT_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/conversations/${conversationId}/messages`,
form,
{
headers:{
api_access_token:CHATWOOT_TOKEN,
...form.getHeaders()
}
}
);

}

/* FOLLOW UP */

function scheduleFollowUps(user,conversationId){

const nextDateText=formatDate(nextAvailableDate());
const interaction=user.lastInteraction;

setTimeout(async()=>{

if(!conversations[conversationId])return;

if(conversations[conversationId].lastInteraction!==interaction)return;

await sendChatwootText(conversationId,
`Vi que você estava vendo sobre procedimentos estéticos.

Ainda tenho avaliação disponível ${nextDateText} às 19h30.

Posso reservar esse horário para você?`
);

},10*60*1000);

}

/* IA */

async function aiReply(history,nextDateText){

const completion = await openai.chat.completions.create({

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

/* WEBHOOK CHATWOOT */

app.post("/chatwoot",async(req,res)=>{

try{

if(req.body.message_type!=="incoming"){
return res.sendStatus(200);
}

const conversationId=req.body.conversation?.id;

if(!conversationId){
return res.sendStatus(200);
}

let message=req.body.content || "";
let isAudio=false;

/* VERIFICAR AUDIO */

const attachments=req.body.message?.attachments || [];

if(!message && attachments.length>0){

const audioUrl=attachments[0].data_url;

if(audioUrl){

isAudio=true;

const path=await downloadAudio(audioUrl);

message=await transcribeAudio(path);

}

}

if(!message){
return res.sendStatus(200);
}

/* MEMORIA */

if(!conversations[conversationId]){

conversations[conversationId]={
history:[],
lastInteraction:Date.now()
};

}

const user=conversations[conversationId];

user.lastInteraction=Date.now();

/* HISTORICO */

user.history.push({
role:"user",
content:message
});

const nextDateText=formatDate(nextAvailableDate());

const reply=await aiReply(user.history,nextDateText);

user.history.push({
role:"assistant",
content:reply
});

/* RESPONDER */

if(isAudio){

const voice=await generateVoice(reply);

await sendChatwootAudio(conversationId,voice);

}else{

await sendChatwootText(conversationId,reply);

}

scheduleFollowUps(user,conversationId);

res.sendStatus(200);

}catch(err){

console.log(err);

res.sendStatus(500);

}

});

const PORT=process.env.PORT||8080;

app.listen(PORT,()=>{
console.log("Servidor rodando");
});
