import express from "express";
import OpenAI from "openai";
import dotenv from "dotenv";
import axios from "axios";
import fs from "fs";

dotenv.config();

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

/* AUDIO */

if (!fs.existsSync("./audio")) {
fs.mkdirSync("./audio");
}

app.use("/audio", express.static("./audio"));

/* OPENAI */

const openai = new OpenAI({
apiKey: process.env.OPENAI_API_KEY
});

/* TWILIO */

const DOMAIN="https://whatsapp-bot-production-5f72.up.railway.app";

/* CHATWOOT */

const CHATWOOT_URL="https://drhm.up.railway.app";
const ACCOUNT_ID="2";
const INBOX_ID="1";
const TOKEN="K4iNRKnchfhA2TcmQC1itzzb";

/* MEMORIA */

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

/* DOWNLOAD AUDIO */

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

/* TRANSCRIÇÃO */

async function transcribeAudio(path){

const transcription=await openai.audio.transcriptions.create({
file:fs.createReadStream(path),
model:"gpt-4o-transcribe"
});

return transcription.text;

}

/* GERAR VOZ */

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

/* CHATWOOT */

/* criar ou buscar contato */

async function getContact(phone){

try{

const res=await axios.get(
`${CHATWOOT_URL}/api/v1/accounts/${ACCOUNT_ID}/contacts/search?q=${phone}`,
{
headers:{api_access_token:TOKEN}
}
);

if(res.data.payload.length>0){
return res.data.payload[0].id;
}

}catch(e){}

const create=await axios.post(
`${CHATWOOT_URL}/api/v1/accounts/${ACCOUNT_ID}/contacts`,
{
phone_number:phone
},
{
headers:{api_access_token:TOKEN}
}
);

return create.data.payload.contact.id;

}

/* criar conversa */

async function createConversation(contactId){

const res=await axios.post(
`${CHATWOOT_URL}/api/v1/accounts/${ACCOUNT_ID}/conversations`,
{
source_id:`${contactId}`,
inbox_id:INBOX_ID,
contact_id:contactId
},
{
headers:{api_access_token:TOKEN}
}
);

return res.data.id;

}

/* enviar mensagem */

async function sendChatwootMessage(conversationId,text){

await axios.post(
`${CHATWOOT_URL}/api/v1/accounts/${ACCOUNT_ID}/conversations/${conversationId}/messages`,
{
content:text,
message_type:"incoming"
},
{
headers:{api_access_token:TOKEN}
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

Atenda de forma profissional e natural.

Fluxo da conversa:

1 Cumprimente o paciente.

2 Pergunte qual procedimento deseja avaliar.

3 Explique que é necessária avaliação.

4 Ofereça horário.

"O próximo dia disponível é ${nextDateText} às 19h30. Posso reservar esse horário?"

Valor:

"A consulta custa R$150 e é abatida se realizar o procedimento."

Nunca usar emojis.

Respostas curtas.

`
},
...history
]

});

return completion.choices[0].message.content;

}

/* WEBHOOK TWILIO */

app.post("/whatsapp",async(req,res)=>{

try{

const from=req.body.From;

let message=req.body.Body || "";

const numMedia=parseInt(req.body.NumMedia||0);

let isAudio=false;

/* AUDIO */

if(numMedia>0){

const mediaUrl=req.body.MediaUrl0;

isAudio=true;

const path=await downloadAudio(mediaUrl);

message=await transcribeAudio(path);

}

/* MEMORIA */

if(!conversations[from]){

const contactId=await getContact(from);

const conversationId=await createConversation(contactId);

conversations[from]={
history:[],
conversationId
};

}

const user=conversations[from];

user.history.push({
role:"user",
content:message
});

/* ENVIAR PARA CHATWOOT */

await sendChatwootMessage(user.conversationId,message);

/* IA */

const nextDateText=formatDate(nextAvailableDate());

const reply=await aiReply(user.history,nextDateText);

user.history.push({
role:"assistant",
content:reply
});

/* CHATWOOT IA */

await sendChatwootMessage(user.conversationId,reply);

/* AUDIO */

if(isAudio){

await generateVoice(reply);

return res.type("text/xml").send(`
<Response>
<Message>
<Media>${DOMAIN}/audio/reply.mp3</Media>
</Message>
</Response>
`);

}

/* TEXTO */

res.type("text/xml").send(`
<Response>
<Message>${reply}</Message>
</Response>
`);

}catch(err){

console.log(err);

res.type("text/xml").send(`
<Response>
<Message>Erro no servidor.</Message>
</Response>
`);

}

});

/* SERVER */

const PORT=process.env.PORT||8080;

app.listen(PORT,()=>{
console.log("Servidor rodando");
});
