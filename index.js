import express from "express";
import OpenAI from "openai";
import dotenv from "dotenv";
import axios from "axios";
import fs from "fs";

dotenv.config();

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const openai = new OpenAI({
apiKey: process.env.OPENAI_API_KEY
});

/* CHATWOOT CONFIG */

const CHATWOOT_URL="https://drhm.up.railway.app";
const CHATWOOT_ACCOUNT_ID="2";
const CHATWOOT_TOKEN="K4iNRKnchfhA2TcmQC1itzzb";

/* MEMORIA DE CONVERSAS */

const conversations={};

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

/* DETECTAR PROCEDIMENTO */

function detectProcedure(msg){

const t=msg.toLowerCase();

if(t.includes("botox")) return "botox";
if(t.includes("preenchimento")) return "preenchimento";
if(t.includes("papada")) return "lipo papada";
if(t.includes("melasma")) return "melasma";
if(t.includes("flacidez")) return "bioestimulador";

return "";

}

/* FOLLOW UP AUTOMÁTICO */

function scheduleFollowUps(user,conversationId){

const nextDateText=formatDate(nextAvailableDate());
const interaction=user.lastInteraction;

setTimeout(async()=>{

if(!conversations[conversationId]) return;

if(conversations[conversationId].lastInteraction!==interaction) return;

await sendChatwootMessage(conversationId,
`Vi que você estava vendo sobre procedimentos estéticos.

Ainda tenho avaliação disponível ${nextDateText} às 19h30.

Posso reservar esse horário para você?`
);

},10*60*1000);

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

/* ENVIAR MENSAGEM PARA CHATWOOT */

async function sendChatwootMessage(conversationId,text){

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

/* ROTA CHATWOOT */

app.post("/chatwoot",async(req,res)=>{

try{

const message=req.body.content || "";
const conversationId=req.body.conversation?.id;

if(!message || !conversationId){
return res.sendStatus(200);
}

if(!conversations[conversationId]){

conversations[conversationId]={
history:[],
procedimento:"",
lastInteraction:Date.now()
};

}

const user=conversations[conversationId];

user.lastInteraction=Date.now();

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

await sendChatwootMessage(conversationId,reply);

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
