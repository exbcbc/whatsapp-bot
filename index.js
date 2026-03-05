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
const ACCOUNT_ID="2";
const TOKEN="K4iNRKnchfhA2TcmQC1itzzb";

const conversations={};

/* DATA */

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

/* BUSCAR MENSAGEM COMPLETA */

async function getMessage(conversationId,messageId){

const response=await axios.get(
`${CHATWOOT_URL}/api/v1/accounts/${ACCOUNT_ID}/conversations/${conversationId}/messages`,
{
headers:{api_access_token:TOKEN}
});

return response.data.payload.find(m=>m.id==messageId);
}

/* DOWNLOAD AUDIO */

async function downloadAudio(url){

const response=await axios({
url,
method:"GET",
responseType:"stream"
});

const path="./audio/input.ogg";

const writer=fs.createWriteStream(path);

response.data.pipe(writer);

return new Promise(resolve=>{
writer.on("finish",()=>resolve(path));
});

}

/* TRANSCRIBE */

async function transcribeAudio(path){

const transcription=await openai.audio.transcriptions.create({
file:fs.createReadStream(path),
model:"gpt-4o-transcribe"
});

return transcription.text;

}

/* TTS */

async function generateVoice(text){

const speech=await openai.audio.speech.create({
model:"gpt-4o-mini-tts",
voice:"nova",
input:text
});

const buffer=Buffer.from(await speech.arrayBuffer());

const path="./audio/reply.mp3";

fs.writeFileSync(path,buffer);

return path;

}

/* SEND TEXT */

async function sendText(conversationId,text){

await axios.post(
`${CHATWOOT_URL}/api/v1/accounts/${ACCOUNT_ID}/conversations/${conversationId}/messages`,
{
content:text,
message_type:"outgoing"
},
{
headers:{api_access_token:TOKEN}
}
);

}

/* SEND AUDIO */

async function sendAudio(conversationId,file){

const form=new FormData();

form.append("message_type","outgoing");
form.append("attachments[]",fs.createReadStream(file));

await axios.post(
`${CHATWOOT_URL}/api/v1/accounts/${ACCOUNT_ID}/conversations/${conversationId}/messages`,
form,
{
headers:{
api_access_token:TOKEN,
...form.getHeaders()
}
}
);

}

/* IA */

async function aiReply(history,nextDateText){

const completion=await openai.chat.completions.create({

model:"gpt-4o-mini",

messages:[
{
role:"system",
content:`

Você é a assistente da clínica do Dr Henrique Mafra.

Seja educada e profissional.

Pergunte qual procedimento deseja avaliar.

Explique que é necessária avaliação.

Ofereça horário:

${nextDateText} às 19h30

Valor da avaliação: R$150.

Respostas curtas.
`
},
...history
]

});

return completion.choices[0].message.content;

}

/* WEBHOOK */

app.post("/chatwoot",async(req,res)=>{

try{

if(req.body.message_type!=="incoming"){
return res.sendStatus(200);
}

const conversationId=req.body.conversation?.id;
const messageId=req.body.id;

if(!conversationId || !messageId){
return res.sendStatus(200);
}

/* BUSCAR MENSAGEM */

const fullMessage=await getMessage(conversationId,messageId);

let text=fullMessage.content || "";
let isAudio=false;

/* AUDIO */

if(fullMessage.attachments?.length){

const audioUrl=fullMessage.attachments[0].data_url;

if(audioUrl){

isAudio=true;

const path=await downloadAudio(audioUrl);

text=await transcribeAudio(path);
}

}

if(!text){
return res.sendStatus(200);
}

/* MEMORIA */

if(!conversations[conversationId]){
conversations[conversationId]={history:[]};
}

const user=conversations[conversationId];

user.history.push({
role:"user",
content:text
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

await sendAudio(conversationId,voice);

}else{

await sendText(conversationId,reply);
}

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
